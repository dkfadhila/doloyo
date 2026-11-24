import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AGENTS.md is a tutorial with exact tool calls. Every fenced block tagged "json tool-call" must be a call (or a list of calls)
 * of the shape {"tool": name, "arguments": {...}} that the MCP server really accepts: known tool name, known argument names,
 * required arguments present, values valid for the tool's zod schema. Commands inside `batch` are checked the same way.
 * Needs the MCP dependencies (npm ci --prefix mcp); the test is skipped without them.
 */
const root = resolve(__dirname, '..');
const haveMcp = existsSync(resolve(root, 'mcp/node_modules/@modelcontextprotocol'));

interface ZodLike {
  safeParse: (v: unknown) => { success: boolean; error?: { message: string } };
}
type Shape = Record<string, ZodLike>;
interface Call {
  tool: string;
  arguments: Record<string, unknown>;
}

async function registeredTools(): Promise<Map<string, Shape>> {
  const { registerTools } = await import('../mcp/src/tools');
  const tools = new Map<string, Shape>();
  const fake = {
    registerTool: (name: string, cfg: { inputSchema?: Shape }) => {
      tools.set(name, cfg.inputSchema ?? {});
    },
  };
  registerTools(fake as never, {} as never);
  return tools;
}

function blocks(md: string): { info: string; body: string; line: number }[] {
  const out: { info: string; body: string; line: number }[] = [];
  const re = /^```([^\n]*)\n([\s\S]*?)^```/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.push({ info: m[1].trim(), body: m[2], line: md.slice(0, m.index).split('\n').length });
  return out;
}

function checkArgs(tools: Map<string, Shape>, name: string, args: Record<string, unknown>, where: string): string[] {
  const shape = tools.get(name);
  if (!shape) return [`${where}: unknown tool "${name}"`];
  const errs: string[] = [];
  for (const k of Object.keys(args)) if (!(k in shape)) errs.push(`${where}: "${name}" has no argument "${k}"`);
  for (const [k, z] of Object.entries(shape)) {
    if (!(k in args)) {
      if (!z.safeParse(undefined).success) errs.push(`${where}: "${name}" needs argument "${k}"`);
      continue;
    }
    const r = z.safeParse(args[k]);
    if (!r.success) errs.push(`${where}: "${name}.${k}" is invalid (${r.error?.message.split('\n')[0] ?? 'bad value'})`);
  }
  return errs;
}

/** Check every "json tool-call" block of a Markdown file; returns the errors and adds the used tool names to `used`. */
function checkToolBlocks(tools: Map<string, Shape>, md: string, file: string, used: Set<string>): string[] {
  const errors: string[] = [];
  for (const b of blocks(md).filter((x) => /^json\s+tool-call\b/.test(x.info))) {
    const where = `${file} line ${b.line}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(b.body);
    } catch (e) {
      errors.push(`${where}: not valid JSON (${(e as Error).message})`);
      continue;
    }
    const calls = (Array.isArray(parsed) ? parsed : [parsed]) as Call[];
    for (const c of calls) {
      if (!c || typeof c.tool !== 'string' || typeof c.arguments !== 'object' || c.arguments === null || Array.isArray(c.arguments)) {
        errors.push(`${where}: a call must be {"tool": name, "arguments": {...}}`);
        continue;
      }
      used.add(c.tool);
      errors.push(...checkArgs(tools, c.tool, c.arguments, where));
      if (c.tool === 'batch') {
        const cmds = (c.arguments as { commands?: { type?: unknown }[] }).commands ?? [];
        cmds.forEach((cmd, i) => {
          const { type, ...rest } = cmd as { type: string } & Record<string, unknown>;
          if (typeof type !== 'string' || type === 'batch') return void errors.push(`${where}: batch command ${i} needs a "type" that is an edit tool`);
          used.add(type);
          if (type === 'image_add') {
            if ('path' in rest) errors.push(`${where}: image_add inside batch cannot take "path" (use the image_add tool)`);
            return;
          }
          errors.push(...checkArgs(tools, type, rest, `${where} batch[${i}]`));
        });
      }
    }
  }
  return errors;
}

describe.skipIf(!haveMcp)('AGENTS.md tool calls', () => {
  const md = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
  const toolBlocks = blocks(md).filter((b) => /^json\s+tool-call\b/.test(b.info));

  it('has worked tutorials with tool calls', () => {
    expect(toolBlocks.length).toBeGreaterThanOrEqual(15);
  });

  it('every other json block is valid JSON', () => {
    for (const b of blocks(md).filter((x) => x.info === 'json')) expect(() => JSON.parse(b.body), `line ${b.line}`).not.toThrow();
  });

  it('every tool call names a registered tool with valid arguments', async () => {
    const tools = await registeredTools();
    expect(tools.size).toBeGreaterThan(30);
    const used = new Set<string>();
    const errors = checkToolBlocks(tools, md, 'AGENTS.md', used);
    expect(errors).toEqual([]);
    // the tutorials cover the main workflows
    for (const t of ['scene_get', 'batch', 'scene_preset', 'anim_apply', 'camera_set', 'render_export', 'image_add', 'image_set', 'mocap_from_video', 'ik_pin', 'ik_reach', 'ik_bake', 'viewport_snapshot', 'bridge_status']) {
      expect(used.has(t), `no tutorial uses ${t}`).toBe(true);
    }
  });

  it('the checker rejects wrong calls (so it is not vacuous)', async () => {
    const tools = await registeredTools();
    expect(checkArgs(tools, 'joint_zap', {}, 'x')).toHaveLength(1);
    expect(checkArgs(tools, 'joint_set', { object: 'a', joint: 'tail', rotation: [0, 0, 0] }, 'x').length).toBeGreaterThan(0);
    expect(checkArgs(tools, 'joint_set', { joint: 'head' }, 'x').length).toBeGreaterThan(0);
    expect(checkArgs(tools, 'render_export', { format: 'mp4', url: 'x' }, 'x').length).toBeGreaterThan(0);
    expect(checkArgs(tools, 'image_add', { path: '/a.png', mode: 'plane' }, 'x')).toEqual([]);
  });
});

/** The built-in agent skills (skills/<name>/SKILL.md + references) must name real tools with valid arguments too. */
const skillsRoot = resolve(root, 'skills');
function mdFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? mdFiles(resolve(dir, d.name)) : d.name.endsWith('.md') ? [resolve(dir, d.name)] : []));
}

describe.skipIf(!haveMcp || !existsSync(skillsRoot))('skills', () => {
  const dirs = existsSync(skillsRoot) ? readdirSync(skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

  it('every skill has SKILL.md with front matter name (= folder) and a description', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    for (const d of dirs) {
      const md = readFileSync(resolve(skillsRoot, d, 'SKILL.md'), 'utf8');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? '';
      expect(/^name:\s*(.+)$/m.exec(fm)?.[1]?.trim(), d).toBe(d);
      expect((/^description:\s*(.+)$/m.exec(fm)?.[1] ?? '').length, d).toBeGreaterThan(60);
    }
  });

  it('every json tool-call block in the skills is a valid call', async () => {
    const tools = await registeredTools();
    const used = new Set<string>();
    const errors = mdFiles(skillsRoot).flatMap((f) => checkToolBlocks(tools, readFileSync(f, 'utf8'), relative(root, f).split('\\').join('/'), used));
    expect(errors).toEqual([]);
    expect(used.size).toBeGreaterThanOrEqual(5);
  });

  it('every tool name written in backticks in a skill exists', async () => {
    const tools = await registeredTools();
    const cmds = new Set(['key_remove', 'key_set_easing']);
    const unknown: string[] = [];
    for (const f of mdFiles(skillsRoot)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/`([a-z]+_[a-z_]+)`/g)) {
        const n = m[1];
        if (!/^(anim|camera|key|keys|ik|pose|object|scene|timeline|playhead|render|image|viewport|guide|bridge|joint|mocap)_/.test(n)) continue;
        if (!tools.has(n) && !cmds.has(n)) unknown.push(`${relative(root, f)}: ${n}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});

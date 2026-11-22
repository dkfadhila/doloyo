import { INTERNAL_COMMANDS } from '../core/commands';

/** Permission gate for agent calls. Pure so it can be unit-tested. */

export type PermissionMode = 'read' | 'edit' | 'render';
export const PERMISSION_MODES: PermissionMode[] = ['read', 'edit', 'render'];
export const MODE_LABEL: Record<PermissionMode, string> = { read: 'Read-only', edit: 'Edit', render: 'Edit + Render' };

const RANK: Record<PermissionMode, number> = { read: 0, edit: 1, render: 2 };
const REQUIRED: Record<string, PermissionMode> = {
  scene_get: 'read',
  anim_list: 'read',
  anim_apply: 'edit',
  mocap_upload: 'edit',
  mocap_from_video: 'edit',
  viewport_snapshot: 'read',
  dispatch: 'edit',
  undo: 'edit',
  redo: 'edit',
  render_export: 'render',
};

/** Commands that only exist as undo inverses. */
const INTERNAL = new Set(INTERNAL_COMMANDS);

export type Gate = { ok: true } | { ok: false; error: string };

export function checkPermission(mode: PermissionMode, method: string): Gate {
  const need = REQUIRED[method];
  if (!need) return { ok: false, error: `Unknown method: ${method}` };
  if (RANK[mode] >= RANK[need]) return { ok: true };
  return {
    ok: false,
    error: `Permission denied: "${method}" needs "${MODE_LABEL[need]}" mode but the user set "${MODE_LABEL[mode]}". Ask the user to change the permission mode in the Agent panel.`,
  };
}

/** Find an internal command anywhere in a (possibly batched) command. Returns its type or null. */
export function findInternalCommand(cmd: unknown, depth = 0): string | null {
  if (!cmd || typeof cmd !== 'object' || depth > 8) return null;
  const c = cmd as { type?: unknown; commands?: unknown };
  if (typeof c.type === 'string' && INTERNAL.has(c.type)) return c.type;
  if (c.type === 'batch' && Array.isArray(c.commands)) {
    for (const s of c.commands) {
      const r = findInternalCommand(s, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

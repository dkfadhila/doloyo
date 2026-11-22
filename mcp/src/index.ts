#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Bridge, DEFAULT_ORIGINS, HOSTED_ORIGINS, log } from './bridge.js';
import { registerTools } from './tools.js';

// STDOUT belongs to the MCP protocol. Make accidental console.log calls harmless.
console.log = (...a: unknown[]) => console.error(...a);

const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

const USAGE = `motion-doll-mcp ${VERSION}
MCP stdio server + local WebSocket bridge for Motion Doll Studio.

Usage: motion-doll-mcp [options]

Options:
  --origin <url>     Allow this browser origin to connect (repeatable), e.g. --origin https://studio.example.com
  --allow-hosted     Also allow the official hosted origins built into this version
  --port <n>         WebSocket port (default 7777, or MOTION_DOLL_PORT; the app expects 7777)
  -h, --help         Show this help
  -v, --version      Show the version

Environment:
  MOTION_DOLL_PORT      WebSocket port
  MOTION_DOLL_ORIGINS   Extra allowed origins, comma separated

Always allowed: http://localhost:5173, http://127.0.0.1:5173. The bridge binds to 127.0.0.1 only.
Register with an agent, e.g.: claude mcp add motion-doll -- node <path>/mcp/dist/index.js
`;

interface Cli {
  origins: string[];
  hosted: boolean;
  port?: string;
}

function toOrigin(v: string): string {
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
  } catch {
    /* fall through */
  }
  console.error(`--origin must be an http(s) URL like https://studio.example.com (got: ${v})`);
  process.exit(2);
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { origins: [], hosted: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (name: string): string => {
      const eq = a.indexOf('=');
      if (eq > 0) return a.slice(eq + 1);
      const v = argv[++i];
      if (!v || v.startsWith('--')) {
        console.error(`${name} needs a value

${USAGE}`);
        process.exit(2);
      }
      return v;
    };
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a === '-v' || a === '--version') {
      process.stdout.write(VERSION + '\n');
      process.exit(0);
    } else if (a === '--allow-hosted') cli.hosted = true;
    else if (a === '--origin' || a.startsWith('--origin=')) cli.origins.push(toOrigin(val('--origin')));
    else if (a === '--port' || a.startsWith('--port=')) cli.port = val('--port');
    else {
      console.error(`Unknown option: ${a}

${USAGE}`);
      process.exit(2);
    }
  }
  return cli;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const port = Number(cli.port ?? process.env.MOTION_DOLL_PORT ?? 7777);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log(`Invalid port: ${cli.port ?? process.env.MOTION_DOLL_PORT}`);
    process.exit(1);
  }
  const extra = (process.env.MOTION_DOLL_ORIGINS ?? '').split(',');
  const bridge = new Bridge({ port, origins: [...DEFAULT_ORIGINS, ...extra, ...cli.origins, ...(cli.hosted ? HOSTED_ORIGINS : [])] });
  await bridge.start();

  const server = new McpServer({ name: 'motion-doll', version: VERSION });
  registerTools(server, bridge);
  await server.connect(new StdioServerTransport());
  log('MCP stdio server ready');

  const shutdown = () => {
    void bridge.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
}

main().catch((e) => {
  log('Fatal:', e instanceof Error ? e.stack : e);
  process.exit(1);
});

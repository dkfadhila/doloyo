// npm start: Vite dev server plus a reminder on how to start the MCP bridge (separate process, started by your agent).
import { createServer } from 'vite';

console.log('\nDoloyo dev server. To let an AI agent drive it, register the MCP server once:');
console.log('  npm run mcp:build');
console.log('  claude mcp add doloyo -- node ' + process.cwd().replace(/\/g, '/') + '/mcp/dist/index.js');
console.log('The agent starts the bridge (ws://127.0.0.1:7777); then open the Agent pill and enter the pairing code.\n');

const server = await createServer();
await server.listen();
server.printUrls();

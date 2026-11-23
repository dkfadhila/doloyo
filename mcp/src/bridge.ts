import { randomInt, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

/** STDOUT is reserved for the MCP protocol. Everything human-readable goes to stderr. */
export const log = (...a: unknown[]) => console.error('[doloyo]', ...a);

export const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
/** Official hosted deployments, enabled with --allow-hosted. */
export const HOSTED_ORIGINS: string[] = [
  'https://doll.tirtavex.tech',
  'https://motion-doll-studio.vercel.app',
  'https://doloyo.vercel.app',
  'https://doloyo.tirtavex.tech',
];
export const PAIRING_FILE = join(tmpdir(), 'doloyo-pairing.txt');
/** Former name of the pairing file; still written so older scripts that read it keep working. */
export const LEGACY_PAIRING_FILE = join(tmpdir(), 'motion-doll-pairing.txt');
export const CLOSE_BAD_CODE = 4001;
export const CLOSE_REPLACED = 4002;
const HELLO_TIMEOUT_MS = 5000;
const MAX_BAD_ATTEMPTS = 5;

export class BridgeError extends Error {}

export interface CallResult {
  data: any;
  /** Present when the browser streamed binary data in chunks (render_export). */
  bytes?: Buffer;
}

interface Pending {
  resolve: (r: CallResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  chunks: Map<number, string>;
}

export interface BridgeOptions {
  port: number;
  origins: string[];
  pairingFile?: string;
  /** Second file that gets the same code (default: the former motion-doll-pairing.txt; pass null to skip). */
  legacyPairingFile?: string | null;
}

function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export class Bridge {
  code = genCode();
  readonly port: number;
  listening = false;
  listenError: string | null = null;
  private readonly origins: Set<string>;
  private readonly pairingFile: string;
  private readonly legacyPairingFile: string | null;
  private readonly server: http.Server;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });
  private client: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private badAttempts = 0;

  constructor(opts: BridgeOptions) {
    this.port = opts.port;
    this.pairingFile = opts.pairingFile ?? PAIRING_FILE;
    this.legacyPairingFile = opts.legacyPairingFile === undefined ? (opts.pairingFile ? null : LEGACY_PAIRING_FILE) : opts.legacyPairingFile;
    this.origins = new Set(opts.origins.map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean));
    this.server = http.createServer((_req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('Doloyo bridge: WebSocket only');
    });
    this.server.on('upgrade', (req, socket, head) => {
      const origin = req.headers.origin;
      const host = (req.headers.host ?? '').toLowerCase();
      const okHost = host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
      if (!origin || !this.origins.has(origin) || !okHost) {
        log(`Rejected connection (origin: ${origin ?? 'none'}, host: ${host || 'none'}). Add the origin with --origin <url> or DOLOYO_ORIGINS if it is legitimate.`);
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
  }

  get connected(): boolean {
    return !!this.client && this.client.readyState === WebSocket.OPEN;
  }

  announceCode(): void {
    log(`Pairing code: ${this.code} - enter it in the Agent panel of Doloyo`);
    for (const file of [this.pairingFile, this.legacyPairingFile]) {
      if (!file) continue;
      try {
        writeFileSync(file, this.code + '\n');
      } catch (e) {
        log('Could not write pairing file:', e instanceof Error ? e.message : e);
      }
    }
  }

  /** Never rejects: if the port is taken the MCP server still runs and tools explain the problem. */
  start(): Promise<void> {
    this.announceCode();
    return new Promise((resolve) => {
      this.server.once('error', (e: NodeJS.ErrnoException) => {
        this.listenError = e.code === 'EADDRINUSE' ? `Port ${this.port} is already in use (another Doloyo MCP server running?). Set DOLOYO_PORT.` : e.message;
        log('Bridge not listening:', this.listenError);
        resolve();
      });
      this.server.listen(this.port, '127.0.0.1', () => {
        this.listening = true;
        log(`WebSocket bridge listening on ws://127.0.0.1:${this.port} (allowed origins: ${[...this.origins].join(', ')})`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.client?.close(1001);
    this.wss.close();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private codeMatches(given: unknown): boolean {
    if (typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(this.code);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private onConnection(ws: WebSocket): void {
    let authed = false;
    const timer = setTimeout(() => !authed && ws.close(CLOSE_BAD_CODE, 'hello timeout'), HELLO_TIMEOUT_MS);
    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!authed) {
        if (msg?.type === 'hello' && this.codeMatches(msg.code)) {
          authed = true;
          clearTimeout(timer);
          this.badAttempts = 0;
          if (this.client && this.client !== ws) {
            const old = this.client;
            this.failAll(new BridgeError('Browser connection was replaced by a newer one'));
            old.close(CLOSE_REPLACED, 'replaced');
          }
          this.client = ws;
          ws.send(JSON.stringify({ type: 'welcome', port: this.port }));
          log('Browser connected');
        } else {
          clearTimeout(timer);
          log('Browser sent a wrong pairing code');
          ws.close(CLOSE_BAD_CODE, 'bad code');
          if (++this.badAttempts >= MAX_BAD_ATTEMPTS) {
            this.badAttempts = 0;
            this.code = genCode();
            log('Too many wrong codes, generated a new one.');
            this.announceCode();
          }
        }
        return;
      }
      this.onMessage(msg);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (this.client === ws) {
        this.client = null;
        log('Browser disconnected');
        this.failAll(new BridgeError('Browser disconnected during the call'));
      }
    });
    ws.on('error', (e) => log('Socket error:', e.message));
  }

  private onMessage(msg: any): void {
    const p = this.pending.get(String(msg?.id));
    if (!p) return;
    if (msg.type === 'chunk' && typeof msg.data === 'string' && Number.isInteger(msg.seq)) {
      p.chunks.set(msg.seq, msg.data);
    } else if (msg.type === 'result') {
      clearTimeout(p.timer);
      this.pending.delete(String(msg.id));
      if (!msg.ok) return p.reject(new BridgeError(String(msg.error ?? 'Unknown browser error')));
      let bytes: Buffer | undefined;
      if (p.chunks.size) {
        const parts = [...p.chunks.entries()].sort((a, b) => a[0] - b[0]);
        if (parts.some(([seq], i) => seq !== i)) return p.reject(new BridgeError('Missing chunk(s) from browser'));
        bytes = Buffer.concat(parts.map(([, d]) => Buffer.from(d, 'base64')));
      }
      p.resolve({ data: msg.data, bytes });
    }
  }

  private failAll(e: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(e);
      this.pending.delete(id);
    }
  }

  /** Message for the agent when no browser is paired. */
  notConnectedMessage(): string {
    if (this.listenError) return `Doloyo bridge is not running: ${this.listenError}`;
    return (
      'No browser connected. Ask the user to open Doloyo (http://localhost:5173, or the hosted app when the server runs with --allow-hosted), open the Agent panel (top right), ' +
      `enter the pairing code ${this.code} and click Connect. Then retry.`
    );
  }

  call(method: string, params: unknown, timeoutMs = 30_000): Promise<CallResult> {
    const ws = this.client;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new BridgeError(this.notConnectedMessage()));
    const id = String(++this.seq);
    return new Promise<CallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser (${method}). Is the tab in the background or busy?`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, chunks: new Map() });
      ws.send(JSON.stringify({ id, type: 'call', method, params }), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new BridgeError('Failed to send to browser: ' + err.message));
        }
      });
    });
  }
}

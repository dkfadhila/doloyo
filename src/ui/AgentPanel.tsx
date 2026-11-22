import { useEffect, useRef, useState } from 'react';
import { loadCode, useAgent } from '../agent/agentStore';
import { BRIDGE_PORT, connectBridge, disconnectBridge, retryBridge } from '../agent/bridge';
import { MODE_LABEL, PERMISSION_MODES, type PermissionMode } from '../agent/permissions';
import { Pop } from './Popover';
import { useUi } from './uiStore';

const MODE_HELP: Record<PermissionMode, string> = {
  read: 'The agent can read the scene and take viewport snapshots.',
  edit: 'Read-only plus editing (commands, undo, redo). Ctrl+Z reverts agent edits.',
  render: 'Edit plus render/export to files on the machine running the MCP server.',
};

const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
const isHttpsPage = () => typeof location !== 'undefined' && location.protocol === 'https:';
const SETUP = 'claude mcp add motion-doll -- node <path>/mcp/dist/index.js';

export function AgentPill() {
  const status = useAgent((s) => s.status);
  const open = useUi((s) => s.agentOpen);
  const setOpen = useUi((s) => s.setAgentOpen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open, setOpen]);

  const offline = useAgent((s) => s.offline);
  const label = status === 'connected' ? 'Agent: connected' : status === 'connecting' ? 'Agent: connecting' : offline ? 'Agent: offline' : 'Agent: off';
  return (
    <div className="agent" ref={ref}>
      <button className={'pill' + (open ? ' on' : '')} title="Agent connection (local MCP bridge)" onClick={() => setOpen(!open)}>
        <i className={'dot' + (status === 'connected' ? ' ok' : status === 'connecting' || offline ? ' warn' : '')} />
        {label}
      </button>
      {open && <AgentPopover />}
    </div>
  );
}

function AgentPopover() {
  const status = useAgent((s) => s.status);
  const error = useAgent((s) => s.error);
  const offline = useAgent((s) => s.offline);
  const mode = useAgent((s) => s.mode);
  const setMode = useAgent((s) => s.setMode);
  const log = useAgent((s) => s.log);
  const clearLog = useAgent((s) => s.clearLog);
  const [code, setCode] = useState(loadCode());
  const valid = /^\d{6}$/.test(code.trim());
  const active = status !== 'disconnected';

  return (
    <Pop className="pop agent-pop">
      <div className="row">
        <span className="muted">Status</span>
        <span className="mono">{status}</span>
      </div>
      <div className="row">
        <input
          className="text-input mono"
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit pairing code"
          value={code}
          disabled={active}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && valid && !active && connectBridge(code)}
        />
        {active ? (
          <button className="btn" onClick={() => disconnectBridge()}>Disconnect</button>
        ) : (
          <button className="btn primary" disabled={!valid} onClick={() => connectBridge(code)}>Connect</button>
        )}
      </div>
      {error && <div className="note err">{error}</div>}
      {offline && (
        <div className="row">
          <button className="btn primary wide" title="Try to reach the MCP server again" onClick={() => retryBridge()}>Bridge offline — Retry</button>
        </div>
      )}

      <div className="row">
        <span className="muted">Permissions</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
          {PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
      </div>
      <div className="muted small">{MODE_HELP[mode]}</div>

      {isHttpsPage() && (
        <div className="note small">
          This page is served over https and talks to your local bridge at <span className="mono">ws://127.0.0.1:{BRIDGE_PORT}</span>. Chrome and Edge may show a Private Network Access prompt: allow it for this site. Safari blocks this connection; use the local install (<span className="mono">npm start</span>) instead. Start the bridge with <span className="mono">npx motion-doll-mcp --origin {location.origin}</span> if this site is not on its allowlist.
        </div>
      )}

      <div className="section-title sm">Setup</div>
      <div className="muted small">
        Build once: <code className="mono">npm run mcp:install</code> then <code className="mono">npm run mcp:build</code>. Register the server in your agent client:
      </div>
      <pre className="code mono">{SETUP}</pre>
      <div className="muted small">
        No local checkout? <span className="mono">claude mcp add motion-doll -- npx -y motion-doll-mcp</span>
      </div>
      <div className="muted small">
        The server prints a pairing code on stderr and writes it to <span className="mono">motion-doll-pairing.txt</span> in the system temp folder (or ask the agent for <span className="mono">bridge_status</span>). Bridge port {BRIDGE_PORT}.
      </div>

      <div className="section-title sm log-head">
        <span>Activity</span>
        <button className="btn" disabled={!log.length} onClick={clearLog}>Clear</button>
      </div>
      <div className="log">
        {!log.length && <div className="muted small">No agent calls yet.</div>}
        {log.map((l) => (
          <div key={l.id} className={'log-row ' + l.state} title={l.error}>
            <span className="mono muted">{fmt(l.time)}</span>
            <span className="mono">{l.method}</span>
            <span className="ellipsis muted">{l.state === 'error' ? l.error : l.summary}</span>
            <span className="mono log-state">{l.state === 'pending' ? '...' : l.state === 'ok' ? 'ok' : 'err'}</span>
          </div>
        ))}
      </div>
    </Pop>
  );
}

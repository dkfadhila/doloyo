import { create } from 'zustand';
import { PERMISSION_MODES, type PermissionMode } from './permissions';

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected';

export interface LogEntry {
  id: number;
  time: number; // epoch ms
  method: string;
  summary: string;
  state: 'pending' | 'ok' | 'error';
  error?: string;
}

const MODE_KEY = 'motion-doll.agent.mode';
export const CODE_KEY = 'motion-doll.agent.code';
export const AUTO_KEY = 'motion-doll.agent.auto';
export const MAX_LOG = 100;

function loadMode(): PermissionMode {
  try {
    const v = localStorage.getItem(MODE_KEY) as PermissionMode | null;
    if (v && PERMISSION_MODES.includes(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return 'edit';
}

export function loadCode(): string {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

interface AgentState {
  status: BridgeStatus;
  error: string | null;
  /** Auto-retry gave up (bridge not reachable): the panel shows a Retry button. */
  offline: boolean;
  mode: PermissionMode;
  log: LogEntry[];
  setStatus: (s: BridgeStatus, error?: string | null, offline?: boolean) => void;
  setMode: (m: PermissionMode) => void;
  addLog: (e: LogEntry) => void;
  updateLog: (id: number, patch: Partial<LogEntry>) => void;
  clearLog: () => void;
}

export const useAgent = create<AgentState>((set) => ({
  status: 'disconnected',
  error: null,
  offline: false,
  mode: loadMode(),
  log: [],
  setStatus: (status, error = null, offline = false) => set({ status, error, offline }),
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ mode });
  },
  addLog: (e) => set((s) => ({ log: [e, ...s.log].slice(0, MAX_LOG) })),
  updateLog: (id, patch) => set((s) => ({ log: s.log.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
  clearLog: () => set({ log: [] }),
}));

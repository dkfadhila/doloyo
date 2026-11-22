import { create } from 'zustand';
import { charactersReady } from '../characters/loader';
import { exportRender, ExportCancelled, type ExportOptions, type ExportResult } from './renderer';

interface RenderStatus {
  busy: boolean;
  label: string;
  done: number;
  total: number;
  error: string | null;
  abort: AbortController | null;
  cancel: () => void;
}

export const useRender = create<RenderStatus>((set, get) => ({
  busy: false,
  label: '',
  done: 0,
  total: 0,
  error: null,
  abort: null,
  cancel: () => get().abort?.abort(),
}));

/** Single-flight export used by both the Export dialog and the agent bridge. */
export async function runExport(opts: Omit<ExportOptions, 'signal' | 'onProgress'>, label = 'Export'): Promise<ExportResult> {
  if (useRender.getState().busy) throw new Error('Another export is already running');
  const abort = new AbortController();
  useRender.setState({ busy: true, label, done: 0, total: 0, error: null, abort });
  try {
    await charactersReady(); // skinned characters load asynchronously; never export a half-loaded scene
    return await exportRender({
      ...opts,
      signal: abort.signal,
      onProgress: (done, total) => useRender.setState({ done, total }),
    });
  } catch (e) {
    if (!(e instanceof ExportCancelled)) useRender.setState({ error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    useRender.setState({ busy: false, abort: null });
  }
}

export { ExportCancelled };

import { create } from 'zustand';

export type Panel = 'outliner' | 'anims';

interface UiState {
  exportOpen: boolean;
  agentOpen: boolean;
  importOpen: boolean;
  /** File chosen in File > Import character... */
  importFile: File | null;
  danceOpen: boolean;
  tourOpen: boolean;
  shortcutsOpen: boolean;
  aboutOpen: boolean;
  leftPanel: Panel;
  /** Narrow screens: side panels are overlays toggled from the top bar. */
  leftOpen: boolean;
  rightOpen: boolean;
  /** Short message shown in the toast (loading failures, warnings). */
  notice: string | null;
  /** Width / height of the export resolution (drives the camera frustum gizmo and the safe frame). */
  renderAspect: number;
  /** Timeline view: key rows or curve graph. */
  timelineView: 'keys' | 'curves';
  setRenderAspect: (a: number) => void;
  setTimelineView: (v: 'keys' | 'curves') => void;
  setExportOpen: (v: boolean) => void;
  setAgentOpen: (v: boolean) => void;
  setImportFile: (f: File | null) => void;
  setDanceOpen: (v: boolean) => void;
  setTourOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setLeftPanel: (p: Panel) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  notify: (m: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  exportOpen: false,
  agentOpen: false,
  importOpen: false,
  importFile: null,
  danceOpen: false,
  tourOpen: false,
  shortcutsOpen: false,
  aboutOpen: false,
  leftPanel: 'outliner',
  leftOpen: false,
  rightOpen: false,
  notice: null,
  renderAspect: 16 / 9,
  timelineView: 'keys',
  setRenderAspect: (renderAspect) => set({ renderAspect }),
  setTimelineView: (timelineView) => set({ timelineView }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setAgentOpen: (agentOpen) => set({ agentOpen }),
  setImportFile: (importFile) => set({ importFile, importOpen: !!importFile }),
  setDanceOpen: (danceOpen) => set({ danceOpen }),
  setTourOpen: (tourOpen) => set({ tourOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setLeftPanel: (leftPanel) => set({ leftPanel, leftOpen: true }),
  setLeftOpen: (leftOpen) => set((s) => ({ leftOpen, rightOpen: leftOpen ? false : s.rightOpen })),
  setRightOpen: (rightOpen) => set((s) => ({ rightOpen, leftOpen: rightOpen ? false : s.leftOpen })),
  notify: (notice) => set({ notice }),
}));

import { create } from 'zustand';
import type { BackdropSlot } from '../core/types';

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
  /** Picture waiting for the user to choose how to add it (viewport background, image plane, camera background). */
  pendingImage: File | null;
  /** Background image row selected in the outliner (the inspector then edits it). */
  bgSelected: BackdropSlot | null;
  saveOpen: boolean;
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
  setPendingImage: (f: File | null) => void;
  setBgSelected: (s: BackdropSlot | null) => void;
  setSaveOpen: (v: boolean) => void;
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
  pendingImage: null,
  bgSelected: null,
  saveOpen: false,
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
  setPendingImage: (pendingImage) => set({ pendingImage }),
  setBgSelected: (bgSelected) => set({ bgSelected }),
  setSaveOpen: (saveOpen) => set({ saveOpen }),
  setLeftPanel: (leftPanel) => set({ leftPanel, leftOpen: true }),
  setLeftOpen: (leftOpen) => set((s) => ({ leftOpen, rightOpen: leftOpen ? false : s.rightOpen })),
  setRightOpen: (rightOpen) => set((s) => ({ rightOpen, leftOpen: rightOpen ? false : s.leftOpen })),
  notify: (notice) => set({ notice }),
}));

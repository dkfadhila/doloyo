import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { autoConnectBridge } from './agent/bridge';
import { loadCustomCharacters, missingCharactersNotice } from './characters/store';
import { useUi } from './ui/uiStore';
import { loadAutosave, startAutosave } from './persist';
import { applyClip } from './anim/apply';
import { listClips, searchClips } from './anim/library';
import { runMocapFromBlob } from './mocap/job';
import { runExport } from './render/run';
import { useStore } from './store';
import './styles.css';

// console helpers next to window.motionDoll (the agent bridge uses the same code paths)
Object.assign(window.motionDoll, {
  anim: { list: async (q?: string) => searchClips(await listClips(), q), apply: applyClip },
  mocap: { fromBlob: runMocapFromBlob },
  render: runExport,
});

async function boot() {
  await loadCustomCharacters();
  const saved = await loadAutosave();
  if (saved) {
    useStore.getState().setProject(saved);
    useUi.getState().notify(missingCharactersNotice(saved.objects));
  }
  startAutosave();
  autoConnectBridge();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
boot();

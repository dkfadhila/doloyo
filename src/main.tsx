import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { autoConnectBridge } from './agent/bridge';
import { loadCustomCharacters, missingCharactersNotice } from './characters/store';
import { dispatchResolved } from './images/commands';
import { loadProjectImages, missingImagesNotice } from './images/store';
import { migrateLegacyData } from './legacy';
import { useUi } from './ui/uiStore';
import { loadAutosave, startAutosave } from './persist';
import { applyClip } from './anim/apply';
import { listClips, searchClips } from './anim/library';
import { runMocapFromBlob } from './mocap/job';
import { runExport } from './render/run';
import { useStore } from './store';
import './styles.css';

// console helpers next to window.doloyo (window.motionDoll is the same object, kept for older scripts)
Object.assign(window.doloyo, {
  dispatchAsync: dispatchResolved,
  anim: { list: async (q?: string) => searchClips(await listClips(), q), apply: applyClip },
  mocap: { fromBlob: runMocapFromBlob },
  render: runExport,
});

async function boot() {
  await migrateLegacyData(); // data saved under the former name (Motion Doll Studio) is copied once, never deleted
  await loadCustomCharacters();
  const saved = await loadAutosave();
  if (saved) {
    useStore.getState().setProject(saved);
    const miss = await loadProjectImages(saved);
    useUi.getState().notify([missingCharactersNotice(saved.objects), missingImagesNotice(saved, miss)].filter(Boolean).join(' ') || null);
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

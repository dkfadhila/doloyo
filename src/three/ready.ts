import { charactersReady } from '../characters/loader';
import { getCharacter } from '../characters/registry';
import { useStore } from '../store';
import { getRenderContext } from './shared';

/**
 * Readiness of the skinned characters in the live scene. The file loader only knows about loads that already
 * started, but a Mannequin view starts loading in a React effect AFTER the command that added it. So the
 * views report here: 'loading' (effect started), 'ready' (instance built AND pose/body applied), 'error'
 * (falls back to the procedural doll). An object with no entry has not been mounted yet.
 */
export type SkinState = 'loading' | 'ready' | 'error';
const status = new Map<string, { character: string; state: SkinState }>();

export function setSkinStatus(id: string, character: string, state: SkinState | null): void {
  if (state === null) status.delete(id);
  else status.set(id, { character, state });
}

/** Objects of the project whose skinned character is not displayed yet (exposed for tests). */
export function pendingSkins(): string[] {
  const out: string[] = [];
  for (const o of useStore.getState().project.objects) {
    if (o.kind !== 'mannequin') continue;
    const def = getCharacter(o.character);
    if (!def || def.kind === 'procedural') continue; // procedural doll (or a character that is not registered yet is waited for below)
    const s = status.get(o.id);
    if (!s || s.character !== o.character || s.state === 'loading') out.push(o.id);
  }
  return out;
}

const frame = () =>
  new Promise<void>((resolve) => {
    // a hidden tab may not run animation frames: never wait for one forever
    const t = window.setTimeout(resolve, 300);
    requestAnimationFrame(() => {
      window.clearTimeout(t);
      resolve();
    });
  });

/**
 * Resolves when the viewport exists, every skinned character in the project has loaded, been retargeted and
 * had its pose applied, and at least one frame was rendered after that. Call before any snapshot or export.
 */
export async function sceneReady(timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    await charactersReady();
    let ctxOk = true;
    try {
      getRenderContext();
    } catch {
      ctxOk = false;
    }
    const wait = pendingSkins();
    if (ctxOk && !wait.length) break;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(ctxOk ? `Characters did not finish loading in ${timeoutMs / 1000}s (${wait.join(', ')})` : 'Viewport not ready');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  await frame();
  await frame(); // the first frame may still carry the state from before; the second is drawn after every effect ran
}

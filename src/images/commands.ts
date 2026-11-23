import type { Command } from '../core/commands';
import type { ImageMode } from '../core/types';
import { useStore, type DispatchOpts, type DispatchResult } from '../store';
import { addImageBlob, addImageFile, dataUrlToBlob, ensureImage, ImageError } from './store';

/** image_add as it arrives from outside: the picture can be given as a stored image id or as a data URL. */
type Incoming = Record<string, unknown> & { type: string };

/**
 * Commands stay pure: image_add needs an image that is already stored in this browser (imageId) plus its aspect.
 * This step stores a dataUrl, looks up the stored image and fills in aspect and default name, recursing into batches.
 */
export async function resolveImageCommands(cmd: Incoming): Promise<Command> {
  if (cmd.type === 'batch' && Array.isArray(cmd.commands)) {
    const commands: Command[] = [];
    for (const c of cmd.commands as Incoming[]) commands.push(await resolveImageCommands(c));
    return { ...cmd, commands } as unknown as Command;
  }
  if (cmd.type !== 'image_add') return cmd as unknown as Command;
  const out: Incoming = { ...cmd };
  const dataUrl = out.dataUrl;
  delete out.dataUrl;
  if (dataUrl !== undefined) {
    if (typeof dataUrl !== 'string') throw new ImageError('dataUrl must be a string');
    const meta = await addImageBlob(dataUrlToBlob(dataUrl), typeof out.name === 'string' ? out.name : 'image');
    out.imageId = meta.id;
    out.aspect = meta.width / meta.height;
    if (out.name === undefined) out.name = meta.name;
  } else if (typeof out.imageId === 'string' && out.imageId) {
    const l = await ensureImage(out.imageId);
    if (!l) throw new ImageError(`Image "${out.imageId}" is not stored in this browser (give a dataUrl, or add it from File > Add reference image)`);
    if (out.aspect === undefined) out.aspect = l.meta.width / l.meta.height;
    if (out.name === undefined && out.mode !== 'plane') out.name = l.meta.name;
  } else {
    throw new ImageError('image_add needs imageId or dataUrl');
  }
  return out as unknown as Command;
}

/** dispatch() for commands that may carry a dataUrl. */
export async function dispatchResolved(cmd: Incoming, opts?: DispatchOpts): Promise<DispatchResult> {
  try {
    return useStore.getState().dispatch(await resolveImageCommands(cmd), opts);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** UI: store a picture file and add it in the chosen mode (one undo step). */
export async function addImageFromFile(file: File, mode: ImageMode): Promise<DispatchResult> {
  try {
    const meta = await addImageFile(file);
    return useStore.getState().dispatch({ type: 'image_add', mode, imageId: meta.id, aspect: meta.width / meta.height, name: mode === 'plane' ? undefined : meta.name });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

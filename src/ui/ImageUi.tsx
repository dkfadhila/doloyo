import { useEffect, useState } from 'react';
import type { BackdropSlot, ImageFit, ImageMode, SceneObject } from '../core/types';
import { IMAGE_FITS } from '../core/types';
import { addImageFromFile } from '../images/commands';
import { EMBED_MAX_BYTES, getCachedMeta, IMAGE_ACCEPT, projectImageIds } from '../images/store';
import { exportProject } from '../persist';
import { selectedObject, useStore } from '../store';
import { NumberField } from './NumberField';
import { useUi } from './uiStore';

const MODE_LABEL: Record<ImageMode, string> = { background: 'Viewport background', plane: 'Image plane', camera: 'Camera background' };
const MODE_HINT: Record<ImageMode, string> = {
  background: 'Picture behind the scene, fixed to the screen',
  plane: 'Textured plane in the 3D scene (move, rotate, scale, key)',
  camera: 'Locked to the render camera frame, also in renders',
};

export const isImageFile = (f: File) => /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);

/** Add a picture in a mode (one undo step), with a hint when it cannot show yet. */
export async function addReference(file: File, mode: ImageMode): Promise<void> {
  const r = await addImageFromFile(file, mode);
  const ui = useUi.getState();
  if (!r.ok) return ui.notify('Could not add the image: ' + (r.error ?? 'unknown error'));
  if (mode === 'camera' && !useStore.getState().project.objects.some((o) => o.kind === 'camera')) ui.notify('Camera background added. It shows once the project has a render camera (Outliner + > Render Camera).');
}

/** File picker; with a mode the picture is added directly, otherwise the user chooses the mode in a popover. */
export function openImagePicker(mode?: ImageMode): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMAGE_ACCEPT;
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    if (!isImageFile(f)) return useUi.getState().notify('Unsupported file. Use a PNG, JPG, WebP, GIF or SVG image.');
    if (mode) void addReference(f, mode);
    else useUi.getState().setPendingImage(f);
  };
  input.click();
}

/** Small popover that asks how a picked or dropped picture should be added. */
export function ImageModePopover() {
  const file = useUi((s) => s.pendingImage);
  const set = useUi((s) => s.setPendingImage);
  useEffect(() => {
    if (!file) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && set(null);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [file, set]);
  if (!file) return null;
  const pick = (m: ImageMode) => {
    set(null);
    void addReference(file, m);
  };
  return (
    <div className="image-pop pop" role="dialog" aria-label="Add reference image">
      <div className="image-pop-title">
        <span className="ellipsis" title={file.name}>Add "{file.name}" as</span>
      </div>
      {(['background', 'plane', 'camera'] as ImageMode[]).map((m) => (
        <button key={m} className="menu-item image-mode" onClick={() => pick(m)}>
          <span>{MODE_LABEL[m]}</span>
          <span className="muted small">{MODE_HINT[m]}</span>
        </button>
      ))}
      <button className="btn wide" onClick={() => set(null)}>Cancel</button>
    </div>
  );
}

const check = (label: string, value: boolean, onChange: (v: boolean) => void, title?: string) => (
  <label className="row check" title={title}>
    <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

/** Inspector section of an image plane object. */
export function ImagePlaneSection({ obj }: { obj: SceneObject }) {
  const dispatch = useStore((s) => s.dispatch);
  const im = obj.image;
  if (!im) return null;
  const meta = getCachedMeta(im.imageId);
  const set = (patch: Record<string, unknown>, group?: string) => dispatch({ type: 'image_set', object: obj.id, ...patch } as never, { group });
  return (
    <section>
      <div className="section-title">Image plane</div>
      <div className="muted small ellipsis" title={meta ? `${meta.name} ${meta.width}x${meta.height}` : im.imageId}>
        {meta ? `${meta.name} (${meta.width} x ${meta.height})` : 'Picture not stored in this browser'}
      </div>
      <div className="vec-fields one">
        <NumberField label="Opac" value={im.opacity} step={0.05} decimals={2} min={0} max={1} title="Opacity" onCommit={(v, g) => set({ opacity: v }, g)} />
      </div>
      {check('Include in render', im.inRender, (v) => set({ inRender: v }), 'Draw in snapshots, exports and GLB')}
      {check('Locked (not selectable in viewport)', im.locked, (v) => set({ locked: v }))}
      {check('Always face camera', im.billboard, (v) => set({ billboard: v }), 'Turns to the camera; rotation is ignored')}
      {check('Double sided', im.doubleSided, (v) => set({ doubleSided: v }))}
      <div className="note">The plane is {im.aspect.toFixed(2)} x 1 m times the scale. Position, rotation and scale can be keyed like a shape.</div>
    </section>
  );
}

/** Inspector section of a background image (selected in the outliner). */
export function BackdropInspector({ slot }: { slot: BackdropSlot }) {
  const b = useStore((s) => (slot === 'camera' ? s.project.cameraBackground : s.project.background));
  const dispatch = useStore((s) => s.dispatch);
  if (!b) return null;
  const set = (patch: Record<string, unknown>, group?: string) => dispatch({ type: 'image_set', background: slot, ...patch } as never, { group });
  const meta = getCachedMeta(b.imageId);
  return (
    <section>
      <div className="section-title">{slot === 'camera' ? 'Camera background' : 'Viewport background'}</div>
      <div className="muted small ellipsis" title={b.name}>{meta ? `${b.name} (${meta.width} x ${meta.height})` : `${b.name} (not stored in this browser)`}</div>
      <div className="vec-fields one">
        <NumberField label="Opac" value={b.opacity} step={0.05} decimals={2} min={0} max={1} title="Opacity" onCommit={(v, g) => set({ opacity: v }, g)} />
      </div>
      <div className="row">
        <span className="muted">Fit</span>
        <select value={b.fit} onChange={(e) => set({ fit: e.target.value as ImageFit })}>
          {IMAGE_FITS.map((f) => (
            <option key={f} value={f}>{f === 'fit' ? 'Fit (whole picture)' : f === 'fill' ? 'Fill (crop)' : 'Center (pixels)'}</option>
          ))}
        </select>
      </div>
      {check('Visible', b.visible, (v) => set({ visible: v }))}
      {check('Include in render', b.inRender, (v) => set({ inRender: v }), 'Draw in snapshots and exports')}
      <div className="btn-row">
        <button className="btn" onClick={() => dispatch({ type: 'image_remove', background: slot })}>Remove</button>
      </div>
      <div className="note">{slot === 'camera' ? 'Locked to the render camera frame: visible while looking through the camera (C) and composited in exports.' : 'Fixed to the screen behind the scene. Rendered only when Include in render is on.'}</div>
    </section>
  );
}

/** Used by the inspector: which background (if any) is being edited while no object is selected. */
export function useBackdropSelection(): BackdropSlot | null {
  const slot = useUi((s) => s.bgSelected);
  const has = useStore((s) => (slot === 'camera' ? !!s.project.cameraBackground : slot === 'viewport' ? !!s.project.background : false));
  const obj = useStore(selectedObject);
  return !obj && slot && has ? slot : null;
}

/** Save dialog for projects that use reference images: optionally embed small pictures in the file. */
export function SaveDialog() {
  const open = useUi((s) => s.saveOpen);
  const set = useUi((s) => s.setSaveOpen);
  const [embed, setEmbed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && set(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, set]);
  if (!open) return null;
  const p = useStore.getState().project;
  const ids = projectImageIds(p);
  const big = ids.filter((id) => (getCachedMeta(id)?.bytes ?? 0) > EMBED_MAX_BYTES).length;
  const go = async () => {
    setBusy(true);
    try {
      const r = await exportProject(p, embed);
      if (embed && r.skipped) useUi.getState().notify(`${r.skipped} image${r.skipped > 1 ? 's' : ''} not embedded (over 2 MB or not stored in this browser). The file still references ${r.skipped > 1 ? 'them' : 'it'} by id.`);
      set(false);
    } catch (e) {
      useUi.getState().notify('Save failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && set(false)}>
      <div className="modal" role="dialog" aria-label="Save project">
        <div className="drawer-head"><span className="panel-title">Save project</span></div>
        <div className="modal-body">
          <div className="muted small">This project uses {ids.length} reference image{ids.length > 1 ? 's' : ''}. They are stored in this browser; the file references them by id and warns when one is missing.</div>
          <label className="row check">
            <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} />
            <span>Embed images in the project file (up to 2 MB each)</span>
          </label>
          {embed && big > 0 && <div className="note">{big} image{big > 1 ? 's are' : ' is'} larger than 2 MB and will stay as a reference only.</div>}
          <div className="btn-row">
            <button className="btn" onClick={() => set(false)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={go}>Save .mdoll.json</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ctrl+S and File > Save: a dialog only when the project has reference images, else a direct download. */
export function requestSave(): void {
  const p = useStore.getState().project;
  if (projectImageIds(p).length) useUi.getState().setSaveOpen(true);
  else void exportProject(p);
}

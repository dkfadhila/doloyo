import { describe, expect, it } from 'vitest';
import { checkPermission, findInternalCommand } from './permissions';

describe('agent permission gate', () => {
  it('read-only allows scene_get and snapshot only', () => {
    expect(checkPermission('read', 'scene_get').ok).toBe(true);
    expect(checkPermission('read', 'viewport_snapshot').ok).toBe(true);
    for (const m of ['dispatch', 'undo', 'redo', 'render_export']) expect(checkPermission('read', m).ok).toBe(false);
  });
  it('edit adds dispatch/undo/redo but not render', () => {
    for (const m of ['scene_get', 'viewport_snapshot', 'dispatch', 'undo', 'redo']) expect(checkPermission('edit', m).ok).toBe(true);
    expect(checkPermission('edit', 'render_export').ok).toBe(false);
  });
  it('render allows everything known', () => {
    for (const m of ['scene_get', 'viewport_snapshot', 'dispatch', 'undo', 'redo', 'render_export']) expect(checkPermission('render', m).ok).toBe(true);
  });
  it('animation and capture tools: library listing is read-only, applying and uploading need Edit', () => {
    expect(checkPermission('read', 'anim_list').ok).toBe(true);
    for (const m of ['anim_apply', 'mocap_upload', 'mocap_from_video']) {
      expect(checkPermission('read', m).ok).toBe(false);
      expect(checkPermission('edit', m).ok).toBe(true);
    }
  });
  it('unknown methods are denied and denial explains how to fix it', () => {
    expect(checkPermission('render', 'eval').ok).toBe(false);
    const d = checkPermission('read', 'dispatch');
    expect(!d.ok && d.error).toMatch(/Edit/);
  });
  it('detects internal commands, including inside batches', () => {
    expect(findInternalCommand({ type: 'joint_set' })).toBeNull();
    expect(findInternalCommand({ type: 'track_restore' })).toBe('track_restore');
    expect(findInternalCommand({ type: 'batch', commands: [{ type: 'batch', commands: [{ type: 'object_restore' }] }] })).toBe('object_restore');
  });
});

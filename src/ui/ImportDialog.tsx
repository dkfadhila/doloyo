import { useEffect, useState } from 'react';
import { analyzeFile, commitImport, type Analysis } from '../characters/importer';
import type { BoneMap } from '../characters/registry';
import { JOINTS } from '../core/rig';
import type { JointName } from '../core/types';
import { useStore } from '../store';
import { Icon } from './Icons';
import { useUi } from './uiStore';

/** File > Import character...: analyses the file, maps bones to our 17 joints (editable), stores it in this browser. */
export function ImportDialog() {
  const file = useUi((s) => s.importFile);
  const setFile = useUi((s) => s.setImportFile);
  const [a, setA] = useState<Analysis | null>(null);
  const [map, setMap] = useState<BoneMap>({});
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    setA(null);
    setError(null);
    setShowMap(false);
    if (!file) return;
    let dead = false;
    setBusy(true);
    analyzeFile(file)
      .then((r) => {
        if (dead) return;
        setA(r);
        setMap(r.map);
        setLabel(r.name);
        setShowMap(r.missing.length > 0);
      })
      .catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !dead && setBusy(false));
    return () => {
      dead = true;
    };
  }, [file]);

  useEffect(() => {
    if (!file) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setFile(null);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [file, setFile]);

  if (!file) return null;
  const missing = JOINTS.filter((j) => !map[j]);
  const hasHips = !!map.hips;

  const doImport = async () => {
    if (!a) return;
    setBusy(true);
    setError(null);
    try {
      const def = await commitImport(file, a, map, label);
      const st = useStore.getState();
      const sel = st.project.objects.find((o) => o.id === st.selection.object && o.kind === 'mannequin');
      if (sel) st.dispatch({ type: 'object_set_character', object: sel.id, character: def.id, material: 'original' });
      useUi.getState().notify(
        sel
          ? `Imported "${def.label}" and applied it to ${sel.name}. The file is stored only in this browser.`
          : `Imported "${def.label}". Choose it in Inspector > Character. The file is stored only in this browser.`,
      );
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && setFile(null)}>
      <div className="modal" role="dialog" aria-label="Import character">
        <div className="drawer-head">
          <span className="panel-title">Import character</span>
          <button className="icon-btn" onClick={() => setFile(null)} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <div className="muted small ellipsis" title={file.name}>{file.name} ({(file.size / 1048576).toFixed(1)} MB)</div>
          {busy && !a && <div className="note">Reading the file...</div>}
          {error && <div className="note err">{error}</div>}
          {a && (
            <>
              <div className="row">
                <span className="muted">Name</span>
                <input className="text-input" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="note">
                {a.kind === 'vrm' ? 'VRM humanoid: bones are mapped automatically.' : 'Bones were matched by name.'}{' '}
                {missing.length ? `${17 - missing.length} of 17 joints mapped. Fill in the rest below or leave them empty (those parts stay in the rest pose).` : 'All 17 joints are mapped.'}
              </div>
              <button className="btn" style={{ marginTop: 8 }} onClick={() => setShowMap(!showMap)}>
                {showMap ? 'Hide bone mapping' : 'Edit bone mapping'}
              </button>
              {showMap && (
                <div className="map-list">
                  {JOINTS.map((j) => (
                    <div key={j} className="row">
                      <span className="mono small">{j}</span>
                      <select value={map[j] ?? ''} onChange={(e) => setMap({ ...map, [j as JointName]: e.target.value || undefined })}>
                        <option value="">(none)</option>
                        {a.nodeNames.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
              <div className="note">Imported character files are stored only in this browser (IndexedDB). The .mdoll.json project references them by id and embeds nothing heavy, so on another computer import the same file again.</div>
              {!hasHips && <div className="note err">The hips joint needs a bone.</div>}
              <div className="btn-row">
                <button className="btn" onClick={() => setFile(null)}>Cancel</button>
                <button className="btn primary" disabled={busy || !hasHips} onClick={doImport}>{busy ? 'Importing...' : 'Import'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

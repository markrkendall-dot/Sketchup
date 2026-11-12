import { useCallback, useEffect, useRef, useState } from 'react';
import { library, type LibraryEntry } from '../io/library';
import { usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { deleteProperty, duplicateProperty, exportProperty, flushAutosave, newPlan, openPlanFile, openProperty, renameProperty } from './fileActions';
import { focusCanvas } from './focus';

const close = () => {
  useUiStore.getState().setLibraryOpen(false);
  focusCanvas();
};

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * The property library (toolbar "Properties"): every plan kept in this browser, most recently
 * modified first, the open one marked. Open, New and Import switch to a property (and clear the
 * undo history); Duplicate, Rename, Export and Delete work on any of them.
 */
export function PropertiesDialog() {
  const open = useUiStore((s) => s.libraryOpen);
  const currentId = usePlanStore((s) => s.plan.id);
  const currentName = usePlanStore((s) => s.plan.name);
  const currentModified = usePlanStore((s) => s.plan.modifiedAt);
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      await flushAutosave();
      setEntries(await library.list());
      setError(null);
    } catch (err) {
      setError(`Could not read the properties in this browser: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setRenaming(null);
      return;
    }
    ref.current?.focus();
    void refresh();
  }, [open, refresh]);

  if (!open) return null;

  /** Run an action with the buttons disabled, then list again; close when it opened a property. */
  const run = async (fn: () => Promise<unknown>, closeAfter = false) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
    if (closeAfter) close();
    else await refresh();
  };

  // The open plan's name and time come from the editor (they change before the next autosave).
  const shown = (entries ?? [])
    .map((e) => (e.id === currentId ? { ...e, name: currentName, modifiedAt: currentModified } : e))
    .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
  if (entries && !shown.some((e) => e.id === currentId)) shown.unshift({ id: currentId, name: currentName, modifiedAt: currentModified });

  const commitRename = async () => {
    if (!renaming) return;
    const { id, value } = renaming;
    setRenaming(null);
    await run(() => renameProperty(id, value));
  };

  return (
    <div className="help-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="help-dialog library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="help-head">
          <h2 id="library-title">Properties</h2>
          <div className="library-head-actions">
            <button disabled={busy} onClick={() => void run(newPlan, true)} title="Start a new, empty property; this one stays in the list">
              New
            </button>
            <button disabled={busy} onClick={() => fileRef.current?.click()} title="Add a plan file (.json) to the list and open it">
              Import JSON
            </button>
            <button onClick={close} aria-label="Close properties">
              Close <kbd>Esc</kbd>
            </button>
          </div>
        </div>
        <p className="help-note library-note">Kept in this browser only. Export a property to keep a copy somewhere safe.</p>
        {error && <p className="library-error">{error}</p>}
        {entries === null && !error ? (
          <p className="help-note">Loading...</p>
        ) : (
          <ul className="library-list" aria-label="Properties in this browser">
            {shown.map((e) => {
              const current = e.id === currentId;
              return (
                <li key={e.id} className={current ? 'library-row current' : 'library-row'} aria-current={current || undefined}>
                  <div className="library-name">
                    {renaming?.id === e.id ? (
                      <input
                        aria-label="New name"
                        autoFocus
                        value={renaming.value}
                        onChange={(ev) => setRenaming({ id: e.id, value: ev.target.value })}
                        onBlur={() => void commitRename()}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') void commitRename();
                          if (ev.key === 'Escape') {
                            ev.stopPropagation();
                            setRenaming(null);
                          }
                        }}
                      />
                    ) : (
                      <strong>{e.name}</strong>
                    )}
                    <small>
                      {current ? 'Open now. ' : ''}Changed {when(e.modifiedAt)}
                    </small>
                  </div>
                  <div className="group library-actions" role="group" aria-label={`${e.name} actions`}>
                    <button disabled={busy || current} onClick={() => void run(() => openProperty(e.id), true)}>
                      Open
                    </button>
                    <button disabled={busy} onClick={() => void run(() => duplicateProperty(e.id))}>
                      Duplicate
                    </button>
                    <button disabled={busy} onClick={() => setRenaming({ id: e.id, value: e.name })}>
                      Rename
                    </button>
                    <button disabled={busy} onClick={() => void run(() => exportProperty(e.id))} title="Download as a .json file">
                      Export JSON
                    </button>
                    <button disabled={busy} className="library-delete" onClick={() => void run(() => deleteProperty(e.id, e.name))}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            ev.target.value = '';
            if (file) void run(() => openPlanFile(file), true);
          }}
        />
      </div>
    </div>
  );
}

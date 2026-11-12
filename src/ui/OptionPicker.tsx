import { useEffect, useRef, useState } from 'react';
import { resolveOptionId } from '../derive/optionView';
import { setActiveOption, setViewMode } from '../editor2d/tools';
import { nextOptionName } from '../model/optionOps';
import type { Id } from '../model/types';
import { getPlan, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { focusCanvas } from './focus';

/** What the picker's name field is for. */
type Editing = { kind: 'new' | 'duplicate' | 'rename'; value: string } | null;

/**
 * The design option picker (DESIGN.md "Design options"), beside the view switch: with one option
 * only an "+ Option" button; with more, the active option's name, opening a menu to switch to
 * another and to add, duplicate, rename or delete one. Switching is a view setting (not undone);
 * the edits are plan edits, one undo step each. Off in the Existing view, which has no options.
 */
export function OptionPicker() {
  const options = usePlanStore((s) => s.plan.options);
  const wanted = useUiStore((s) => s.activeOptionId);
  const existing = useUiStore((s) => s.viewMode === 'existing');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const ref = useRef<HTMLDivElement>(null);
  const activeId = resolveOptionId({ options }, wanted);
  const active = options.find((o) => o.id === activeId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditing(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setEditing(null);
    focusCanvas();
  };
  const switchTo = (id: Id) => {
    setActiveOption(id);
    close();
  };
  const notice = (text: string) => useUiStore.getState().setNotice({ text, error: false });

  const commit = () => {
    if (!editing) return;
    const store = usePlanStore.getState();
    const name = editing.value.trim();
    if (editing.kind === 'rename') {
      if (activeId && name) store.renameOption(activeId, name);
      close();
      return;
    }
    const id = editing.kind === 'new' ? store.addOption(name) : activeId ? store.duplicateOption(activeId, name) : null;
    if (!id) return close();
    const made = getPlan().options.find((o) => o.id === id);
    // A new option is shown at once (the Proposed view if the Existing one was showing).
    if (useUiStore.getState().viewMode === 'existing') setViewMode('proposed');
    switchTo(id);
    notice(editing.kind === 'new' ? `Added ${made?.name}: it has the changes every option shares; draw its own as new work` : `Added ${made?.name}, a copy of ${active?.name}`);
  };

  const remove = () => {
    if (!active || options.length < 2) return;
    if (!window.confirm(`Delete ${active.name} and the new work and demolition that only it has? (Undo brings it back.)`)) return;
    const name = active.name;
    if (usePlanStore.getState().deleteOption(active.id)) notice(`Deleted ${name}`);
    close();
  };

  const menuNameField = editing && (
    <form
      className="option-name"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <label>
        {editing.kind === 'rename' ? 'Rename to' : editing.kind === 'new' ? 'New option' : `Copy of ${active?.name}`}
        <input
          autoFocus
          aria-label="Option name"
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(null);
            }
            e.stopPropagation();
          }}
        />
      </label>
      <button type="submit">OK</button>
    </form>
  );

  const single = options.length < 2;
  return (
    <div
      className="menu-host option-picker"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      {single ? (
        <button
          className={`option-add${open ? ' active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Design options: compare alternative proposals for the same building (two kitchen layouts, an addition with or without a second storey)"
          onClick={() => {
            setOpen((o) => !o);
            setEditing(null);
          }}
        >
          + Option
        </button>
      ) : (
        <button
          className={`option-current${open ? ' active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Design option: ${active?.name ?? ''}`}
          disabled={existing}
          title={existing ? 'The Existing view shows the house as it stands, the same in every option: switch to Proposed or All to choose one' : 'Design option shown in Proposed and All, and given to new work and demolition'}
          onClick={() => {
            setOpen((o) => !o);
            setEditing(null);
          }}
        >
          {active?.name ?? 'Option'} <span aria-hidden="true">▾</span>
        </button>
      )}
      {open && (
        <div className="menu option-menu" role="menu" aria-label="Design options">
          {!single &&
            options.map((o) => (
              <button key={o.id} role="menuitemradio" aria-checked={o.id === activeId} className={o.id === activeId ? 'active' : ''} onClick={() => switchTo(o.id)}>
                {o.id === activeId ? '● ' : '○ '}
                {o.name}
              </button>
            ))}
          {menuNameField}
          {!editing && (
            <>
              <button role="menuitem" onClick={() => setEditing({ kind: 'new', value: nextOptionName({ options }) })}>
                New option
                <small>Starts with only the changes every option shares</small>
              </button>
              <button role="menuitem" onClick={() => setEditing({ kind: 'duplicate', value: nextOptionName({ options }) })}>
                Duplicate {active?.name}
                <small>A copy of its new work and demolition to change on its own</small>
              </button>
              {!single && (
                <>
                  <button role="menuitem" onClick={() => setEditing({ kind: 'rename', value: active?.name ?? '' })}>
                    Rename {active?.name}
                  </button>
                  <button role="menuitem" onClick={remove}>
                    Delete {active?.name}
                    <small>Removes the new work only it has and undoes its demolition</small>
                  </button>
                </>
              )}
            </>
          )}
          <p className="menu-note">
            {single
              ? 'With one option, everything drawn as new or marked demolish is the proposal. Add an option to draw an alternative.'
              : 'New work and demolition go to the option shown. Work from before the options were added is in every option.'}
          </p>
        </div>
      )}
    </div>
  );
}

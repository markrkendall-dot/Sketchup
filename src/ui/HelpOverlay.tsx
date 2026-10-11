import { useEffect, useRef } from 'react';
import { useUiStore } from '../store/uiStore';
import { KEY_BINDINGS, KEY_GROUPS } from './keymap';

/** Keyboard help (? or the toolbar's ? button), listed from the same table the hotkeys run from. */
export function HelpOverlay() {
  const open = useUiStore((s) => s.helpOpen);
  const close = () => useUiStore.getState().setHelpOpen(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="help-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1} ref={ref}>
        <div className="help-head">
          <h2 id="help-title">Keyboard shortcuts</h2>
          <button onClick={close} aria-label="Close help">
            Close <kbd>Esc</kbd>
          </button>
        </div>
        <div className="help-columns">
          {KEY_GROUPS.map((group) => (
            <section key={group} className="help-group">
              <h3>{group}</h3>
              <table>
                <tbody>
                  {KEY_BINDINGS.filter((b) => b.group === group).map((b) => (
                    <tr key={b.keys + b.label}>
                      <th scope="row">
                        <kbd>{b.keys}</kbd>
                      </th>
                      <td>{b.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <p className="help-note">
          Shortcuts do nothing while you type in a field (Enter there commits and hands the keys back to the plan), and
          letters are ignored while a typed length is being entered.
        </p>
      </div>
    </div>
  );
}

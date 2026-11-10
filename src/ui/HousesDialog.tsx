import { useEffect, useMemo, useRef, useState } from 'react';
import { houseLabel, saveHouse, searchHouses, type HouseEntry } from '../io/library';
import { getPlan, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { houseList, openHouse, planHasContent, removeHouse } from './fileActions';
import { focusCanvas } from './focus';

function savedOn(entry: HouseEntry): string {
  if (entry.bundled) return 'comes with HomePlan';
  const d = new Date(entry.modifiedAt);
  return Number.isNaN(d.getTime()) ? '' : `changed ${d.toLocaleDateString()}`;
}

/**
 * The Houses list (toolbar: Houses): every plan kept in this browser, found by typing part of its
 * address or name. The plan on screen gets its address here.
 */
export function HousesDialog() {
  const open = useUiStore((s) => s.housesOpen);
  const planId = usePlanStore((s) => s.plan.id);
  const planName = usePlanStore((s) => s.plan.name);
  const planAddress = usePlanStore((s) => s.plan.address ?? '');
  const [entries, setEntries] = useState<HouseEntry[]>([]);
  const [query, setQuery] = useState('');
  const [address, setAddress] = useState(planAddress);
  const searchRef = useRef<HTMLInputElement>(null);

  const close = () => {
    useUiStore.getState().setHousesOpen(false);
    focusCanvas();
  };
  const refresh = () => void houseList().then(setEntries);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setAddress(getPlan().address ?? '');
    searchRef.current?.focus();
    // The plan on screen is listed as it is now, not as the last autosave left it.
    const plan = getPlan();
    void (planHasContent(plan) ? saveHouse(plan).catch(() => undefined) : Promise.resolve()).then(refresh);
  }, [open]);
  useEffect(() => setAddress(planAddress), [planAddress]);

  const found = useMemo(() => searchHouses(entries, query), [entries, query]);
  if (!open) return null;

  const commitAddress = () => {
    const v = address.trim();
    if (v === planAddress) return;
    usePlanStore.getState().setPlanAddress(v);
    const plan = getPlan();
    if (planHasContent(plan)) void saveHouse(plan).catch(() => undefined).then(refresh);
  };
  const pick = async (entry: HouseEntry) => {
    if (await openHouse(entry)) close();
  };

  return (
    <div className="help-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="help-dialog houses-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="houses-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="help-head">
          <h2 id="houses-title">Houses</h2>
          <button onClick={close} aria-label="Close Houses">
            Close <kbd>Esc</kbd>
          </button>
        </div>
        <label className="houses-field">
          <span>Address of the plan on screen ({planName})</span>
          <input
            aria-label="Address of this plan"
            placeholder="Street address, e.g. 12 Main St, Town"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={commitAddress}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        <label className="houses-field">
          <span>Find a house</span>
          <input
            ref={searchRef}
            type="search"
            aria-label="Find a house by address or name"
            placeholder="Type part of an address or a name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && found[0]) void pick(found[0]);
            }}
          />
        </label>
        <ul className="houses-list">
          {found.map((entry) => (
            <li key={entry.id} className={entry.id === planId ? 'current' : ''}>
              <button className="house-open" onClick={() => void pick(entry)} title={`Open ${houseLabel(entry)}`}>
                <strong>{houseLabel(entry)}</strong>
                <span>
                  {entry.address ? `${entry.name}, ` : ''}
                  {entry.id === planId ? 'open now' : savedOn(entry)}
                </span>
              </button>
              {!entry.bundled && entry.id !== planId && (
                <button className="house-remove" aria-label={`Remove ${houseLabel(entry)}`} onClick={() => void removeHouse(entry).then((gone) => gone && refresh())}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {found.length === 0 && <p className="help-note">{entries.length === 0 ? 'No houses yet. A plan is listed here once something is drawn in it.' : 'No house matches that.'}</p>}
        <p className="help-note">
          Houses are kept in this browser only. Switching keeps the plan on screen in the list. Use Save to keep a file as
          well.
        </p>
      </div>
    </div>
  );
}

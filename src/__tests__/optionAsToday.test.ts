import { beforeEach, describe, expect, it } from 'vitest';
import { proposedLookIn, roomFinishesIn, viewPlanOf } from '../derive/optionView';
import { createEmptyPlan, defaultLevelId, migrate, SCHEMA_VERSION } from '../model/plan';
import type { Room } from '../model/types';
import { clearHistory, undo, usePlanStore } from '../store/planStore';

const store = () => usePlanStore.getState();
const plan = () => store().plan;

describe('"as today" in one option over a shared proposed finish', () => {
  let L = '';
  let a = '';
  let b = '';
  let roomId = '';
  beforeEach(() => {
    store().setPlan(createEmptyPlan('Today', 'single'));
    L = defaultLevelId(plan());
    clearHistory();
    a = plan().options[0].id;
    b = store().addOption('B')!;
    roomId = store().addRoom(L, { name: 'Kitchen', anchor: { x: 10, y: 10 } })!;
    store().updateRoom(L, roomId, { proposedFloor: { finish: 'tile' }, proposedWall: { finish: 'pine' } });
    store().updateProposedLook({ wallFinish: 'shingle', wallColor: '#112233', roofFinish: 'seam', trimColor: '#aa0000', shutters: false });
  });

  it('distinguishes inheriting the shared value from keeping today in a room', () => {
    const room = (): Room => plan().levels[L].rooms[roomId];
    // Inherit: absent.
    expect(roomFinishesIn(room(), b).proposedFloor).toEqual({ finish: 'tile' });
    store().updateRoomOptionFinishes(L, roomId, b, { proposedFloor: 'today' });
    expect(room().optionFinishes?.[b]).toEqual({ proposedFloor: 'today' });
    expect(roomFinishesIn(room(), b)).toEqual({ proposedFloor: undefined, proposedWall: { finish: 'pine' } });
    expect(roomFinishesIn(room(), a).proposedFloor).toEqual({ finish: 'tile' });
    expect(viewPlanOf(plan(), b).levels[L].rooms[roomId].proposedFloor).toBeUndefined();
    // Back to the shared one; one undo step each.
    store().updateRoomOptionFinishes(L, roomId, b, { proposedFloor: undefined });
    expect(room().optionFinishes).toBeUndefined();
    undo();
    expect(room().optionFinishes?.[b]).toEqual({ proposedFloor: 'today' });
  });

  it('keeps today\'s siding (and its colour), roof, trim and shutters in one option', () => {
    store().updateOptionLook(b, { wallFinish: 'today', trimColor: 'today', shutters: 'today' });
    const look = proposedLookIn(plan(), b)!;
    expect(look.wallFinish).toBeUndefined();
    expect(look.wallColor).toBeUndefined();
    expect(look.trimColor).toBeUndefined();
    expect(look.shutters).toBeUndefined();
    expect(look.roofFinish).toBe('seam');
    expect(proposedLookIn(plan(), a)).toEqual(plan().proposedLook);
    // An option's own colour over today's siding finish stays.
    store().updateOptionLook(b, { wallColor: '#445566' });
    expect(proposedLookIn(plan(), b)!.wallColor).toBe('#445566');
    // Everything as today: no look at all.
    store().updateOptionLook(b, { wallColor: 'today', roofFinish: 'today', boardColor: 'today', sashColor: 'today' });
    expect(proposedLookIn(plan(), b)).toBeUndefined();
  });

  it('survives a save and load; "today" in the shared look or a broken value is dropped; no schema change', () => {
    store().updateRoomOptionFinishes(L, roomId, b, { proposedWall: 'today' });
    store().updateOptionLook(b, { roofFinish: 'today' });
    const doc = JSON.parse(JSON.stringify(plan()));
    doc.proposedLook.trimColor = 'today';
    doc.options[1].proposedLook.wallFinish = 'yesterday';
    doc.levels[L].rooms[roomId].optionFinishes[b].proposedFloor = 'tomorrow';
    const back = migrate(doc);
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);
    expect(back.options[1].proposedLook).toEqual({ roofFinish: 'today' });
    expect(back.proposedLook?.trimColor).toBeUndefined();
    expect(back.levels[L].rooms[roomId].optionFinishes?.[b]).toEqual({ proposedWall: 'today' });
  });
});

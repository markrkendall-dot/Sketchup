// The draft "Still to measure" list for a scan's MEASURE.md (in the style of docs/kitchen/MEASURE.md):
// what the scan read, as the number to check with a tape. Claude edits it after comparing the
// draft with the keyframe photos. Pure: the draft in, Markdown out.
import { formatLength } from '../../src/model/units';
import { APPLIANCE_KINDS, type DraftFixture, type DraftOpening, type DraftRun, type DraftWall, type ScanDraft } from './scanToPlan';

/** A length as feet and inches to the nearest 1/8, with the inches after it: `13'-0" (156")`. */
export const feetInches = (inches: number): string => {
  const whole = Math.round(inches * 8) / 8;
  return whole < 12 ? formatLength(whole, 8) : `${formatLength(whole, 8)} (${trimInches(whole)}")`;
};
function trimInches(v: number): string {
  const whole = Math.floor(v);
  const frac = Math.round((v - whole) * 8);
  if (frac === 0) return `${whole}`;
  const g = gcd(frac, 8);
  return `${whole} ${frac / g}/${8 / g}`;
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const flagged = (c: { confidence: string }): boolean => c.confidence !== 'high';
/** Flagged (below high confidence) first, each group keeping its order. */
const flaggedFirst = <T extends { confidence: string }>(items: T[]): T[] => [...items.filter(flagged), ...items.filter((x) => !flagged(x))];
const flag = (c: { confidence: string }): string => (flagged(c) ? ` **Check first: ${c.confidence} confidence.**` : '');

const KIND_NAME: Partial<Record<DraftFixture['kind'], string>> = {
  fridge: 'Refrigerator',
  range: 'Range',
  dishwasher: 'Dishwasher',
  wallOven: 'Wall oven',
  cooktop: 'Cooktop',
  microwave: 'Microwave',
  hood: 'Hood',
  washer: 'Washer',
  dryer: 'Dryer',
};

/** What a scan cannot see, the closing section of every list. */
export const SCAN_CANNOT_SEE: readonly string[] = [
  'Cabinet door and drawer splits: how many doors and drawers in each cabinet, and each one\'s width (the scan sees each cabinet as a plain box).',
  'Toe kicks: height and setback.',
  'Counter overhang past the cabinet fronts and ends, and the counter\'s thickness.',
  'Backsplash height (counter to the top of the tile) and how far along it runs.',
  'Appliance model sizes: the make and model of each appliance, or width, depth with and without doors, and height.',
  'Outlets and switches on each wall: rough positions are enough.',
  'Plumbing and gas: where the sink drain and supplies, the dishwasher hookup and any gas line come through.',
  'Window and door trim: casing width, and the wall thickness through each opening (trim edge to trim edge).',
];

/**
 * The "Still to measure" list: the room's overall size and ceiling (always, they catch drift),
 * each wall face to face, each opening, each cabinet run and each appliance (the ones scanned
 * below high confidence first within each group), then what a scan cannot see.
 */
export function tapeList(draft: ScanDraft): string {
  const wallById = new Map(draft.walls.map((w) => [w.id, w]));
  const wallName = (w: DraftWall): string => `${w.id.replace('wall-', 'Wall ')} (${w.side})`;
  const neighbour = (w: DraftWall, end: 'a' | 'b'): DraftWall | undefined => {
    const p = end === 'a' ? w.a : w.b;
    return draft.walls.find((x) => x.id !== w.id && ((x.a.x === p.x && x.a.y === p.y) || (x.b.x === p.x && x.b.y === p.y)));
  };
  const cornerName = (w: DraftWall, end: 'a' | 'b'): string => {
    const n = neighbour(w, end);
    return n ? `the corner with ${wallName(n)}` : `the ${end === 'a' ? 'start' : 'end'} of the wall`;
  };

  const out: string[] = [];
  let n = 0;
  const item = (text: string) => out.push(`${++n}. ${text}`);
  const section = (title: string) => out.push('', `### ${title}`, '');

  out.push(`# ${draft.name}: what to measure`, '');
  const when = [draft.scan.date && `scanned ${draft.scan.date.slice(0, 10)}`, draft.scan.device && `on ${draft.scan.device}`].filter(Boolean).join(' ');
  out.push(
    `Drafted by \`npm run scan\` from the scan${when ? ` ${when}` : ''}.`,
    '',
    'Each line gives what the scan read, to the nearest 1/8", as the number to check: tape it and',
    'correct the hand edited plan script, not the generated scan module. A scan is a draft (roughly 1',
    'to 5 cm per wall, and errors add up); the tape is the truth.',
    '"Top", "right", "bottom" and "left" are as the draft plan shows the room. Walls are numbered',
    'clockwise from the top wall. Lines marked **Check first** were scanned below high confidence.',
  );
  out.push('', '## Still to measure');

  section('The room (always: these catch drift)');
  item(`Room width, left wall to right wall, face to face: scan reads ${feetInches(draft.room.width)}.`);
  item(`Room depth, top wall to bottom wall, face to face: scan reads ${feetInches(draft.room.depth)}.`);
  item(`Ceiling height, floor to ceiling: scan reads ${feetInches(draft.room.ceiling)}. If it differs across the room, each.`);

  if (draft.walls.length) {
    section('Walls, face to face');
    for (const w of flaggedFirst(draft.walls)) {
      const a = neighbour(w, 'a');
      const b = neighbour(w, 'b');
      const span = a && b ? `from ${wallName(a)} to ${wallName(b)}` : 'end to end';
      item(`${wallName(w)}, ${span}: scan reads ${feetInches(w.length)}.${w.squared ? '' : ` Not square to the room (${Math.abs(w.raw.angleOffAxis)} degrees off): check its angle.`}${flag(w)}`);
    }
  }

  if (draft.openings.length) {
    section('Openings (inside the trim)');
    const word: Record<DraftOpening['type'], string> = { door: 'Door', window: 'Window', passage: 'Opening' };
    for (const o of flaggedFirst(draft.openings)) {
      const w = wallById.get(o.wallId)!;
      const sill = o.type === 'window' ? `, sill ${feetInches(o.sill)} above the floor` : '';
      item(
        `${word[o.type]} ${o.id.split('-')[1]} in ${wallName(w)}: width ${feetInches(o.width)}, height ${feetInches(o.height)}${sill}; its near edge ${feetInches(o.nearCorner.distance)} from ${cornerName(w, o.nearCorner.end)}.${flag(o)}`,
      );
    }
  }

  const fixtureById = new Map(draft.fixtures.map((f) => [f.id, f]));
  if (draft.runs.length) {
    section('Cabinet runs');
    for (const r of flaggedFirst<DraftRun>(draft.runs)) {
      const w = wallById.get(r.wallId)!;
      const what = r.fixtures.map((id) => fixtureById.get(id)!.kind).join(', ');
      item(`${r.tier === 'base' ? 'Base run' : 'Wall cabinets'} on ${wallName(w)} (${r.fixtures.length} piece${r.fixtures.length === 1 ? '' : 's'}: ${what}): total length ${feetInches(r.length)}, starting ${feetInches(r.start)} from ${cornerName(w, 'a')}.${flag(r)}`);
    }
  }

  const appliances = draft.fixtures.filter((f) => APPLIANCE_KINDS.includes(f.kind));
  if (appliances.length) {
    section('Appliances');
    for (const f of flaggedFirst(appliances)) {
      const where = f.wallId ? ` on ${wallName(wallById.get(f.wallId)!)}` : '';
      item(`${KIND_NAME[f.kind] ?? f.kind}${where}: width ${feetInches(f.width)}.${flag(f)}`);
    }
  }

  section('What a scan cannot see');
  for (const s of SCAN_CANNOT_SEE) item(s);

  if (draft.notes.length) {
    out.push('', '## Notes from the conversion', '');
    for (const s of draft.notes) out.push(`- ${s}`);
  }
  return out.join('\n') + '\n';
}

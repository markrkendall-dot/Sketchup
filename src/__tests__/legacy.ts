// Test helper: a current plan written out as a file of an older schema version (before 9 a plan
// had one stack of levels: `levelOrder` and `baseFloorElevation` on the plan, no structures; before
// 10 it had no design options and nothing was tagged for one).
import type { Plan } from '../model/types';

/** A JSON copy of a one-structure plan in the shape of schema `version` (9 or older). */
export function legacyDoc(plan: Plan, version: number): ReturnType<typeof JSON.parse> {
  const doc = JSON.parse(JSON.stringify(plan));
  delete doc.options;
  if (version >= 9) return { ...doc, schemaVersion: version };
  const main = doc.structures[doc.structureOrder[0]];
  delete doc.structures;
  delete doc.structureOrder;
  return { ...doc, schemaVersion: version, levelOrder: main.levelOrder, baseFloorElevation: main.baseFloorElevation };
}

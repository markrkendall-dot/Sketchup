// The plan's code checks (DESIGN.md "Checks"): what in the proposed design needs a second look,
// as a list of issues with a place on the plan and the element they are about. Pure; memoized per
// plan object, so every caller of one plan shares one list.
//
// The checks always judge the house after the work (the proposed view), whatever view is showing:
// the existing house is recorded, not designed. Each family of checks lives in its own file
// (guardChecks.ts, stairChecks.ts, ...) and returns issues; this file gathers, orders and indexes them.

import type { Id, Plan, Vec2 } from '../model/types';
import { guardIssues } from './guardChecks';
import { stairIssues } from './stairChecks';

export type Severity = 'error' | 'warning' | 'info';
export type IssueCategory = 'guard' | 'stair' | 'structure';

/** The ids an issue is about, by kind (the selection's kinds). */
export interface IssueTarget {
  walls?: Id[];
  openings?: Id[];
  stairs?: Id[];
  decks?: Id[];
  floorOpenings?: Id[];
}

export interface Issue {
  /** Stable across edits that leave the issue in place: code, level and target ids. */
  id: string;
  code: string;
  severity: Severity;
  category: IssueCategory;
  levelId: Id;
  /** Where the plan marks it (world inches). */
  at: Vec2;
  /** The element's outline, drawn when the issue is picked in the list. */
  outline?: Vec2[];
  message: string;
  /** The code section, e.g. "R321.1 (was R312.1.1)". */
  ref: string;
  target: IssueTarget;
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const CATEGORY_ORDER: Record<IssueCategory, number> = { guard: 0, stair: 1, structure: 2 };

/** The id an issue gets from its code, level and target ids. */
export function issueId(code: string, levelId: Id, target: IssueTarget): string {
  const ids = Object.entries(target)
    .filter(([, v]) => v && v.length)
    .map(([k, v]) => `${k}:${[...(v as Id[])].sort().join(',')}`)
    .sort()
    .join(';');
  return `${code}|${levelId}|${ids}`;
}

const cache = new WeakMap<Plan, readonly Issue[]>();

/** Every issue in the plan, ordered by level (bottom up), severity, category, then message. */
export function getIssues(plan: Plan): readonly Issue[] {
  const hit = cache.get(plan);
  if (hit) return hit;
  const levelIndex = new Map(plan.levelOrder.map((id, i) => [id, i]));
  const issues = [...guardIssues(plan), ...stairIssues(plan)].sort(
    (a, b) =>
      (levelIndex.get(a.levelId) ?? 0) - (levelIndex.get(b.levelId) ?? 0) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
      a.message.localeCompare(b.message),
  );
  cache.set(plan, issues);
  return issues;
}

/** The issues on a level about any of the target's ids. */
export function issuesFor(issues: readonly Issue[], levelId: Id, target: IssueTarget): Issue[] {
  return issues.filter(
    (i) =>
      i.levelId === levelId &&
      (Object.keys(target) as (keyof IssueTarget)[]).some((k) => target[k]?.some((id) => i.target[k]?.includes(id))),
  );
}

/** Errors and warnings (what the status bar counts), and notes. */
export function issueCounts(issues: readonly Issue[]): { toCheck: number; notes: number } {
  let toCheck = 0;
  for (const i of issues) if (i.severity !== 'info') toCheck++;
  return { toCheck, notes: issues.length - toCheck };
}

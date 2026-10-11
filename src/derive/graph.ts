import type { Id, Level, Wall } from '../model/types';

export interface Graph {
  /** nodeId -> ids of incident walls. */
  adjacency: Map<Id, Id[]>;
  degree: (nodeId: Id) => number;
}

// Keyed by the walls record: node moves leave it untouched (immer structural sharing), so the
// graph survives drags and is rebuilt only when walls are added, removed or reconnected.
const cache = new WeakMap<Level['walls'], Graph>();

function buildGraph(walls: Record<Id, Wall>): Graph {
  const adjacency = new Map<Id, Id[]>();
  const push = (n: Id, w: Id) => {
    const list = adjacency.get(n);
    if (list) list.push(w);
    else adjacency.set(n, [w]);
  };
  for (const w of Object.values(walls)) {
    push(w.a, w.id);
    push(w.b, w.id);
  }
  return { adjacency, degree: (id) => adjacency.get(id)?.length ?? 0 };
}

export function getGraph(level: Level): Graph {
  let g = cache.get(level.walls);
  if (!g) {
    g = buildGraph(level.walls);
    cache.set(level.walls, g);
  }
  return g;
}

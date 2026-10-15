import type { BufferGeometry } from 'three';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureSymbol } from '../derive/casework';
import { furnitureSolids, furnitureSymbol, solidExtent } from '../derive/furniture';
import { buildFixtureParts, clearMeshCache, getLevelMeshes } from '../derive/meshes';
import { buildExportScene, disposeExportScene } from '../io/export3d';
import { levelDrawingBounds, planSvg } from '../io/exportPlan';
import { pointInPolygon } from '../model/geometry';
import { bedSizeOf, FABRIC_IDS, FABRICS, FURNITURE, FURNITURE_PIECES, furnitureDefaults, furnitureNameOf, furniturePlanLabel, WOOD_IDS, WOODS } from '../model/furniture';
import { createEmptyPlan, defaultLevelId, fixtureProblem, migrate } from '../model/plan';
import type { Fixture, FurniturePiece, Id } from '../model/types';
import { hitTest } from '../editor2d/tools/selectTool';
import { clearHistory, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { BUFFALO_CHECK, clampWarmth, fabricPixels, paintPixels, PINE_MAX_WARMTH, woodPixels } from '../view3d/proceduralTextures';
import { PX_PER_INCH, TEXTURE_PX } from '../view3d/textures';
import { furnitureMaterial, stairPartMaterial } from '../view3d/materials';

const store = () => usePlanStore.getState();

const piece = (p: FurniturePiece, over: Partial<Fixture> = {}): Fixture => ({
  id: over.id ?? `f-${p}`,
  kind: 'furniture',
  piece: p,
  origin: { x: 0, y: 0 },
  direction: 90,
  ...furnitureDefaults(p),
  phase: 'existing',
  ...over,
});

/** Every directed edge of the mesh is matched by its reverse: a closed, consistently wound surface. */
function closedEdges(g: BufferGeometry): boolean {
  const pos = g.getAttribute('position');
  const key = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((c) => Math.round(c * 1e3)).join(',');
  const count = new Map<string, number>();
  for (let t = 0; t < pos.count; t += 3) {
    for (let i = 0; i < 3; i++) {
      const a = key(t + i);
      const b = key(t + ((i + 1) % 3));
      if (a !== b) count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    if (count.get(`${b}>${a}`) !== n) return false;
  }
  return true;
}

describe('the furniture catalogue', () => {
  it('gives every piece a label, a category, a stock size above its minimum, and a known wood and fabric', () => {
    for (const p of FURNITURE_PIECES) {
      const s = FURNITURE[p];
      expect(s.label.length).toBeGreaterThan(0);
      for (const k of ['width', 'depth', 'height'] as const) {
        expect(s.size[k]).toBeGreaterThan(0);
        expect(s.min[k]).toBeLessThanOrEqual(s.size[k]);
      }
      expect(WOOD_IDS).toContain(s.wood);
      if (s.fabric) expect(FABRIC_IDS).toContain(s.fabric);
    }
    for (const w of WOOD_IDS) expect(WOODS[w].color).toMatch(/^#[0-9a-f]{6}$/);
    for (const f of FABRIC_IDS) expect(FABRICS[f].colors.length).toBeGreaterThan(0);
  });

  it('knows a bed by its width: a full is 58" with its frame, a queen 64", a king 80"', () => {
    expect(bedSizeOf(58)).toBe('full');
    expect(bedSizeOf(64)).toBe('queen');
    expect(bedSizeOf(80)).toBe('king');
    expect(bedSizeOf(78)).toBe('king');
    expect(bedSizeOf(70)).toBeNull();
    expect(furnitureDefaults('bed', 'full')).toMatchObject({ width: 58, depth: 79 });
    expect(furnitureNameOf(piece('bed', { width: 64 }))).toBe('Queen bed');
    expect(furnitureNameOf(piece('bed', { width: 58 }))).toBe('Full bed');
    expect(furnitureNameOf(piece('desk', { label: 'Writing desk' }))).toBe('Writing desk');
    expect(furniturePlanLabel(piece('diningChair'))).toBeNull();
    expect(furniturePlanLabel(piece('sofa'))).toBe('Sofa');
  });
});

describe('furniture solids', () => {
  it('keep every piece inside its footprint and height, at its stock, smallest and doubled sizes and in every wood', () => {
    for (const p of FURNITURE_PIECES) {
      const s = FURNITURE[p];
      for (const size of [s.size, s.min, { width: s.size.width * 2, depth: s.size.depth * 2, height: s.size.height * 2 }]) {
        for (const wood of ['nordicPine', 'peeledLog'] as const) {
          const f = piece(p, { ...size, wood, elevation: 0 });
          const solids = furnitureSolids(f);
          expect(solids.length, p).toBeGreaterThan(0);
          for (const sol of solids) {
            const e = solidExtent(sol);
            for (const v of Object.values(e)) expect(Number.isFinite(v)).toBe(true);
            const tol = 1e-6;
            expect(e.s0, `${p} ${sol.part}`).toBeGreaterThanOrEqual(-size.width / 2 - tol);
            expect(e.s1, `${p} ${sol.part}`).toBeLessThanOrEqual(size.width / 2 + tol);
            expect(e.d0, `${p} ${sol.part}`).toBeGreaterThanOrEqual(-tol);
            expect(e.d1, `${p} ${sol.part}`).toBeLessThanOrEqual(size.depth + tol);
            expect(e.y0, `${p} ${sol.part}`).toBeGreaterThanOrEqual(-tol);
            expect(e.y1, `${p} ${sol.part}`).toBeLessThanOrEqual(size.height + tol);
          }
        }
      }
    }
  });

  it('builds a log bed of round logs and a pine one of sawn stock', () => {
    expect(furnitureSolids(piece('bed', { wood: 'peeledLog' })).some((s) => s.type === 'log')).toBe(true);
    expect(furnitureSolids(piece('bed', { wood: 'nordicPine' })).some((s) => s.type === 'log')).toBe(false);
    // A bed has its mattress and pillows in linen and its blanket in the fabric.
    const parts = new Set(furnitureSolids(piece('bed')).map((s) => s.part));
    expect([...parts].sort()).toEqual(['fabric', 'linen', 'wood']);
  });

  it('meshes every piece as closed parts with texture coordinates', () => {
    for (const p of FURNITURE_PIECES) {
      for (const wood of ['hickory', 'darkLog'] as const) {
        const parts = buildFixtureParts(piece(p, { wood, direction: 30 }));
        expect(parts.length, p).toBeGreaterThan(0);
        for (const part of parts) {
          expect(part.geometry.getAttribute('uv'), `${p} ${part.part}`).toBeDefined();
          expect(part.geometry.getAttribute('normal'), `${p} ${part.part}`).toBeDefined();
          expect(closedEdges(part.geometry), `${p} ${part.part} ${wood}`).toBe(true);
          part.geometry.dispose();
        }
      }
    }
  });

  it('draws a plan symbol inside the outline, naming the big pieces only', () => {
    for (const p of FURNITURE_PIECES) {
      const f = piece(p, { origin: { x: 100, y: 50 }, direction: 45 });
      const outline = fixtureSymbol(f).outline;
      const grow = outline.map((q) => ({ x: 100 + (q.x - 100) * 1.0001, y: 50 + (q.y - 50) * 1.0001 }));
      const sym = furnitureSymbol(f);
      const pts = [...sym.lines.flat(), ...sym.rects.flat(), ...sym.circles.map((c) => c.at)];
      for (const q of pts) expect(pointInPolygon(q, grow) || outline.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 1e-6), p).toBe(true);
    }
    expect(fixtureSymbol(piece('bed', { width: 64 })).label).toBe('Queen bed');
    expect(fixtureSymbol(piece('nightstand')).label).toBeNull();
  });
});

describe('furniture in the plan', () => {
  it('loads a piece with its wood and fabric, drops a piece it does not know and a bad wood alone', () => {
    const plan = createEmptyPlan();
    const lid = plan.levelOrder[0];
    const raw = JSON.parse(JSON.stringify(plan));
    raw.levels[lid].fixtures = {
      a: { ...piece('bed'), id: 'a', wood: 'hickory', fabric: 'buffaloRed' },
      b: { ...piece('bed'), id: 'b', piece: 'hammock' },
      c: { ...piece('sofa'), id: 'c', wood: 'teak', fabric: 'chintz' },
      d: { ...piece('desk'), id: 'd', kind: 'base', piece: 'desk', fabric: 'canvas', wood: 'nordicPine' },
    };
    const warn = console.warn;
    console.warn = () => {};
    const out = migrate(raw).levels[lid].fixtures;
    console.warn = warn;
    expect(out.a).toMatchObject({ kind: 'furniture', piece: 'bed', wood: 'hickory', fabric: 'buffaloRed' });
    expect(out.b).toBeUndefined();
    expect(out.c.piece).toBe('sofa');
    expect(out.c.wood).toBeUndefined();
    expect(out.c.fabric).toBeUndefined();
    // A cabinet keeps a wood, never a piece or a fabric.
    expect(out.d).toMatchObject({ kind: 'base', wood: 'nordicPine' });
    expect(out.d.piece).toBeUndefined();
    expect(out.d.fabric).toBeUndefined();
  });

  it('the store refuses furniture without a piece, and a fixture turned into a cabinet loses its piece', () => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    const lid = defaultLevelId(store().plan);
    expect(fixtureProblem({ ...piece('bed'), piece: undefined })).toMatch(/piece/);
    expect(store().addFixture(lid, { ...piece('bed'), piece: undefined })).toBeNull();
    const id = store().addFixture(lid, { ...piece('bed'), fabric: 'navajo' })!;
    expect(id).toBeTruthy();
    store().updateFixture(lid, id, { kind: 'base' });
    const f = store().plan.levels[lid].fixtures[id];
    expect(f.kind).toBe('base');
    expect(f.piece).toBeUndefined();
    expect(f.fabric).toBeUndefined();
  });
});

describe('the furniture layer', () => {
  let lid: Id;
  beforeEach(() => {
    store().setPlan(createEmptyPlan());
    clearHistory();
    clearMeshCache();
    lid = defaultLevelId(store().plan);
    useUiStore.getState().setShowFurniture(true);
  });
  afterAll(() => {
    useUiStore.getState().setShowFurniture(true);
    clearMeshCache();
  });

  it('toggles, and the Furniture tool turns it on', () => {
    useUiStore.getState().toggleFurniture();
    expect(useUiStore.getState().showFurniture).toBe(false);
    useUiStore.getState().setTool('furniture');
    expect(useUiStore.getState().showFurniture).toBe(true);
    useUiStore.getState().setTool('select');
  });

  it('hides furniture from picking, the plan export and its frame, and the 3D export when off; a rug is picked after the chair on it', () => {
    const rug = store().addFixture(lid, piece('rug', { origin: { x: 500, y: 470 }, width: 96, depth: 60 }))!;
    const chair = store().addFixture(lid, piece('diningChair', { origin: { x: 500, y: 490 } }))!;
    store().addFixture(lid, { kind: 'base', origin: { x: 0, y: 0 }, direction: 90, width: 36, depth: 24, height: 34.5, elevation: 0, phase: 'existing' });
    const plan = store().plan;
    const level = plan.levels[lid];
    expect(hitTest(level, { x: 500, y: 500 }, 1, 'all', { furniture: true })).toEqual({ kind: 'fixture', id: chair });
    expect(hitTest(level, { x: 470, y: 500 }, 1, 'all', { furniture: true })).toEqual({ kind: 'fixture', id: rug });
    expect(hitTest(level, { x: 500, y: 500 }, 1, 'all', { furniture: false })).toBeNull();
    const on = levelDrawingBounds(level, 'all', { furniture: true })!;
    const off = levelDrawingBounds(level, 'all', { furniture: false })!;
    expect(on.maxX).toBeGreaterThan(off.maxX);
    // The glyphs (the stylesheet names the class either way).
    expect(planSvg(plan, lid, 'all', { furniture: true })).toContain('class="fixture fixture-furniture');
    expect(planSvg(plan, lid, 'all', { furniture: false })).not.toContain('class="fixture fixture-furniture');
    const names = (show: boolean) => {
      const root = buildExportScene(plan, 'all', { hidden3dLevels: [], only3dActiveAndBelow: false, activeLevelId: lid, showFurniture: show });
      const out: string[] = [];
      root.traverse((o) => out.push(o.name));
      disposeExportScene(root);
      return out;
    };
    expect(names(true)).toContain('Furniture (rug)');
    expect(names(true)).toContain('Furniture (diningChair)');
    expect(names(false).some((n) => n.startsWith('Furniture'))).toBe(false);
    expect(names(false)).toContain('Cabinet (base)');
    expect(getLevelMeshes(plan, lid, 'all').fixtures.find((m) => m.id === rug)?.furniture).toMatchObject({ piece: 'rug', fabric: 'navajo', floorLayer: true });
  });
});

describe('textures', () => {
  const stats = (rgba: Uint8ClampedArray) => {
    let warm = 0;
    let maxWarm = -Infinity;
    let sum = 0;
    let sum2 = 0;
    const n = rgba.length / 4;
    for (let i = 0; i < rgba.length; i += 4) {
      const w = rgba[i] - rgba[i + 2];
      warm += w;
      maxWarm = Math.max(maxWarm, w);
      const l = 0.3 * rgba[i] + 0.59 * rgba[i + 1] + 0.11 * rgba[i + 2];
      sum += l;
      sum2 += l * l;
    }
    return { meanWarm: warm / n, maxWarm, sd: Math.sqrt(sum2 / n - (sum / n) ** 2), mean: sum / n };
  };

  it('keeps the Nordic pine cool (never amber), with visible grain, knots and seamless edges', () => {
    const { rgba, height } = woodPixels('pine', '#d8d0c2', 'floor');
    const s = stats(rgba);
    expect(s.maxWarm).toBeLessThanOrEqual(PINE_MAX_WARMTH + 2);
    expect(s.meanWarm).toBeLessThanOrEqual(PINE_MAX_WARMTH);
    expect(s.sd).toBeGreaterThan(3);
    // Some dark pixels: the knots and the joints.
    let dark = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 1] < s.mean * 0.75) dark++;
    expect(dark).toBeGreaterThan(0);
    expect(height).not.toBeNull();
    // Seamless: the left and right columns differ about as much as neighbouring columns do.
    const N = TEXTURE_PX;
    const col = (x: number, y: number) => rgba[(y * N + x) * 4 + 1];
    let edge = 0;
    let inner = 0;
    for (let y = 0; y < N; y++) {
      edge += Math.abs(col(0, y) - col(N - 1, y));
      inner += Math.abs(col(200, y) - col(201, y));
    }
    expect(edge).toBeLessThan(inner * 3);
    expect(clampWarmth([200, 180, 150], 30)).toEqual([190, 180, 160]);
  });

  it('draws the buffalo check in 3" squares, and every fabric, the linen, the cane, the books and paint', () => {
    const { rgba } = fabricPixels('buffaloRed');
    const N = TEXTURE_PX;
    // The colour changes across a check line, BUFFALO_CHECK inches apart.
    const px = Math.round(BUFFALO_CHECK * PX_PER_INCH);
    const at = (x: number) => rgba[((N - 10) * N + x) * 4];
    expect(Math.abs(at(px - 3) - at(px + 3))).toBeGreaterThan(20);
    expect(Math.abs(at(px - 3) - at(3 * px - 3))).toBeLessThan(25);
    for (const id of [...FABRIC_IDS, 'linen', 'cane', 'books'] as const) expect(fabricPixels(id).rgba.length).toBe(N * N * 4);
    const paint = stats(paintPixels('#efeae0').rgba);
    expect(paint.sd).toBeGreaterThan(0.2);
    expect(paint.sd).toBeLessThan(5);
  });

  it('gives furniture and treads materials with the flat colour the export carries', () => {
    expect(furnitureMaterial('fabric', 'existing', 'hickory', 'buffaloRed').userData.flatColor).toBe(FABRICS.buffaloRed.flat);
    expect(furnitureMaterial('wood', 'existing', 'hickory', 'buffaloRed').userData.flatColor).toBe(WOODS.hickory.color);
    expect(stairPartMaterial('tread', 'existing', '#d8d0c2').userData.flatColor).toBe('#d8d0c2');
    // The same wood is one material.
    expect(furnitureMaterial('wood', 'new', 'hickory', 'navajo')).toBe(furnitureMaterial('wood', 'new', 'hickory', 'cream'));
  });
});

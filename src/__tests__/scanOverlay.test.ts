import { Box3, Color, LinearSRGBColorSpace, SRGBColorSpace, Vector3, type BufferAttribute, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { attachScanOverlay, glbSize, overlayAsset } from '../../scripts/scan/attachOverlay';
import { describeObject } from '../../scripts/scan/objectBundle';
import { nodeFs, tmpDir } from '../../scripts/scan/nodeFs';
import { plyToOverlayGlb, readPly } from '../../scripts/scan/overlay';
import { parseRoom } from '../../scripts/scan/roomplan';
import { buildDraftPlan, draftLevelId, scanToDraft, worldToDraft } from '../../scripts/scan/scanToPlan';
import { makeSyntheticPly, MESH_COLOURS, TRUTH } from '../../scripts/scan/fixtures/syntheticRoom';
import room from '../../scripts/scan/fixtures/synthetic-room/room.json';
import frames from '../../scripts/scan/fixtures/synthetic-room/frames.json';
import meta from '../../scripts/scan/fixtures/synthetic-room/meta.json';
import { store } from '../../scripts/planLib';
import { bytesToBase64, DEFAULT_SCAN_OPACITY } from '../model/meshAsset';
import { createEmptyPlan, migrate } from '../model/plan';
import { firstStructure } from '../model/structures';

const draft = scanToDraft(parseRoom(room, frames, meta));
const plyPath = new URL('../../scripts/scan/fixtures/synthetic-room/mesh.ply', import.meta.url);
const ply = new Uint8Array(nodeFs().readFileSync(plyPath.pathname));
const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && bytesToBase64(a) === bytesToBase64(b);
const overlay = await plyToOverlayGlb(ply, draft.tidy);

async function loadGlb(bytes: Uint8Array): Promise<Object3D> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return (await new GLTFLoader().parseAsync(buf, '')).scene;
}
const scene = await loadGlb(overlay.bytes);

describe('the scan overlay transform (worldToDraft): the tidy the walls got, as a function on world points', () => {
  it('takes each scanned wall centre to the middle of its tidied raw face, at half its height', () => {
    const move = worldToDraft(draft.tidy);
    for (const s of room.surfaces.filter((x) => x.category === 'wall')) {
      const m = s.transform;
      const [x, h, y] = move(m[12], m[13], m[14]);
      const w = draft.walls.find((d) => d.scanId === s.id)!;
      expect(Math.abs(x - (w.raw.a.x + w.raw.b.x) / 2)).toBeLessThan(0.02);
      expect(Math.abs(y - (w.raw.a.y + w.raw.b.y) / 2)).toBeLessThan(0.02);
      expect(Math.abs(h - w.raw.height / 2)).toBeLessThan(0.02);
    }
  });
});

describe('mesh.ply to the overlay GLB (the synthetic room shell)', () => {
  it('the committed fixture is what makeSyntheticPly writes, and reads as a coloured mesh of a few thousand triangles', () => {
    expect(same(makeSyntheticPly(), ply)).toBe(true);
    const g = readPly(ply);
    expect(g.getAttribute('color')).toBeTruthy();
    expect(g.index!.count / 3).toBeGreaterThan(2000);
    expect(g.index!.count / 3).toBeLessThan(6000);
  });

  it('sits on the tidied room: the faces 0..156 by 0..330 within 2", floor to ceiling (0..108)', () => {
    const b = new Box3().setFromObject(scene);
    const near = (v: number, want: number) => expect(Math.abs(v - want)).toBeLessThanOrEqual(2);
    near(b.min.x, 0);
    near(b.max.x, draft.room.width);
    near(b.min.z, 0);
    near(b.max.z, draft.room.depth);
    near(b.min.y, 0);
    near(b.max.y, TRUTH.ceiling);
    expect(overlay.size.map((v) => Math.round(v))).toEqual([156, 330, 108]);
    expect(glbSize(overlay.bytes)).toEqual(overlay.size);
  });

  it('keeps each wall on its side (not mirrored) and its colour through the GLB (linear COLOR_0, sRGB back within 1/255)', () => {
    const groups = new Map<string, { n: number; sum: Vector3; err: number }>();
    const names = Object.keys(MESH_COLOURS) as (keyof typeof MESH_COLOURS)[];
    const c = new Color();
    const rgb = { r: 0, g: 0, b: 0 };
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position') as BufferAttribute;
      const col = m.geometry.getAttribute('color') as BufferAttribute;
      expect(col).toBeTruthy();
      for (let i = 0; i < pos.count; i++) {
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i), LinearSRGBColorSpace).getRGB(rgb, SRGBColorSpace);
        const px = [rgb.r * 255, rgb.g * 255, rgb.b * 255];
        let best = names[0];
        let bestErr = Infinity;
        for (const k of names) {
          const e = Math.max(...MESH_COLOURS[k].map((v, j) => Math.abs(v - px[j])));
          if (e < bestErr) [best, bestErr] = [k, e];
        }
        const g = groups.get(best) ?? { n: 0, sum: new Vector3(), err: 0 };
        g.n++;
        g.sum.add(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
        g.err = Math.max(g.err, bestErr);
        groups.set(best, g);
      }
    });
    const mean = (k: string) => groups.get(k)!.sum.clone().divideScalar(groups.get(k)!.n);
    for (const k of names) expect(groups.get(k)!.err).toBeLessThanOrEqual(1);
    // West (red) is the left wall, x 0; east (blue) the right, x 156; north (green) the top, y 0.
    expect(Math.abs(mean('west').x)).toBeLessThan(2);
    expect(Math.abs(mean('east').x - 156)).toBeLessThan(2);
    expect(Math.abs(mean('north').z)).toBeLessThan(2);
    expect(Math.abs(mean('south').z - 330)).toBeLessThan(2);
    expect(Math.abs(mean('floor').y)).toBeLessThan(1);
    expect(Math.abs(mean('west').y - 54)).toBeLessThan(2);
  });

  it('is the same bytes every run', async () => {
    const again = await plyToOverlayGlb(ply, draft.tidy);
    expect(same(again.bytes, overlay.bytes)).toBe(true);
  });

  it('steps the triangles down until the GLB fits the byte cap', async () => {
    const small = await plyToOverlayGlb(ply, draft.tidy, { maxBytes: 80000 });
    expect(small.bytes.byteLength).toBeLessThanOrEqual(80000);
    expect(small.triangles).toBeLessThan(overlay.triangles);
    await expect(plyToOverlayGlb(ply, draft.tidy, { maxBytes: 1000 })).rejects.toThrow(/still/);
  });
});

describe('the draft plan with its overlay', () => {
  const asset = overlayAsset(overlay.bytes, 'synthetic', 'Synthetic kitchen scan');
  const { json, skipped } = buildDraftPlan(draft, asset);
  const plan = JSON.parse(json);

  it('holds the overlay asset and Level.scan at 0,0, unturned, on the floor, visible at the default opacity', () => {
    expect(skipped).toEqual([]);
    expect(Object.keys(plan.assets)).toEqual(['scan-synthetic']);
    expect(plan.assets['scan-synthetic'].bytes).toBe(overlay.bytes.byteLength);
    const lid = firstStructure(plan).levelOrder[0];
    expect(plan.levels[lid].scan).toEqual({ assetId: 'scan-synthetic', origin: { x: 0, y: 0 }, rotation: 0, elevation: 0, opacity: DEFAULT_SCAN_OPACITY, visible: true });
  });

  it('survives migrate byte for byte and is the same on a second run', () => {
    expect(JSON.stringify(migrate(plan), null, 2) + '\n').toBe(json);
    expect(buildDraftPlan(draft, asset).json).toBe(json);
  });
});

describe('attachScanOverlay (for a hand-written plan script)', () => {
  it('puts the GLB at a path on a level, the asset named by its folder, at the placement given', () => {
    const fs = nodeFs();
    const dir = fs.mkdtempSync(`${tmpDir()}/scan-`);
    try {
      const glbPath = `${dir}/overlay.glb`;
      fs.writeFileSync(glbPath, overlay.bytes);
      store().setPlan(createEmptyPlan('Test', 'single'));
      const lid = draftLevelId(store().plan);
      const id = attachScanOverlay(lid, glbPath, { origin: { x: 10, y: -4 } });
      const p = store().plan;
      expect(p.levels[lid].scan).toMatchObject({ assetId: id, origin: { x: 10, y: -4 }, rotation: 0, elevation: 0, visible: true });
      expect(p.assets?.[id]?.size).toEqual(overlay.size);
      expect(id).toBe(`scan-${dir.split('/').pop()}`);
      expect(() => attachScanOverlay('no-such-level', glbPath)).toThrow(/refused/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('an object bundle', () => {
  it('is described by its size in feet and inches and how to import it', () => {
    const lines = describeObject({ format: 1, kind: 'object', name: 'Chair', bounds: [0.4572, 0.9144, 0.508] }, '/nowhere/chair-object/object.usdz', false);
    expect(lines[0]).toBe('Chair: 1\'-6" (18") wide x 1\'-8" (20") deep x 3\'-0" (36") high, as scanned.');
    expect(lines[1]).toMatch(/object\.usdz is missing/);
  });
});

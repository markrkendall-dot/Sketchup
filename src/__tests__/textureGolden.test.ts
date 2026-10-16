import { describe, expect, it } from 'vitest';
import { FABRIC_IDS, WOODS, WOOD_IDS } from '../model/furniture';
import { fabricPixels, paintPixels, woodPixels, type Pixels } from '../view3d/proceduralTextures';
import { normalFromHeight, PX_PER_INCH, TEXTURE_PX } from '../view3d/textures';

// The pixel generators' exact output, as hashes recorded before the load-time work (DESIGN.md "Load
// time"): speeding them up must not change a single pixel. A change that means to change a texture
// updates its hash here, on purpose.

/** FNV-1a over bytes. */
function fnv(bytes: ArrayLike<number>, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h >>> 0;
}
const hex = (n: number) => n.toString(16).padStart(8, '0');
const hashOf = (p: Pixels): string => {
  const parts = [hex(fnv(p.rgba))];
  if (p.height) {
    parts.push(hex(fnv(new Uint8Array(p.height.buffer, p.height.byteOffset, p.height.byteLength))));
    parts.push(hex(fnv(normalFromHeight(p.height, TEXTURE_PX, PX_PER_INCH))));
  }
  return parts.join(' ');
};

const cases: [string, () => Pixels][] = [
  ...WOOD_IDS.map((id) => [`wood ${id}`, () => woodPixels(WOODS[id].grain, WOODS[id].color, 'plank')] as [string, () => Pixels]),
  ['wood stair tread', () => woodPixels('pine', '#d8d0c2', 'plank')],
  ['pine floor', () => woodPixels('pine', '#d8d0c2', 'floor')],
  ...[...FABRIC_IDS, 'linen', 'cane', 'books'].map((id) => [`fabric ${id}`, () => fabricPixels(id as Parameters<typeof fabricPixels>[0])] as [string, () => Pixels]),
  ...['#ddd6b4', '#efeae0', '#2e3f6b'].map((c) => [`paint ${c}`, () => paintPixels(c)] as [string, () => Pixels]),
];

const GOLDEN: Record<string, string> = {
  'wood nordicPine': '2905f20e',
  'wood hickory': '291eacb0',
  'wood peeledLog': 'dda38765',
  'wood darkLog': 'e216d196',
  'wood fumedOak': '1219fa6c',
  'wood paintedGreen': 'caef0bd6',
  'wood paintedRed': 'dc4d6079',
  'wood paintedCream': '3d758827',
  'wood stair tread': '239ff758',
  'pine floor': 'd6fd31d9 0b66f591 82d9c9d2',
  'fabric buffaloRed': '0393f0ba',
  'fabric buffaloGreen': '6f06afa6',
  'fabric pointBlanket': '8590251e',
  'fabric woolPlaid': 'da8b4e54',
  'fabric canvas': '59954bbe',
  'fabric leather': 'bb852c3c',
  'fabric navajo': '9527f0cd 2ea49dc5 83cc9dc5',
  'fabric braided': 'ab260117 cfdeddc5 c3245dc5',
  'fabric cream': 'b4114f77',
  'fabric linen': '5fc07656',
  'fabric cane': 'b395464a 70249dc5 46c325c5',
  'fabric books': '7e9437a1',
  'paint #ddd6b4': '2c3d554c 88dac0ca dfb23342',
  'paint #efeae0': 'a316f3d1 88dac0ca dfb23342',
  'paint #2e3f6b': '970d4c63 88dac0ca dfb23342',
};

describe('texture pixels (golden)', () => {
  it('match the recorded hashes', () => {
    const got: Record<string, string> = {};
    for (const [name, make] of cases) got[name] = hashOf(make());
    expect(got).toEqual(GOLDEN);
  });
});

import { describe, expect, it } from 'vitest';
import { formatArea, formatLength, formatLengthCompact, parseLength, tryParseLength } from '../model/units';

describe('parseLength: DESIGN.md examples', () => {
  const cases: [string, number][] = [
    ['150', 150],
    ["12'", 144],
    ["12.5'", 150],
    ["12'6", 150],
    [`12' 6"`, 150],
    [`12'-6"`, 150],
    ['12-6', 150],
    ['6"', 6],
    ['6 1/2"', 6.5],
    ['6 1/2', 6.5],
    ['1/2', 0.5],
    [`12' 6 1/2"`, 150.5],
    [`12'6-1/2"`, 150.5],
    ["12' 6.5", 150.5],
  ];
  it.each(cases)('%s -> %d', (input, expected) => {
    expect(parseLength(input)).toBe(expected);
  });
});

describe('parseLength: synonyms, spacing, case, sign', () => {
  const cases: [string, number][] = [
    ['12ft', 144],
    ['12 ft 6 in', 150],
    ['12FT6IN', 150],
    ['12Ft 6In', 150],
    ['6in', 6],
    ['  150  ', 150],
    [`12 ' 6 "`, 150],
    [`12' - 6"`, 150],
    ['12-6 1/2', 150.5],
    ['12-6-1/2', 150.5],
    ['6-1/2"', 6.5],
    ['0', 0],
    ["0'", 0],
    ['.5', 0.5],
    ['3.25', 3.25],
    ['-150', -150],
    [`-12'-6"`, -150],
    ['-1/2', -0.5],
    ["12'0", 144],
    ['1/16', 0.0625],
    ['3/8"', 0.375],
    [`10'-11 15/16"`, 131.9375],
    ['12′ 6″', 150],
  ];
  it.each(cases)('%s -> %d', (input, expected) => {
    expect(parseLength(input)).toBe(expected);
  });

  it('never rounds', () => {
    expect(parseLength('1/3')).toBeCloseTo(1 / 3, 12);
    expect(parseLength('10.123456')).toBe(10.123456);
  });
});

describe('parseLength: errors', () => {
  const bad = [
    '',
    '   ',
    '3/0',
    "12'6'",
    "'6",
    '"',
    '-',
    '--5',
    'abc',
    '12 6',
    "12'-",
    '1/2/3',
    '6 1/2 1/4',
    '12"6',
    '1.5.5',
    '6 1.5/2',
    '12x',
    '1/',
    '/2',
    '12--6',
    `6"'`,
  ];
  it.each(bad)('rejects %j', (input) => {
    expect(() => parseLength(input)).toThrow(Error);
    expect(tryParseLength(input)).toBeNull();
  });

  it('error messages are readable', () => {
    expect(() => parseLength('3/0')).toThrow(/division by zero/);
    expect(() => parseLength('')).toThrow(/empty/);
  });
});

describe('formatLength', () => {
  const cases: [number, string][] = [
    [0, '0"'],
    [6, '6"'],
    [6.5, '6 1/2"'],
    [0.125, '1/8"'],
    [150, `12'-6"`],
    [144, `12'-0"`],
    [150.5, `12'-6 1/2"`],
    [-150, `-12'-6"`],
    [144.5, `12'-0 1/2"`],
  ];
  it.each(cases)('%d -> %s', (input, expected) => {
    expect(formatLength(input)).toBe(expected);
  });

  it('rounds to the nearest 1/16 half up and carries into feet', () => {
    expect(formatLength(11.95)).toBe(`11 15/16"`);
    expect(formatLength(11.96875)).toBe(`1'-0"`); // 11 31/32 is exactly half -> up
    expect(formatLength(11.99)).toBe(`1'-0"`);
    expect(formatLength(143.99)).toBe(`12'-0"`);
    expect(formatLength(1 / 32)).toBe('1/16"'); // exactly half -> up
    expect(formatLength(1 / 33)).toBe('0"');
  });

  it('reduces fractions and honours the denominator', () => {
    expect(formatLength(6.25)).toBe('6 1/4"');
    expect(formatLength(6.75, 4)).toBe('6 3/4"');
    expect(formatLength(6.3, 2)).toBe('6 1/2"');
    expect(formatLength(6.2, 2)).toBe('6"');
    expect(formatLength(6.6, 1)).toBe('7"');
  });

  it('does not print negative zero', () => {
    expect(formatLength(-0.001)).toBe('0"');
  });

  it('round-trips through parseLength', () => {
    for (const v of [0, 0.5, 6.5, 150, 150.5, 131.9375, -150, 1234.0625]) {
      expect(parseLength(formatLength(v))).toBe(v);
      expect(parseLength(formatLengthCompact(v))).toBe(v);
    }
  });
});

describe('formatLengthCompact', () => {
  it('drops a zero inch part', () => {
    expect(formatLengthCompact(144)).toBe(`12'`);
    expect(formatLengthCompact(360)).toBe(`30'`);
    expect(formatLengthCompact(-144)).toBe(`-12'`);
  });
  it('otherwise matches formatLength', () => {
    expect(formatLengthCompact(150)).toBe(`12'-6"`);
    expect(formatLengthCompact(144.5)).toBe(`12'-0 1/2"`);
    expect(formatLengthCompact(6)).toBe('6"');
    expect(formatLengthCompact(0)).toBe('0"');
  });
});

describe('formatArea', () => {
  it('formats square inches as square feet', () => {
    expect(formatArea(184 * 144)).toBe('184 sq ft');
    expect(formatArea(184.4 * 144)).toBe('184 sq ft');
    expect(formatArea(0)).toBe('0 sq ft');
    expect(formatArea(1500 * 144)).toBe('1,500 sq ft');
  });
});

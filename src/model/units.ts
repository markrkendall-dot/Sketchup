// Feet-inch parsing and formatting. All lengths are inches. See docs/DESIGN.md.
//
// length   := feet [sep] inches? | inches
// feet     := number ("'" | "ft")
// inches   := (number [space fraction] | fraction) ('"' | "in")?
// fraction := int "/" int
// sep      := "-" | space | ""
//
// Bare number = inches. A dash between two plain numbers is the architectural feet-inch
// separator (`12-6` = 12'-6"), while a dash before a fraction joins whole and fractional
// inches (`6-1/2"`). A leading `-` negates. Never rounds on parse.

type Token =
  | { t: 'num'; v: number; int: boolean; spaceBefore: boolean }
  | { t: 'ft' | 'in' | 'slash' | 'dash' };

const INVALID = 'Not a length';

function tokenize(input: string): Token[] {
  const s = input
    .toLowerCase()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/[−–—]/g, '-');
  const out: Token[] = [];
  let i = 0;
  let spaceBefore = false;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      spaceBefore = true;
      i++;
      continue;
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)/.exec(s.slice(i));
    if (num) {
      const text = num[1];
      out.push({ t: 'num', v: Number(text), int: /^\d+$/.test(text), spaceBefore });
      i += text.length;
    } else if (s.startsWith('ft', i)) {
      out.push({ t: 'ft' });
      i += 2;
    } else if (s.startsWith('in', i)) {
      out.push({ t: 'in' });
      i += 2;
    } else if (c === "'") {
      out.push({ t: 'ft' });
      i++;
    } else if (c === '"') {
      out.push({ t: 'in' });
      i++;
    } else if (c === '/') {
      out.push({ t: 'slash' });
      i++;
    } else if (c === '-') {
      out.push({ t: 'dash' });
      i++;
    } else {
      throw new Error(`${INVALID}: unexpected "${c}"`);
    }
    spaceBefore = false;
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  peek(offset = 0): Token | undefined {
    return this.toks[this.i + offset];
  }
  next(): Token | undefined {
    return this.toks[this.i++];
  }
  done(): boolean {
    return this.i >= this.toks.length;
  }
  isNum(offset = 0): boolean {
    return this.peek(offset)?.t === 'num';
  }
  is(kind: Token['t'], offset = 0): boolean {
    return this.peek(offset)?.t === kind;
  }

  /** int "/" int at the cursor? */
  atFraction(offset = 0): boolean {
    const a = this.peek(offset);
    const b = this.peek(offset + 2);
    return (
      a?.t === 'num' && a.int && this.is('slash', offset + 1) && b?.t === 'num' && b.int
    );
  }

  fraction(): number {
    const n = this.next();
    this.next(); // slash
    const d = this.next();
    if (n?.t !== 'num' || d?.t !== 'num') throw new Error(INVALID);
    if (d.v === 0) throw new Error(`${INVALID}: division by zero`);
    return n.v / d.v;
  }

  /** inches := (number [sep fraction] | fraction) ('"' | "in")? ; returns null when absent */
  inches(): number | null {
    if (!this.isNum()) return null;
    let value: number;
    if (this.atFraction()) {
      value = this.fraction();
    } else {
      const whole = this.next();
      if (whole?.t !== 'num') throw new Error(INVALID);
      value = whole.v;
      const nextNum = this.peek();
      if (nextNum?.t === 'num' && nextNum.spaceBefore && whole.int && this.atFraction()) {
        value += this.fraction(); // `6 1/2`
      } else if (this.is('dash') && whole.int && this.atFraction(1)) {
        this.next(); // `6-1/2`
        value += this.fraction();
      }
    }
    if (this.is('in')) this.next();
    return value;
  }
}

/** Parse a feet-inch string to inches. Throws a readable Error when invalid. */
export function parseLength(input: string): number {
  const toks = tokenize(input);
  if (toks.length === 0) throw new Error(`${INVALID}: empty`);
  const p = new Parser(toks);
  let sign = 1;
  if (p.is('dash')) {
    p.next();
    sign = -1;
  }
  if (!p.isNum()) throw new Error(INVALID);

  let total: number;
  const first = p.peek();
  if (first?.t === 'num' && p.is('ft', 1)) {
    // feet [sep] inches?
    p.next();
    p.next();
    total = first.v * 12;
    if (p.is('dash')) {
      p.next();
      if (!p.isNum()) throw new Error(`${INVALID}: expected inches after "-"`);
    }
    const inches = p.inches();
    if (inches !== null) total += inches;
  } else if (first?.t === 'num' && p.is('dash', 1) && p.isNum(2) && !p.atFraction(2)) {
    // Architectural `12-6`: dash between two plain numbers separates feet and inches.
    p.next();
    p.next();
    const inches = p.inches();
    if (inches === null) throw new Error(INVALID);
    total = first.v * 12 + inches;
  } else {
    const inches = p.inches();
    if (inches === null) throw new Error(INVALID);
    total = inches;
  }
  if (!p.done()) throw new Error(`${INVALID}: unexpected trailing input`);
  if (!Number.isFinite(total)) throw new Error(INVALID);
  return sign * total;
}

/** Like parseLength but returns null instead of throwing. */
export function tryParseLength(input: string): number | null {
  try {
    return parseLength(input);
  } catch {
    return null;
  }
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

interface LengthParts {
  negative: boolean;
  feet: number;
  inches: number;
  num: number;
  den: number;
}

function splitLength(inches: number, denom: number): LengthParts {
  // Round the magnitude to the nearest 1/denom, half up; epsilon absorbs float noise.
  const units = Math.floor(Math.abs(inches) * denom + 0.5 + 1e-9);
  const perFoot = 12 * denom;
  const feet = Math.floor(units / perFoot);
  const rem = units - feet * perFoot;
  const whole = Math.floor(rem / denom);
  let num = rem - whole * denom;
  let den = denom;
  if (num > 0) {
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  return { negative: inches < 0 && units > 0, feet, inches: whole, num, den };
}

function inchText(whole: number, num: number, den: number, withLeadingZero: boolean): string {
  if (num === 0) return `${whole}`;
  if (whole === 0 && !withLeadingZero) return `${num}/${den}`;
  return `${whole} ${num}/${den}`;
}

/** `150` -> `12'-6"`, `6.5` -> `6 1/2"`, `0.125` -> `1/8"`. */
export function formatLength(inches: number, denom = 16): string {
  const p = splitLength(inches, denom);
  const sign = p.negative ? '-' : '';
  if (p.feet === 0) return `${sign}${inchText(p.inches, p.num, p.den, false)}"`;
  return `${sign}${p.feet}'-${inchText(p.inches, p.num, p.den, true)}"`;
}

/** Like formatLength but drops a zero inch part: `144` -> `12'`. */
export function formatLengthCompact(inches: number, denom = 16): string {
  const p = splitLength(inches, denom);
  if (p.feet > 0 && p.inches === 0 && p.num === 0) return `${p.negative ? '-' : ''}${p.feet}'`;
  return formatLength(inches, denom);
}

/** Square inches to `184 sq ft`. */
export function formatArea(sqIn: number): string {
  return `${Math.round(sqIn / 144).toLocaleString('en-US')} sq ft`;
}

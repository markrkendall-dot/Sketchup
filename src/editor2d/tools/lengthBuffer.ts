// Typed length buffer shared by the wall and opening tools (DESIGN.md "Wall tool with typed
// lengths", step 3). The canvas owns key events; the buffer lives in uiStore.draft.lengthBuffer.

/** Characters that start the typed length buffer. */
const BUFFER_START = /^[0-9'"/.-]$/;

/** Typographic primes and quotes, as a phone or word processor types them, to the ASCII marks. */
const NORMALIZE: Record<string, string> = { '′': "'", '’': "'", '″': '"', '”': '"', '−': '-', '–': '-', '—': '-' };

/**
 * Apply a key to the buffer. Returns the new buffer, or null when the key does not edit it
 * (Backspace on an empty buffer, a key that is not a character, or a character that cannot start
 * a length).
 *
 * Once the buffer is non-empty every character goes in, not only the ones a length can contain:
 * a typo such as `1e3` or `12,5` stays visible and is rejected as a whole when committed, instead
 * of the stray character being dropped and the rest read as a different length.
 */
export function applyBufferKey(buffer: string, key: string): string | null {
  if (key === 'Backspace') return buffer ? buffer.slice(0, -1) : null;
  if (key.length !== 1) return null;
  const ch = NORMALIZE[key] ?? key.toLowerCase();
  if (BUFFER_START.test(ch) || buffer) return buffer + ch;
  return null;
}

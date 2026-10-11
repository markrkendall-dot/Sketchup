// Typed length buffer shared by the wall and opening tools (DESIGN.md "Wall tool with typed
// lengths", step 3). The canvas owns key events; the buffer lives in uiStore.draft.lengthBuffer.

/** Characters that start or extend the typed length buffer. */
const BUFFER_START = /^[0-9'"/.-]$/;
/** Extra characters accepted once the buffer is non-empty (`12 6`, `12ft`, `6in`). */
const BUFFER_CONTINUE = /^[ ftin]$/;

/**
 * Apply a key to the buffer. Returns the new buffer, or null when the key does not edit it
 * (Backspace on an empty buffer, or a character that cannot start/extend a length).
 */
export function applyBufferKey(buffer: string, key: string): string | null {
  if (key === 'Backspace') return buffer ? buffer.slice(0, -1) : null;
  if (key.length !== 1) return null;
  const ch = key.toLowerCase();
  if (BUFFER_START.test(ch) || (buffer && BUFFER_CONTINUE.test(ch))) return buffer + ch;
  return null;
}

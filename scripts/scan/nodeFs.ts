// The few node:fs and node:os calls a scan module needs, for modules the app's TypeScript build
// also checks (a plan script and its tests import them, and that build has no Node types). Taken
// from Node's own process.getBuiltinModule (Node 22 and later), typed here by hand.
export interface NodeFs {
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array | string): void;
  existsSync(path: string): boolean;
  mkdtempSync(prefix: string): string;
  rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
}

function builtin<T>(id: string): T {
  const proc = (globalThis as unknown as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const mod = proc?.getBuiltinModule?.(id);
  if (!mod) throw new Error(`${id} is not available: this needs Node 22 or later`);
  return mod as T;
}

export const nodeFs = (): NodeFs => builtin<NodeFs>('node:fs');
export const tmpDir = (): string => builtin<{ tmpdir(): string }>('node:os').tmpdir();

/** A file path or file: URL as a path. */
export const pathOf = (p: string | URL): string => (typeof p === 'string' ? p : decodeURIComponent(p.pathname));

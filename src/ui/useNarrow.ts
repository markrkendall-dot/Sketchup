import { useSyncExternalStore } from 'react';
import { isNarrow, NARROW_QUERY } from '../store/uiStore';

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** True while the window is under 900 px wide (the same breakpoint index.css uses). */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, isNarrow, () => false);
}

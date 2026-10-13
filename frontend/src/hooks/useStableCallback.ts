import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Return a callback with a stable identity that always calls the latest `fn`.
 *
 * Lets memoized list rows (React.memo) skip re-renders when a parent passes
 * handlers that close over frequently changing state.
 *
 * Args:
 *   fn: Latest implementation; must only be invoked from event handlers or
 *     effects, never during render.
 *
 * Returns:
 *   Stable function forwarding to the latest `fn`.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

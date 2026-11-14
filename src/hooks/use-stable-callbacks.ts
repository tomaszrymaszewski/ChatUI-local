import { useInsertionEffect, useRef, useState } from "react";

type AnyFn = (...args: never[]) => unknown;

/**
 * Stable-identity proxies for a set of handlers: each returned function keeps
 * one identity for the component's lifetime and always calls the handler
 * from the latest committed render. Lets memoized children (and memoized
 * JSX) skip re-rendering without capturing stale closures.
 *
 * The key set is fixed by the first render. The proxies are for event
 * handlers — calling one during render sees the previous render's handler.
 */
export function useStableCallbacks<T extends Record<string, AnyFn>>(handlers: T): T {
  const latest = useRef(handlers);
  // Insertion effects run before any layout effect, so even a child's layout
  // effect calling a proxy already sees this render's handlers.
  useInsertionEffect(() => {
    latest.current = handlers;
  });
  const [stable] = useState(() => {
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const key of Object.keys(handlers)) {
      out[key] = (...args: unknown[]) =>
        (latest.current[key] as unknown as (...a: unknown[]) => unknown)(...args);
    }
    return out as unknown as T;
  });
  return stable;
}

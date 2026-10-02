"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether this viewer allows motion: the system's reduced-motion setting first, then a
 * switch a page may offer ("Pause motion"), remembered per browser where storage works.
 *
 * The server snapshot is `false`, so the server render — and any render without
 * JavaScript — is always the finished, still state. Motion is only ever added on top of
 * content that is already complete.
 */
const QUERY = "(prefers-reduced-motion: reduce)";
const KEY = "novera.motion";
const listeners = new Set<() => void>();
// Used when storage is unavailable, so the switch still works for this page view.
let override: boolean | null = null;

function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener?.("change", onChange);
  listeners.add(onChange);
  return () => {
    media?.removeEventListener?.("change", onChange);
    listeners.delete(onChange);
  };
}

function read(): boolean {
  if (window.matchMedia?.(QUERY).matches) return false;
  if (override !== null) return override;
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function useMotion(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    override = next;
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable: the override above still holds for this view */
    }
    for (const l of listeners) l();
  }, []);
  return [on, set];
}

/** The system setting alone, for motion a page does not offer a switch for. */
export function useSystemMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !window.matchMedia?.(QUERY).matches,
    () => false,
  );
}

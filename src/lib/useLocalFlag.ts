"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHANGE_EVENT = "vesper:local-flag";

function subscribe(onChange: () => void) {
  // "storage" covers other tabs; the custom event covers this tab.
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * A boolean persisted in localStorage as "on" / "off".
 *
 * Reads through useSyncExternalStore rather than an effect, so the server
 * render and hydration both see `false` and the stored value is applied
 * right after, without setState-in-effect.
 */
export function useLocalFlag(key: string): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key) === "on";
      } catch {
        return false;
      }
    },
    () => false,
  );

  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "on" : "off");
      } catch {
        // Storage can be blocked; the flag then simply does not persist.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key],
  );

  return [value, set];
}

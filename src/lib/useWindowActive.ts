import { useEffect, useState } from "react";

/** Pure decision: active only when the page is visible AND os-focused. */
export function isWindowActive(hidden: boolean, hasFocus: boolean): boolean {
  return !hidden && hasFocus;
}

function readWindowActive(): boolean {
  if (typeof document === "undefined") return true;
  return isWindowActive(document.hidden, document.hasFocus());
}

/**
 * Tracks whether the app window is active (visible tab + OS focus).
 * Background SSH work (server-stats polls, remote git probes) should pause
 * while inactive and refetch on return — an unfocused window must not steal
 * server CPU/IO from a streaming agent.
 */
export function useWindowActive(): boolean {
  const [active, setActive] = useState(readWindowActive);

  useEffect(() => {
    const sync = () => setActive(readWindowActive());
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return active;
}

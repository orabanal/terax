import { useCallback, useEffect, useState } from "react";
import { loadBookmarks, saveBookmarks } from "./bookmarks";

/** Stable bookmark key for a connection. Sub-tab ids (`conn-N`) are
 *  ephemeral — regenerated every launch and every new tab — so keying by
 *  them orphans bookmarks as soon as the tab closes. Identity here is the
 *  connection itself, shared by whichever panel (left/right) hosts it. */
export function bookmarkKeyFor(
  conn: { mode: "local" | "remote"; hostId?: string },
  fallbackId: string,
): string {
  if (conn.mode === "local") return "local";
  return conn.hostId ? `ssh:${conn.hostId}` : fallbackId;
}

/**
 * Manages bookmarks scoped to a stable connection key.
 * Storage is a flat map: Record<bookmarkKey, string[]>.
 *
 * The map reloads when the pane gains focus: two panes can show the same
 * connection side by side, and each hook instance would otherwise save
 * from the snapshot it loaded at mount, silently dropping the other
 * pane's changes.
 */
export function useSftpBookmarks(bookmarkKey: string, active: boolean) {
  const [allBookmarks, setAllBookmarks] = useState<Record<string, string[]>>(
    {},
  );

  const reload = useCallback(async () => {
    try {
      setAllBookmarks(await loadBookmarks());
    } catch {
      // Corrupt/unreadable store — keep the in-memory snapshot.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  const bookmarks = allBookmarks[bookmarkKey] ?? [];

  const toggle = useCallback(
    (path: string) => {
      setAllBookmarks((prev) => {
        const current = prev[bookmarkKey] ?? [];
        const updated = current.includes(path)
          ? current.filter((p) => p !== path)
          : [...current, path];
        const next = { ...prev, [bookmarkKey]: updated };
        void saveBookmarks(next);
        return next;
      });
    },
    [bookmarkKey],
  );

  const remove = useCallback(
    (path: string) => {
      setAllBookmarks((prev) => {
        const current = prev[bookmarkKey] ?? [];
        const updated = current.filter((p) => p !== path);
        const next = { ...prev, [bookmarkKey]: updated };
        void saveBookmarks(next);
        return next;
      });
    },
    [bookmarkKey],
  );

  const isBookmarked = useCallback(
    (path: string) => bookmarks.includes(path),
    [bookmarks],
  );

  return { bookmarks, toggle, remove, isBookmarked };
}

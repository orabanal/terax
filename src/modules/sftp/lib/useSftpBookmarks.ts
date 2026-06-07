import { useCallback, useEffect, useState } from "react";
import { loadBookmarks, saveBookmarks } from "./bookmarks";

/**
 * Manages bookmarks scoped to a specific connection key.
 * Each SFTP sub-tab (local or remote) gets its own bookmark set.
 * Storage is a flat map: Record<connectionKey, string[]>.
 */
export function useSftpBookmarks(connKey: string) {
  const [allBookmarks, setAllBookmarks] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    loadBookmarks().then((data) => {
      if (!cancelled) setAllBookmarks(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bookmarks = allBookmarks[connKey] ?? [];

  const toggle = useCallback(
    (path: string) => {
      setAllBookmarks((prev) => {
        const current = prev[connKey] ?? [];
        const updated = current.includes(path)
          ? current.filter((p) => p !== path)
          : [...current, path];
        const next = { ...prev, [connKey]: updated };
        void saveBookmarks(next);
        return next;
      });
    },
    [connKey],
  );

  const remove = useCallback(
    (path: string) => {
      setAllBookmarks((prev) => {
        const current = prev[connKey] ?? [];
        const updated = current.filter((p) => p !== path);
        const next = { ...prev, [connKey]: updated };
        void saveBookmarks(next);
        return next;
      });
    },
    [connKey],
  );

  const isBookmarked = useCallback(
    (path: string) => bookmarks.includes(path),
    [bookmarks],
  );

  return { bookmarks, toggle, remove, isBookmarked };
}

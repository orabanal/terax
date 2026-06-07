import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_PATH = "terax-sftp-bookmarks.json";
const KEY = "bookmarks";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadBookmarks(): Promise<Record<string, string[]>> {
  const bookmarks = await store.get<Record<string, string[]>>(KEY);
  return bookmarks ?? {};
}

export async function saveBookmarks(
  data: Record<string, string[]>,
): Promise<void> {
  await store.set(KEY, data);
  await store.save();
}

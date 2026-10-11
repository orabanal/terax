import { useSyncExternalStore } from "react";
import { EXT_TO_LANGUAGE_ID } from "./constants";
import * as fileIconsMod from "./fileIcons";
import * as folderIconsMod from "./folderIcons";

const catFileNames = fileIconsMod.fileNames as Record<string, string>;
const catFileExtensions = fileIconsMod.fileExtensions as Record<string, string>;
const catLanguageIds = fileIconsMod.languageIds as Record<string, string>;
const catFolderNames = folderIconsMod.folderNames as Record<string, string>;

type IconifySet = {
  icons: Record<string, { body: string }>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
};

/**
 * The 3.7MB icon set must NEVER ride the critical path: statically
 * importing it grew main.js 862KB → 4.46MB and held first paint ~1s
 * behind a white window on every launch. Bodies load async after paint;
 * until then everything resolves to the inline defaults below (same <img>
 * size, so layout never shifts — icons just pop from generic to specific).
 */
const ICON_W = 32;
const ICON_H = 32;

const DEFAULT_FILE = "default-file";
const DEFAULT_FOLDER = "default-folder";
const DEFAULT_FOLDER_OPEN = "default-folder-opened";

const DEFAULT_BODIES: Record<string, string> = {
  [DEFAULT_FILE]:
    '<path fill="#c5c5c5" d="M20.414 2H5v28h22V8.586ZM7 28V4h12v6h6v18Z"/>',
  [DEFAULT_FOLDER]:
    '<path fill="#c09553" d="M27.5 5.5h-9.3l-2.1 4.2H4.4v16.8h25.2v-21Zm0 4.2h-8.2l1.1-2.1h7.1Z"/>',
  [DEFAULT_FOLDER_OPEN]:
    '<path fill="#dcb67a" d="M27.4 5.5h-9.2l-2.1 4.2H4.3v16.8h25.2v-21Zm0 18.7H6.6V11.8h20.8Zm0-14.5h-8.2l1-2.1h7.1v2.1Z"/><path fill="#dcb67a" d="M25.7 13.7H.5l3.8 12.8h25.2z"/>',
};

let liveSet: IconifySet | null = null;
let iconsVersion = 0;
const versionListeners = new Set<() => void>();

function subscribeIconsVersion(cb: () => void): () => void {
  versionListeners.add(cb);
  return () => {
    versionListeners.delete(cb);
  };
}

function getIconsVersion(): number {
  return iconsVersion;
}

/** Re-render trigger for icon consumers. Call (ignoring the return) in any
 *  component that renders fileIconUrl/folderIconUrl output so specific
 *  icons pop in when the set arrives. */
export function useIconsVersion(): number {
  return useSyncExternalStore(subscribeIconsVersion, getIconsVersion);
}

let iconSetPromise: Promise<void> | null = null;

/** Fetch the icon bodies off the critical path. Safe to call repeatedly;
 *  resolves once. Clears pre-load (default-substituted) resolutions so
 *  nothing stays generic. */
export function initIconSet(): Promise<void> {
  if (!iconSetPromise) {
    iconSetPromise = import("@iconify-json/vscode-icons/icons.json")
      .then((mod) => {
        liveSet = (mod.default ?? mod) as unknown as IconifySet;
        dataUrlCache.clear();
        iconsVersion += 1;
        for (const cb of versionListeners) cb();
      })
      .catch(() => {
        // Offline/corrupt asset: icons stay generic, app keeps working.
        iconSetPromise = null;
      })
      .then(() => undefined);
  }
  return iconSetPromise;
}

const dataUrlCache = new Map<string, string>();

// Manifest keys use underscores in places; the iconify export normalizes
// everything to hyphenated slugs.
function toIconifySlug(name: string): string {
  return name.replace(/_/g, "-");
}

function catBody(iconName: string): string | null {
  const slug = toIconifySlug(iconName);
  const set = liveSet;
  if (set) {
    const direct = set.icons[slug];
    if (direct) return direct.body;
    const alias = set.aliases?.[slug];
    if (alias) {
      const parent = set.icons[alias.parent];
      if (parent) return parent.body;
    }
    return null;
  }
  // Pre-load: only the inline defaults exist.
  return DEFAULT_BODIES[slug] ?? null;
}

function buildDataUrl(iconName: string): string | null {
  const cached = dataUrlCache.get(iconName);
  if (cached !== undefined) return cached || null;
  const body = catBody(iconName);
  if (!body) {
    dataUrlCache.set(iconName, "");
    return null;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_W} ${ICON_H}">${body}</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  dataUrlCache.set(iconName, url);
  return url;
}

function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.indexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

export function fileIconUrl(name: string): string {
  const lower = name.toLowerCase();

  const byName = catFileNames[lower];
  if (byName) {
    const url = buildDataUrl(byName);
    if (url) return url;
  }

  let ext = extOf(lower);
  while (ext) {
    const iconName = catFileExtensions[ext];
    if (iconName) {
      const url = buildDataUrl(iconName);
      if (url) return url;
    }
    const langId = EXT_TO_LANGUAGE_ID[ext];
    if (langId) {
      const iconByLang = catLanguageIds[langId];
      if (iconByLang) {
        const url = buildDataUrl(iconByLang);
        if (url) return url;
      }
    }
    const nextDot = ext.indexOf(".");
    if (nextDot === -1) break;
    ext = ext.slice(nextDot + 1);
  }

  // Extensionless well-known files (Dockerfile, Makefile): the manifest
  // knows them by language id, so try the whole filename as a lang id.
  if (!extOf(lower)) {
    const iconByLang = catLanguageIds[lower];
    if (iconByLang) {
      const url = buildDataUrl(iconByLang);
      if (url) return url;
    }
  }

  return buildDataUrl(DEFAULT_FILE) ?? "";
}

export function folderIconUrl(name: string, expanded: boolean): string {
  const lower = name.toLowerCase();

  const mapped = catFolderNames[lower];
  if (mapped) {
    const slug = toIconifySlug(mapped);
    // vscode-icons uses `-opened` for expanded folders (every mapped
    // folder ships one); fall back to the closed glyph if absent.
    if (expanded) {
      const url = buildDataUrl(`${slug}-opened`);
      if (url) return url;
    }
    const url = buildDataUrl(slug);
    if (url) return url;
  }

  return buildDataUrl(expanded ? DEFAULT_FOLDER_OPEN : DEFAULT_FOLDER) ?? "";
}

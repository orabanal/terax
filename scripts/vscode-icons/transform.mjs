import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/tmp/vsgen/");
const bundle = require("/tmp/vsgen/bundle.cjs");
const iconsJson = JSON.parse(readFileSync("/Users/jvillanueva/Sites/terax/node_modules/@iconify-json/vscode-icons/icons.json", "utf8"));
const icons = iconsJson.icons;

const stats = { skippedDisabled: 0, skippedMissing: 0, conflicts: 0, globsExpanded: 0 };
const missing = [];
const conflicts = [];

function slugFor(prefix, icon) {
  const slug = `${prefix}-${String(icon).replace(/_/g, "-").toLowerCase()}`;
  if (icons[slug]) return slug;
  missing.push(slug);
  stats.skippedMissing++;
  return null;
}
function put(map, key, slug, label) {
  key = key.toLowerCase();
  if (map[key]) {
    if (map[key] !== slug) { stats.conflicts++; if (conflicts.length < 15) conflicts.push(`${label} '${key}': ${map[key]} vs ${slug}`); }
    return;
  }
  map[key] = slug;
}

// ---- files ----
const fileNames = {}, fileExtensions = {}, languageIds = {};
for (const e of bundle.fileExtensions.supported) {
  if (e.disabled) { stats.skippedDisabled++; continue; }
  const slug = slugFor("file-type", e.icon);
  if (!slug) continue;
  const asNames = e.filename === true;
  for (const x of e.extensions || []) {
    if (asNames) put(fileNames, x, slug, "fileNames");
    else put(fileExtensions, x, slug, "fileExtensions");
  }
  const globs = e.filenamesGlob || [];
  const extGlobs = e.extensionsGlob || [];
  for (const g of globs) {
    put(fileNames, g, slug, "fileNames-bare-glob");
    for (const eg of extGlobs) {
      put(fileNames, `${g}.${eg}`, slug, "fileNames-glob-combo");
      stats.globsExpanded++;
    }
  }
  const langs = Array.isArray(e.languages) ? e.languages.flatMap((l) => (typeof l === "string" ? [l] : l.ids ? (Array.isArray(l.ids) ? l.ids : [l.ids]) : [])) : [];
  for (const l of langs) put(languageIds, String(l).toLowerCase(), slug, "languageIds");
}

// ---- folders ----
const folderNames = {};
for (const e of bundle.folderExtensions.supported) {
  if (e.disabled) { stats.skippedDisabled++; continue; }
  const slug = slugFor("folder-type", e.icon);
  if (!slug) continue;
  for (const x of e.extensions || []) put(folderNames, x, slug, "folderNames");
}

console.log(JSON.stringify(stats));
console.log("CONFLICTS:", JSON.stringify(conflicts));
console.log("MISSING-sample:", JSON.stringify(missing.slice(0, 20)), "total files mapped:", Object.keys(fileExtensions).length, "names:", Object.keys(fileNames).length, "langs:", Object.keys(languageIds).length, "folders:", Object.keys(folderNames).length);

const used = new Set(["default-file", "default-folder", "default-folder-opened"]);
for (const m of [fileNames, fileExtensions, languageIds, folderNames]) for (const s of Object.values(m)) {
  used.add(s);
  if (s.startsWith("folder-type-")) used.add(`${s}-opened`);
}
const subset = { prefix: iconsJson.prefix, width: iconsJson.width, height: iconsJson.height, icons: {}, aliases: iconsJson.aliases || {} };
for (const s of used) if (icons[s]) subset.icons[s] = icons[s];
const notFound = [...used].filter((s) => !icons[s]);
console.log("USED:", used.size, "SUBSET:", Object.keys(subset.icons).length, "NOTFOUND:", JSON.stringify(notFound.slice(0, 20)));
writeFileSync("/tmp/vsgen/maps.json", JSON.stringify({ fileNames, fileExtensions, languageIds, folderNames }, null, 1));
writeFileSync("/tmp/vsgen/subset.json", JSON.stringify(subset));

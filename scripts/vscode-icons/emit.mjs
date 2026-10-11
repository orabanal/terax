// Reads ./maps.json (from transform.mjs) and rewrites fileIcons.ts /
// folderIcons.ts in src/modules/explorer/lib. Run from the repo root:
//   node scripts/vscode-icons/emit.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const maps = JSON.parse(
  readFileSync(join(root, "scripts/vscode-icons/maps.json"), "utf8"),
);
const OUT = join(root, "src/modules/explorer/lib");

function buildCombined() {
  const rec = {};
  const add = (slug, kind, key) => {
    (rec[slug] ??= {});
    (rec[slug][kind] ??= []).push(key);
  };
  for (const [k, s] of Object.entries(maps.fileExtensions)) add(s, "fileExtensions", k);
  for (const [k, s] of Object.entries(maps.fileNames)) add(s, "fileNames", k);
  for (const [k, s] of Object.entries(maps.languageIds)) add(s, "languageIds", k);
  for (const slug of Object.keys(rec))
    for (const kind of ["fileExtensions", "fileNames", "languageIds"])
      if (rec[slug][kind]) rec[slug][kind].sort();
  return Object.fromEntries(
    Object.entries(rec).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

const kinds = ["fileExtensions", "fileNames", "languageIds"];
const rec = buildCombined();
let body = `/**\n * File icon associations for the vscode-icons theme.\n * GENERATED — do not hand-edit. Regenerate:\n *   node scripts/vscode-icons/transform.mjs && node scripts/vscode-icons/emit.mjs\n * Keys are iconify slugs; keep sorted.\n */\n\ntype FileIcons = Record<\n  string,\n  {\n    languageIds?: Array<string>;\n    fileExtensions?: Array<string>;\n    fileNames?: Array<string>;\n  }\n>;\n\n// @keep-sorted\nconst fileIcons: FileIcons = {\n`;
for (const [slug, v] of Object.entries(rec)) {
  body += `  "${slug}": {\n`;
  for (const k of kinds)
    if (v[k])
      body += `    ${k}: [\n${v[k].map((x) => `      "${x}",`).join("\n")}\n    ],\n`;
  body += `  },\n`;
}
body += `};\n\nconst languageIds: Record<string, string> = {};\nconst fileExtensions: Record<string, string> = {};\nconst fileNames: Record<string, string> = {};\nfor (const [name, icon] of Object.entries(fileIcons)) {\n  for (const c of icon.languageIds ?? []) languageIds[c] = name;\n  for (const c of icon.fileExtensions ?? []) fileExtensions[c] = name;\n  for (const c of icon.fileNames ?? []) fileNames[c] = name;\n}\n\nexport { fileExtensions, fileIcons, fileNames, languageIds };\n`;
writeFileSync(`${OUT}/fileIcons.ts`, body);

const byShort = {};
for (const [name, slug] of Object.entries(maps.folderNames)) {
  const short = slug.replace(/^folder-type-/, "");
  (byShort[short] ??= []).push(name);
}
for (const s of Object.keys(byShort)) byShort[s].sort();
let fbody = `/**\n * Folder icon associations for the vscode-icons theme.\n * GENERATED — do not hand-edit. Regenerate:\n *   node scripts/vscode-icons/transform.mjs && node scripts/vscode-icons/emit.mjs\n * Keys are short icon names (without folder-type- prefix); keep sorted.\n */\n\ntype FolderIcons = Record<\n  string,\n  {\n    folderNames?: Array<string>;\n  }\n>;\n\n// @keep-sorted\nconst folderIcons: FolderIcons = {\n`;
for (const short of Object.keys(byShort).sort()) {
  const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(short) ? short : JSON.stringify(short);
  fbody += `  ${key}: {\n    folderNames: [\n${byShort[short].map((x) => `      "${x}",`).join("\n")}\n    ],\n  },\n`;
}
fbody += `};\n\nconst folderNames: Record<string, string> = {};\nfor (const [name, icon] of Object.entries(folderIcons)) {\n  for (const c of icon.folderNames ?? []) folderNames[c] = \`folder-type-\${name}\`;\n}\n\nexport { folderIcons, folderNames };\n`;
writeFileSync(`${OUT}/folderIcons.ts`, fbody);
console.log("emitted", Object.keys(rec).length, "file icons,", Object.keys(byShort).length, "folder icons");

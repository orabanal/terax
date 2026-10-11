# vscode-icons manifest → icon tables

Regenerates `src/modules/explorer/lib/fileIcons.ts` and `folderIcons.ts`
from the upstream manifests when `@iconify-json/vscode-icons` is updated
(slugs renamed/added/removed).

## Steps (repo root)

1. Download `supportedExtensions.ts`, `supportedFolders.ts`,
   `languages.ts` from vscode-icons/vscode-icons
   (`src/iconsManifest/`) plus a `models.ts` stub exporting
   `FileFormat`, and bundle an entry re-exporting both `extensions`
   collections to CJS with esbuild.
2. `node scripts/vscode-icons/transform.mjs` — reads `./bundle.cjs`
   and the installed `@iconify-json/vscode-icons/icons.json`, verifies
   every slug exists, writes `maps.json`.
3. `node scripts/vscode-icons/emit.mjs` — rewrites the two tables
   (keys sorted).
4. `pnpm check-types && pnpm test && pnpm build`

Rules baked in: skip `disabled` entries, first manifest entry wins
conflicts, `filename: true` → full-name matches, bare `filenamesGlob`
+ `glob × extensionsGlob` combos → full-name matches, all keys
lowercased, every slug verified against icons.json.

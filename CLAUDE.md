# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Terax is an open-source AI-native terminal emulator built on Tauri 2 + Rust (backend) and React 19 + TypeScript (frontend). ~7-8 MB bundle, no telemetry, no account required.

## Commands

```bash
# Dev / build
pnpm install
pnpm tauri dev          # full app in dev mode
pnpm tauri build        # production bundle

# Frontend checks
pnpm lint               # biome lint src/
pnpm lint:fix           # biome lint --write src/
pnpm format             # biome format --write src/
pnpm check-types        # tsc --noEmit
pnpm test               # vitest run
pnpm test:watch         # vitest (watch mode)

# Rust checks
cd src-tauri && cargo clippy --all-targets --locked -D warnings
cd src-tauri && cargo test --locked
```

All checks must pass before a change ships: `pnpm lint`, `pnpm check-types`, `pnpm test`, `cargo clippy`, `cargo test --locked`.

## Architecture

### Two-process model

**Rust (`src-tauri/src/`)** owns all OS access — the webview never touches FS, processes, or shells directly. Everything goes through `invoke()` calls registered in `src-tauri/src/lib.rs`:

- `pty::pty_*` — long-lived PTY sessions (xterm.js ↔ portable-pty), managed by `PtyState` (`RwLock<HashMap<id, Session>>`), streamed via Tauri `Channel<PtyEvent>`
- `fs::*` — file tree (`fs_read_dir`), file IO (`fs_read_file`, `fs_write_file`), mutate (`fs_create_file`, `fs_delete`, `fs_rename`), search (`fs_search`, `fs_list_files`), grep/glob
- `git::commands::*` — full source-control surface (`git_status`, `git_diff`, `git_stage`, `git_commit`, `git_push`, `git_log`, etc.), gated by the workspace authorization registry
- `shell::shell_run_command` — one-shot subshell exec used by AI tools (distinct from the user's PTY)
- `shell::shell_session_*` / `shell_bg_*` — persistent agent shell + long-running background processes with ring-buffer log capture
- `net::*` — AI HTTP proxy with SSRF guard (`ai_http_request`, `ai_http_stream`, `lm_ping`); keeps provider calls off the webview
- `secrets::secrets_*` — OS keychain via the `keyring` crate; service constant `terax-ai`. Keys never touch disk or localStorage
- `workspace::*` — workspace authorization registry + WSL bridge

**Frontend (`src/`)** is a single-window React app. Path alias `@/*` → `src/*`. New features go in `src/modules/<area>/`.

### Tab model

Tabs are a tagged union (`kind`: `terminal` | `editor` | `preview` | `markdown` | `ai-diff` | `git-diff` | `git-history` | `git-commit-file`). Tabs are **never unmounted on switch** — hidden via `invisible pointer-events-none` so PTYs and dev servers keep streaming.

### Module layout (`src/modules/`)

Each module is self-contained, exports via `index.ts`, and owns its hooks under `lib/`.

- **terminal/** — `TerminalStack` keeps one mounted xterm per tab via `useTerminalSession` + `pty-bridge`. `osc-handlers.ts` parses OSC 7 (cwd) and OSC 133 (prompt boundaries / exit codes). xterm color palette driven by `modules/theme`. Split panes managed by `PaneTreeView` — hover state lives in `TerminalStack` (`hoveredByTab` keyed by tab id) and passes down as flat props; dimming via `filter: brightness(0.7)`, border via `ring-1 ring-inset ring-border/60`.
- **ssh/** — russh 0.61 client. `ssh_open` / `ssh_write` / `ssh_resize` / `ssh_close` Tauri commands in `src-tauri/src/modules/ssh/mod.rs`. `nodelay: true` on the russh Config disables Nagle's algorithm. Frontend: `openSshPty()` in `pty-bridge.ts`, `SshConnectingModal` (one per leaf, tracks status via `sshStatusListeners` map, auto-focuses terminal on connect). SSH hosts stored in `terax-ssh-hosts.json` via `LazyStore`.
- **editor/** — CodeMirror 6 stack. `extensions.ts` configures language modes, vim mode, and prebuilt themes.
- **ai/** — BYOK providers via `@ai-sdk/*`. Agent in `lib/agent.ts` (`Experimental_Agent`). Sessions persisted via `tauri-plugin-store` at `terax-ai-sessions.json`. Tools in `tools/tools.ts` — destructive tools (`write_file`, `run_command`, etc.) set `needsApproval: true`. Security deny-list in `lib/security.ts` applies to both read and write paths. **AI Sidebar** (`components/AiSidebar.tsx`) is the sole AI interface — lazy-loaded, resizable (min 360px, drag handle on left edge), per-tab open state managed in `App.tsx` via `useRef<Map<number, boolean>>`. Scope per tab: `terminal:<leafId>` (per active pane) or `workspace:<tabId>`. Each sidebar is fully independent: session, model/endpoint, permission mode, and active agent are all scoped independently via `selectedModelByScope`, `permissionModeByScope` in `chatStore`, and `activeIdByScope` in `agentsStore`. The transport in `chatRuntime.ts` resolves all values from the session's scope key at call time. The old mini-window, bottom input bar, and selection-ask-AI have been removed.
- **theme/** — custom theme engine. `ThemeProvider` + `applyTheme` write CSS variables. No `next-themes`.
- **tabs/** — `useTabs` is source of truth for tab list + active id.
- **settings/** — settings store via `tauri-plugin-store`.
- **agents/** — agent notifications for the built-in Terax agent and terminal coding agents (Claude Code). Shared store in `store/agentStore.ts`; terminal detection is Rust-side in `pty/agent_detect.rs`.

### PTY shell integration

Shell init scripts in `src-tauri/src/modules/pty/scripts/` inject OSC 7 (cwd) and OSC 133 (prompt boundaries + exit code) sequences. Unix uses `ZDOTDIR` (zsh) or `--rcfile` (bash); Windows uses `pwsh -File <profile.ps1>`. Platform-specific code in `pty/shell_init.rs` stays in `#[cfg(unix)]` / `#[cfg(windows)]` arms.

## Conventions

- **Imports**: always `@/...` on the frontend, never relative across modules
- **Package manager**: pnpm only — never npm/npx/yarn
- **Comments**: default to none; 1-2 lines on *why* only when genuinely needed
- **No em-dashes** anywhere (code, comments, commits, docs)
- **No emojis** anywhere
- **Cross-platform paths**: split on `/[\\/]/` not `"/"`. Canonical frontend form is forward-slash; convert backslashes at the boundary (see `App.tsx setHome`)
- **UI components**: `shadcn/ui` primitives in `src/components/ui/` — regenerate with `pnpm dlx shadcn add`, don't hand-edit
- **Tailwind v4**: config is in `src/App.css` via `@theme`, no `tailwind.config.*`. Use `cn()` from `@/lib/utils`
- **Architecture**: new logic lives in pure, dependency-light functions (functional core); Tauri commands and React components stay thin (imperative shell)

## Key gotchas

- `AiComposerProvider` is mounted unconditionally at `App.tsx` root — a conditional wrapper would remount the entire tree (and re-spawn every PTY) when keys load. Keep it unconditional.
- AI sidebar open state is per-tab (`aiSidebarOpenRef` in `App.tsx`), not global. The `panelOpen`/`openPanel`/`closePanel` in `chatStore` are legacy and no longer drive the sidebar. New code should use the per-tab map.
- AI sidebar is lazy-loaded (`components/lazy.tsx`) to keep `@ai-sdk/react` out of the eager bundle budget (enforced by `eager-budget.test.ts`).
- Windows `SPAWN_LOCK` mutex in `session.rs` serializes `openpty + spawn_command` — do not remove without verifying stability under fast tab creation.
- Windows Job Object in `pty/job.rs` ensures descendant processes are killed when Terax exits. Do not disable without a replacement.
- New Tauri plugins require three steps: `Cargo.toml` dep, `.plugin(...)` in `lib.rs run()`, and a capability entry in `src-tauri/capabilities/default.json`.
- Use `dirs` crate (`dirs::home_dir()`, `dirs::cache_dir()`) for HOME/cache paths, never raw `$HOME` / `%USERPROFILE%`.
- Send `\r` (CR) for Enter in PTY input, not `\n` — PowerShell requires CR.

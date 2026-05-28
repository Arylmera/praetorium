# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

**Praetorium** — a local desktop app for exploring your Obsidian-style vault and monitoring live Claude Code sessions. It reads `~/.claude/projects/**/*.jsonl` files (via `notify` fs-watcher) and drives the `claude` CLI as a subprocess (streaming JSON events over a Tauri IPC channel). The UI has three main tabs: **Console** (live session feed), **Cockpit** (metrics + graph), and **Explorer** (vault files + link map + sessions). Built with React 18 + esbuild, shipped as a Tauri 2 desktop app.

## Status

**0.7.x line — React + Rust + Tauri.** The earlier SolidJS + TypeScript frontend has been fully replaced with React 18 + plain JSX; the old single `src-tauri` crate has been split into a three-crate workspace. Frontend builds clean with `npm run build`; 40+ Rust tests across `core` + `cli`; 140+ frontend unit tests via Node's built-in runner. Tauri shell verified on Windows; macOS and Linux QA via CI.

## Architecture

```
crates/
  praetorium-core/   Parser, events types, session_parse, sessions,
                     vault fs/parse logic. Pure library — no Tauri,
                     no process model, no async runtime. Owns all
                     fixture/unit tests.
  praetorium-cli/    Thin inspection binary (`praetorium-cli`).
                     Subcommands: parse-session <file>,
                     vault-index <dir>. Depends on core only.
  praetorium-tauri/  Tauri 2 desktop shell. Modules:
                       process.rs   — spawns `claude` CLI, streams
                                      ClaudeEvents via Tauri Channel.
                       session_watch.rs — notify watcher on
                                      ~/.claude/projects/, pumps new
                                      JSONL lines to frontend.
                       sessions.rs / vault.rs — #[tauri::command]
                                      wrappers calling core.
                     Transport: Tauri `invoke` + events (no HTTP/SSE).

src/                 React 18 + esbuild frontend.
  app.jsx            App shell, view router (ROUTES map).
  components/        Kebab-case .jsx files (console.jsx,
                     cockpit.jsx, explorer.jsx, settings.jsx,
                     ambient-canvas.jsx, command-palette.jsx, …).
  stores/            Plain-JS createStore modules (see below).
  lib/               Pure logic + *.node-test.mjs test files.
  themes/
    styles.css       Single bundled stylesheet (~830 lines).
    theme.js         THEMES list, THEME_SWATCHES, themeStore.
    fonts/           Vendored woff2 (Inter + JetBrains Mono).
  assets/            Brand SVGs and PNGs.

scripts/
  build.mjs          Assembles a self-contained dist/:
                     app.js + index.html + styles.css + fonts/ + assets/.
dist/                Build output (gitignored). Must exist before
                     `cargo tauri build` or `cargo tauri dev`.
docs/                Design notes, roadmap, parity guide.
```

## Data source

Claude Code writes one JSONL file per session to `~/.claude/projects/<project-slug>/<session-id>.jsonl`. `session_watch.rs` uses the `notify` crate to watch that directory tree recursively; on `Modify`/`Create` events for `.jsonl` files it reads new bytes (byte-offset tracked per path) and emits parsed lines to the frontend through a Tauri IPC `Channel<WatchEvent>`.

`process.rs` drives the `claude` CLI directly (`tokio::process::Command`) for the Console's live-run flow: spawns `claude -p <prompt> --output-format stream-json`, sanitises env vars that would put it into nested/API mode (`CLAUDECODE`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_*`), and pipes `stdout`/`stderr` line-by-line through `praetorium_core::parser::parse_line` → `Channel<ClaudeEvent>`. Stdin is pinned to null to avoid the "no stdin data received" stall.

## Conventions

- **`praetorium-core` is a pure library.** No Tauri types, no async runtime, no process spawning. Keep it that way — it must compile in any context (CLI, tests, future targets).
- **Stores are plain-JS `createStore` modules.** Each store is a self-contained ES module that calls `createStore(initial)` and exports named accessors. Components subscribe via `useStore(store)` (a one-liner `useSyncExternalStore` bridge). No global state objects, no context providers.
- **rusqlite is not used.** This app has no SQLite database — data comes from live fs reads + the core library. Don't add a db layer.
- **Kebab-case component files.** `console.jsx`, `ambient-canvas.jsx`, etc. Matches the `pr-*` CSS class naming.
- **Small files with clear responsibilities.** If a file grows past ~600 lines or accretes three distinct concerns, split it.
- **No TypeScript, no Vite, no vitest.** Tests run with `node --test` against `*.node-test.mjs` files in `src/lib/`.

## Tauri build prereqs

The frontend bundle must exist at `dist/` before `cargo tauri build` or `cargo tauri dev`. Build it once (or keep it live):

```bash
# One-shot production build — clean dist/, bundle app.js, copy statics
npm run build

# Iterative watch — rebuilds dist/app.js on every src/ save
npm run dev
```

`scripts/build.mjs` does the full assembly: runs esbuild (`entry.jsx → dist/app.js`), copies `index.html` (rewriting asset paths), `src/themes/styles.css`, `src/themes/fonts/`, and `src/assets/` into `dist/`.

`tauri.conf.json` (`crates/praetorium-tauri/`) sets `frontendDist: "../../dist"` and `beforeDevCommand`/`beforeBuildCommand: "npm run build"`.

For iterative frontend work, run `npm run dev` in one terminal (esbuild `--watch` + sourcemap) and `cargo tauri dev` in another — the webview auto-reloads on `dist/app.js` changes.

## Frontend cache (avoid re-reading hot files)

**`src/themes/styles.css`** (~830 lines) — single bundled stylesheet, do not split (esbuild order matters).

- **Root scope:** `.pr-root` on the app wrapper; theme via `data-theme="<key>"` on the same element. Bare `.pr-root` (no attr) = canonical dark baseline. Glass-mode toggle: `.pr-root.is-glass`. Motion gate: `[data-reduce-motion="1"]` on `.pr-root`.
- **Token layer** (every component reads these; theme blocks override only the var layer):
  - Surfaces: `--bg`, `--panel` / `--panel-solid`, `--panel-2` / `--panel-2-solid`
  - Borders: `--iron-border`, `--iron-border-2`
  - Text: `--bone` (primary), `--gull` (muted), `--gull-2` (faint)
  - Accent (≤10% of screen): `--accent`, `--accent-2`
  - Status: `--good`, `--pos`, `--warn`, `--bad`
  - Grid/misc: `--grid-dot`
  - Typography: `--font-prose` (Inter), `--font-mono` (JetBrains Mono); semantic composites `--t-headline`, `--t-title`, `--t-body`, `--t-label`, `--t-nav`, `--t-mono`, `--t-axis`, `--t-brand-prompt`, `--t-brand-sub`, `--t-card-title`, `--t-kpi-label`, `--t-metric`, `--t-metric-sm`
  - Scales: `--space-1..6`, `--radius-*`, `--dur-*` + `--ease`, `--shadow-*`
  - Back-compat aliases: `--fg`, `--border`, `--danger`, `--r-*`, `--bw-*`, `--t-fast/base/slow` — prefer canonical tokens in new code.
- **Two-voice font rule:** Inter (`--font-prose`) carries prose + body text only. JetBrains Mono (`--font-mono`) carries the brand prompt, nav, card titles, and every number/identifier.
- **Theme keys** (`data-theme`):
  - Light: `paper`, `linen`, `mint`, `lilac`, `bb-light`, `cyber-light`
  - Dark: `forge`, `forest`, `dusk`, `ocean`, `matrix`, `rose`, `bb-dark`, `cyber-dark`, `dim` (+ bare `.pr-root` = base dark)
  - Special (swap display fonts + drive `AmbientCanvas`): `terminal`, `cockpit`, `grimdark`
- **Component classes** (all `pr-*`): `.pr-topbar`, `.pr-statusbar`, `.pr-card`, `.pr-console-grid`, `.pr-session-group`, `.pr-session-sub`, `.pr-session-observed`, `.pr-spawn-marker`, `.pr-crumb-loc`, `.pr-explorer`, `.pr-subnav`, `.pr-explorer-pane`, `.pr-settings`, `.pr-set-card`, `.pr-card-head`, `.pr-set-body`, `.pr-set-section`, `.pr-group-label`, `.pr-theme-grid`, `.pr-theme-chip`, `.pr-theme-preview`, `.pr-page-enter`, `.pr-brand-dot`, `.pr-prompt-path`, `.pr-prompt-ps1`, `.pr-prompt-cmd`, `.pr-prompt-flag`, `.pr-prompt-val`, `.pr-prompt-cursor`, `.pr-brand-sub`, `.pr-topbar-actions`.

**Store pattern** (`src/stores/`):

| File | Purpose |
|---|---|
| `create-store.js` | Factory: `createStore(initial)` → `{ get, set, subscribe }` |
| `use-store.js` | React bridge: `useStore(store)` = `useSyncExternalStore(store.subscribe, store.get)` |
| `view-store.js` | Active view (console/cockpit/explorer/settings) |
| `vault-store.js` | Vault path |
| `session-store.js` | Live session data from watcher |
| `run-store.js` | Active `claude` run state |
| `explorer-store.js` | Explorer sub-view (files/map/sessions) |
| `settings.js` | Glass, reduce-motion, layout name |
| `src/themes/theme.js` | Active theme key + THEMES list + swatches |

## Customizing

No `PRAETORIUM_*` env vars are defined. The app has no embedded server and no database path to configure. The vault path is set at runtime in the Settings UI and persisted in the Tauri window's `localStorage`.

## Verifying changes

```bash
cargo build --workspace
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

Frontend:

```bash
npm run build        # verify dist/ assembles
node --test          # run *.node-test.mjs suite (~140 tests)
cargo tauri dev      # smoke-test the desktop window
```

# Praetorium → React + esbuild port and core/cli/tauri crate split

**Date:** 2026-05-28
**Branch:** `claude/react-esbuild-port`
**Status:** Design approved, pending spec review

## Goal

Re-platform Praetorium's frontend from SolidJS + Vite + TypeScript onto the
Token Dashboard stack (React 18 + esbuild + plain JSX), and restructure the
Rust backend from a single `src-tauri` crate into a `core` / `cli` / `tauri`
workspace. The driving objective is **future mergeability**: after this work,
porting Praetorium's three tabs (Console, Cockpit, Explorer) into the Token
Dashboard app should be a code *move*, not a redesign. Every decision below is
made to minimize the eventual integration cost.

Transport stays Tauri `invoke` + events (no axum/SSE) — live session streaming
fits the Tauri event bus better than HTTP, and the scope explicitly keeps it.

## Decisions

| Axis | Choice | Rationale (for future TD merge) |
|------|--------|-------------------------------|
| Framework | SolidJS → **React 18** | Matches TD exactly. |
| Build | Vite → **esbuild** (one-liner in `package.json`) | Matches TD's `entry.jsx → dist/app.js` pipeline. |
| Language | TS → **plain JSX/JS** | Matches TD; no per-repo type config to reconcile. |
| Tests | vitest → **`node --test` + `.node-test.mjs`** | Matches TD's runner; keeps pure-logic coverage. |
| Assets | **static** (CSS/fonts/images served, not bundled) | Matches TD; esbuild bundles JS only. |
| Store bridge | **`useSyncExternalStore` + tiny `createStore`** | Self-contained plain-JS store modules drop into any React app, including TD, with no dependency on TD-specific `window` globals. |
| Rust layout | single crate → **`core` / `cli` / `tauri`** | 1:1 with TD's workspace; merge becomes a crate move. |
| CSS classes | **keep `pr-*`**, rename wrapper `.td-root` → `.pr-root` | `pr-*` is already namespaced/good; renaming all classes is high-churn zero-value. Wrapper rename avoids a literal name collision with Token Dashboard. |

### Explicitly out of scope

- Renaming the `pr-*` component class vocabulary to TD's `a-*`. Cosmetic, ~830
  lines of churn, no functional gain. The parity doc records the mapping instead.
- Adopting axum/SSE. Transport stays Tauri events.
- Any feature changes. This is a re-platform; behavior is preserved 1:1.

## Target architecture

```
praetorium/
  Cargo.toml                  ← NEW workspace root (members = crates/*)
  crates/
    praetorium-core/          pure library — no Tauri, no process spawning:
                                parser.rs, session_parse.rs, event types,
                                vault indexing, session listing/reading.
                                Owns the fixture tests.
    praetorium-cli/           thin bin — headless inspection surface, e.g.
                                `praetorium parse-session <file>` dumps JSON.
                                Links core. Mirrors TD's cli crate.
    praetorium-tauri/         desktop shell — process.rs (claude subprocess),
                                session_watch.rs (notify watcher),
                                #[tauri::command] wrappers, glass, builder.
                                Links core.
  frontend/
    package.json              esbuild build/dev + node --test scripts
    index.html                links styles.css + dist/app.js statically
    entry.jsx                 React root mount (createRoot)
    src/
      app.jsx                 shell + hash/view routing (ROUTES map)
      lib/                    pure logic → .js + .node-test.mjs
      stores/                 plain-JS createStore modules + useStore hook
      components/             React .jsx, kebab-case filenames
      themes/                 styles.css (was tokens.css), vendored fonts
  src-tauri/                  → moved to crates/praetorium-tauri/
```

### Rust module routing (split of today's `src-tauri/src/*.rs`)

| Today | Destination | Why |
|-------|-------------|-----|
| `parser.rs` | core | Pure: claude stream-json → events. |
| `session_parse.rs` | core | Pure: transcript JSONL parsing. |
| `events.rs` (types) | core | Shared event/data types. |
| pure parts of `sessions.rs` | core | File reading/listing logic. |
| pure parts of `vault.rs` | core | Vault index + wikilink resolution. |
| `#[tauri::command]` wrappers from `sessions.rs`/`vault.rs` | tauri | Thin shims calling core. |
| `process.rs` | tauri | Spawns claude, emits to window — process model. |
| `session_watch.rs` | tauri | notify watcher, emits Tauri events. |
| `lib.rs` (glass, builder, handler) | tauri | Tauri runtime wiring. |
| `tests/fixtures` + fixture tests | core | Test the pure library. |

This matches TD's "core has no process model — just a library" rule from its
CLAUDE.md.

### CLI crate surface (thin)

`praetorium-cli` exposes core operations for scripting and tests without the
desktop shell:

- `praetorium parse-session <path>` → JSON of parsed session events
- `praetorium vault-index <dir>` → JSON vault index + links

It is intentionally minimal; its purpose is layout parity and a headless
test/debug entry, not a full headless product.

## Frontend port

### Store bridge (the one non-mechanical piece)

A ~15-line helper replaces SolidJS signals:

```js
// stores/create-store.js
export function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? next(value) : next;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}
// stores/use-store.js
import { useSyncExternalStore } from "react";
export const useStore = (store) =>
  useSyncExternalStore(store.subscribe, store.get);
```

Each SolidJS store module (`runStore`, `sessionStore`, `vaultStore`,
`viewStore`, `explorerStore`, `insightsStore`, `settings`) becomes a plain-JS
module built on `createStore`. The exported imperative functions (e.g.
`startRun`, `applyWatch`, `newLocalSession`) carry over almost verbatim —
`setLocalSessions((prev) => …)` maps directly onto `store.set((prev) => …)`.
Components read state with `useStore(store)` where they used `signal()`.

Why not TD's `window`-event + `setNonce` pattern: TD bridges a single
`MOCK_DATA` blob; Praetorium has many independent live stores and a busy
session rail. Per-store subscriptions avoid re-rendering the whole tree on
every streamed event, and the stores stay free of TD-specific globals, so they
import cleanly into TD later.

### Per-file mechanical mapping (Solid → React)

| Solid | React |
|-------|-------|
| `class=` / `classList={{x: c}}` | `className=` / conditional string |
| `onMount(fn)` / `onCleanup(fn)` | `useEffect(() => { fn(); return cleanup }, [])` |
| `createSignal` (local) | `useState` |
| store `signal()` | `useStore(store)` |
| `<Show when={x} keyed>{v => …}</Show>` | conditional render + `key={v}` |
| `<Dynamic component={C} />` | `<C />` via ROUTES map |
| `.tsx` PascalCase filename | `.jsx` kebab-case (TD convention) |
| d3 / canvas imperative code | same code inside `useEffect` + `useRef` |

Components to port (size order): `Console` (439), `Cockpit` (406, d3-force +
d3-hierarchy), `AmbientCanvas` (225, canvas), `explorer/Files` (170),
`explorer/Map` (126, d3), `Settings` (114), `CommandPalette` (112),
`explorer/Sessions` (87), `settings/atoms` (67), `SpecialChrome` (59),
`Explorer` (24), `WindowControls` (23), `ViewSwitcher` (16), `App` (112),
`index` (6).

### Pure logic (ports for free)

`graph.ts`, `layout.ts`, `cockpitView.ts`, `fileTree.ts`, `wikilinks.ts`,
`agentNaming.ts`, `sessionGroup.ts`, `consoleRail.ts`, `linksGraph.ts`,
`commands.ts`, `pipeline`, `types.ts` are framework-agnostic. Port = strip TS
annotations → `.js`; convert each `.test.ts` → `.node-test.mjs`
(`node:test` + `node:assert`). No logic changes.

### Build & assets

- `package.json` scripts mirror TD:
  - `build`: `esbuild entry.jsx --bundle --outfile=dist/app.js --target=es2020 --loader:.jsx=jsx --jsx=automatic --minify --legal-comments=none`
  - `dev`: same with `--sourcemap --watch`
  - `test`: `node --test src/**/*.node-test.mjs`
- React/react-dom as deps; esbuild as devDep. Drop solid-js, vite,
  vite-plugin-solid, vitest, TypeScript, d3 `@types`.
- d3-force / d3-hierarchy / marked stay (runtime deps, framework-agnostic).
- `index.html` links `styles.css` + fonts CSS + `dist/app.js` statically
  (TD pattern); no CSS-in-JS, no esbuild asset loaders.
- SVG/PNG brand assets served statically (plain `<img src>` or inline), not
  imported as Vite modules.

### Tauri config

`tauri.conf.json` switches from the Vite dev server (port 1420) to a static
frontend dir + esbuild watch:
- `build.devUrl` / `build.frontendDist` point at the static `frontend/`
  (index.html + dist/) instead of `http://localhost:1420`.
- Dev loop: `npm run dev` (esbuild `--watch`) resident, Tauri loads the static
  files. Matches TD's "frontend bundle must exist before cargo run" note.

## Documentation produced

1. **This spec** — `docs/superpowers/specs/2026-05-28-praetorium-react-port-design.md`.
2. **Rewritten `CLAUDE.md`** — new stack, crate layout, build prereqs, frontend
   cache notes (theme keys, token vars, class vocabulary), mirroring the
   structure of Token Dashboard's CLAUDE.md.
3. **New `docs/parity.md`** — the cross-app convention map: build pipeline,
   store pattern, crate naming, design-token names, and the `pr-*` ↔ `a-*`
   class mapping. This is the document that makes a future merge a lookup.

## Verification

- `cargo build --workspace` clean; `cargo test --workspace` green (core tests
  carried over from `src-tauri/tests`).
- `cargo fmt --check`, `cargo clippy --all-targets --workspace -- -D warnings`.
- `cd frontend && npm install && npm run build` produces `dist/app.js`;
  `npm test` green (ported pure-logic tests).
- `cargo tauri build` / launch: all three tabs (Console, Cockpit, Explorer) +
  Settings render and behave as they do on `sync-develop-master`. Live session
  streaming, command palette (Ctrl/Cmd+K), themes, and glass all work.
- Behavior parity is judged against the pre-port build — no feature should
  change.

## Risks & mitigations

- **d3 + canvas components (Cockpit, Map, AmbientCanvas)** are the highest-risk
  ports — imperative lifecycles must move into `useEffect`/`useRef` without
  double-init under React StrictMode. Mitigation: port these last, after the
  store/router skeleton is proven, and disable StrictMode double-invoke or make
  effects idempotent.
- **Store re-render fidelity** — Solid's fine-grained tracking vs React's
  component-level re-render. Mitigation: per-store `useSyncExternalStore`
  subscriptions keep updates scoped; verify the live rail doesn't thrash.
- **Crate split compile churn** — moving modules can cascade `use` paths.
  Mitigation: split Rust in its own phase, after the frontend, so the two large
  changes don't interleave.

## Execution model

Subagent-driven (per `superpowers:subagent-driven-development`), phased so each
phase is independently verifiable:

1. Scaffold: branch already created; add esbuild build, React deps, `entry.jsx`,
   `create-store`/`use-store`, static `index.html`.
2. Port pure `lib/` (.js) + tests (`.node-test.mjs`); `npm test` green.
3. Port stores to `createStore` modules.
4. Port leaf components (WindowControls, ViewSwitcher, atoms, SpecialChrome,
   Explorer).
5. Port view components (Console, Settings, CommandPalette, explorer/*).
6. Port d3/canvas components (Cockpit, Map, AmbientCanvas) — highest risk.
7. Port `app.jsx` + routing; rename `.td-root` → `.pr-root`; wire styles.css.
8. Tauri config → static frontend; verify desktop launch.
9. Rust crate split (core / cli / tauri); `cargo test --workspace` green.
10. Docs: rewrite CLAUDE.md, write parity.md.
11. Full verification pass.
```

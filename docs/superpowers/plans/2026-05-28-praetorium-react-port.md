# Praetorium React/esbuild Port + Crate Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-platform Praetorium's frontend from SolidJS+Vite+TS to React 18 + esbuild + plain JSX, and split the Rust backend into a `core`/`cli`/`tauri` workspace, preserving behavior 1:1 and matching Token Dashboard conventions for future merge.

**Architecture:** React 18 with a tiny `useSyncExternalStore`-based store helper replaces SolidJS signals. esbuild bundles `entry.jsx → dist/app.js`; CSS/fonts/images stay static. Rust splits into a pure `core` library, a thin `cli` bin, and a `tauri` shell that owns the process/watcher model. Transport stays Tauri `invoke` + events.

**Tech Stack:** React 18, esbuild, `node:test`, Tauri 2, Rust (cargo workspace), d3-force/d3-hierarchy, marked.

**Spec:** `docs/superpowers/specs/2026-05-28-praetorium-react-port-design.md`

**Working branch:** `claude/react-esbuild-port` (already created).

---

## Solid → React mapping (reference for every component task)

Apply this table whenever porting a `.tsx` component to `.jsx`:

| SolidJS | React |
|---------|-------|
| `class="x"` | `className="x"` |
| `classList={{ a: cond }}` | `className={cond ? "... a" : "..."}` |
| `style={{ "min-height": "0" }}` | `style={{ minHeight: 0 }}` (camelCase keys) |
| `onMount(fn)` | `useEffect(() => { fn() }, [])` |
| `onCleanup(fn)` | return `fn` from the same `useEffect` |
| `createSignal(v)` (component-local) | `useState(v)` |
| `createMemo(() => expr)` | `useMemo(() => expr, [deps])` |
| store `signalName()` read | `useStore(storeName)` |
| `<Show when={c}>…</Show>` | `{c && (…)}` |
| `<Show when={c} fallback={f}>…</Show>` | `{c ? (…) : f}` |
| `<Show when={v} keyed>{(x) => …}</Show>` | `{v != null && <Frag key={v}>{render(v)}</Frag>}` |
| `<For each={xs}>{(x) => …}</For>` | `{xs.map((x) => …)}` (add `key`) |
| `<Dynamic component={C} />` | `<C />` (look C up in a ROUTES map) |
| event `onClick={fn}` | same (`onClick={fn}`) — already compatible |
| `props.children` | `props.children` — same |
| signal setter `setX(v)` / `setX(p => …)` | store `x.set(v)` / `x.set(p => …)` |

**StrictMode caution:** d3/canvas effects must be idempotent or guard against React 18 StrictMode's double-invoke. Do NOT wrap the app in `<StrictMode>` in `entry.jsx` (TD doesn't); this avoids double-mount for imperative d3/canvas code.

**Filename rule:** PascalCase `.tsx` → kebab-case `.jsx` (e.g. `CommandPalette.tsx` → `command-palette.jsx`). Update all imports.

---

## Phase 1 — Frontend scaffold

### Task 1: esbuild + React package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace package.json deps/scripts**

```json
{
  "name": "praetorium",
  "version": "0.7.1",
  "description": "",
  "type": "module",
  "scripts": {
    "dev": "esbuild entry.jsx --bundle --outfile=dist/app.js --target=es2020 --loader:.jsx=jsx --jsx=automatic --sourcemap --watch",
    "build": "esbuild entry.jsx --bundle --outfile=dist/app.js --target=es2020 --loader:.jsx=jsx --jsx=automatic --minify --legal-comments=none",
    "test": "node --test",
    "tauri": "tauri"
  },
  "license": "MIT",
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2.7.1",
    "@tauri-apps/plugin-opener": "^2",
    "@tauri-apps/plugin-shell": "^2.3.5",
    "d3-force": "^3.0.0",
    "d3-hierarchy": "^3.1.2",
    "marked": "^18.0.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "esbuild": "^0.24.0"
  }
}
```

Note: `node --test` auto-discovers `*.test.mjs`/`*.node-test.mjs` recursively. Dropped: solid-js, vite, vite-plugin-solid, vitest, typescript, d3 `@types`.

- [ ] **Step 2: Install**

Run: `npm install`
Expected: installs without error; `node_modules/react` and `node_modules/esbuild` present.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: switch frontend to React 18 + esbuild"
```

### Task 2: Store helper

**Files:**
- Create: `src/stores/create-store.js`
- Create: `src/stores/use-store.js`
- Test: `src/stores/create-store.node-test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// src/stores/create-store.node-test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./create-store.js";

test("get returns initial value", () => {
  const s = createStore(1);
  assert.equal(s.get(), 1);
});

test("set with value updates and notifies", () => {
  const s = createStore(0);
  let seen = 0;
  s.subscribe(() => { seen = s.get(); });
  s.set(5);
  assert.equal(s.get(), 5);
  assert.equal(seen, 5);
});

test("set with updater fn receives prev", () => {
  const s = createStore(2);
  s.set((p) => p + 3);
  assert.equal(s.get(), 5);
});

test("unsubscribe stops notifications", () => {
  const s = createStore(0);
  let calls = 0;
  const off = s.subscribe(() => { calls += 1; });
  s.set(1);
  off();
  s.set(2);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test src/stores/create-store.node-test.mjs`
Expected: FAIL — cannot find `./create-store.js`.

- [ ] **Step 3: Implement create-store.js**

```js
// src/stores/create-store.js
export function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? next(value) : next;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
```

- [ ] **Step 4: Implement use-store.js**

```js
// src/stores/use-store.js
import { useSyncExternalStore } from "react";

export const useStore = (store) =>
  useSyncExternalStore(store.subscribe, store.get);
```

- [ ] **Step 5: Run test, verify pass**

Run: `node --test src/stores/create-store.node-test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/stores/
git commit -m "feat(frontend): add createStore + useStore react bridge"
```

### Task 3: index.html + entry.jsx static shell

**Files:**
- Modify: `index.html`
- Create: `entry.jsx`

- [ ] **Step 1: Read current index.html** to preserve `<head>` meta, CSP, and font links. Then rewrite the body to mount a single root and load the static bundle.

- [ ] **Step 2: Write index.html**

Reference the static stylesheet (Task in Phase 7 renames tokens.css → styles.css; until then keep current CSS link) and the esbuild bundle. Body:

```html
<body>
  <div id="root"></div>
  <script type="module" src="/dist/app.js"></script>
</body>
```

Keep existing `<head>` font preloads and any CSP meta already present.

- [ ] **Step 3: Write entry.jsx**

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./src/app.jsx";

createRoot(document.getElementById("root")).render(<App />);
```

Note: no `<StrictMode>` wrapper (avoids double-init of d3/canvas effects).

- [ ] **Step 4: Build to verify wiring**

Run: `npm run build`
Expected: FAIL — `./src/app.jsx` not found yet. (App is ported in Phase 7.) This is expected; defer the green build to Task in Phase 7. Do not commit a broken build as "working."

- [ ] **Step 5: Commit scaffold**

```bash
git add index.html entry.jsx
git commit -m "feat(frontend): static index.html + react entry point"
```

---

## Phase 2 — Port pure logic (`src/lib/*.ts` → `.js`, tests → `.node-test.mjs`)

These modules are framework-agnostic. For EACH module below: read the `.ts`
file, strip type annotations to produce a `.js` file with identical logic, and
convert its `.test.ts` to `.node-test.mjs` using `node:test` + `node:assert/strict`.

**Modules (no SolidJS imports — verify each has none before porting):**
`graph.ts`, `layout.ts`, `cockpitView.ts`, `fileTree.ts`, `wikilinks.ts`,
`agentNaming.ts`, `sessionGroup.ts`, `consoleRail.ts`, `linksGraph.ts`,
`commands.ts`, `types.ts` (types file → delete or keep as JSDoc-only; it has no
runtime code, so usually just remove and inline any runtime constants).

### Task 4: Port `types.ts`

**Files:**
- Delete: `src/lib/types.ts`

- [ ] **Step 1:** Read `src/lib/types.ts`. It is type-only (interfaces/type
  aliases). Confirm no runtime exports (no `const`/`function`). If type-only,
  delete it. If it has runtime constants, move them into the consuming module.
- [ ] **Step 2:** Grep for `from "./types"` / `from "../lib/types"` imports;
  remove those import lines (types vanish in plain JS).

Run: `grep -rn "lib/types" src/` → expected: no remaining references after cleanup.

- [ ] **Step 3: Commit**

```bash
git add -A src/lib/
git commit -m "refactor(frontend): drop type-only types.ts"
```

### Task 5: Port test-covered pure modules

For EACH of: `graph`, `layout`, `cockpitView`, `fileTree`, `wikilinks`,
`agentNaming`, `sessionGroup`, `consoleRail`, `linksGraph`, `commands` — repeat
this loop (one commit per module):

- [ ] **Step 1:** Read `src/lib/<mod>.ts` and `src/lib/<mod>.test.ts`.
- [ ] **Step 2:** Create `src/lib/<mod>.js`: copy the source, strip type
  annotations (`: Type`, `<T>`, `interface`, `type X =`, `as X`, `satisfies`),
  keep ALL logic, imports (update `.ts`→`.js` extensions if any explicit), and
  exports identical.
- [ ] **Step 3:** Create `src/lib/<mod>.node-test.mjs`: translate the vitest
  test. Replace `import { describe, it, expect } from "vitest"` with
  `import { test } from "node:test"; import assert from "node:assert/strict";`.
  Map: `expect(a).toBe(b)`→`assert.equal(a,b)`,
  `.toEqual(b)`→`assert.deepEqual(a,b)`, `.toBeTruthy()`→`assert.ok(a)`,
  `.toBeNull()`→`assert.equal(a,null)`, `it("x", fn)`→`test("x", fn)`,
  `describe` blocks → flatten or wrap with prefixed test names.
- [ ] **Step 4:** Delete `src/lib/<mod>.ts` and `src/lib/<mod>.test.ts`.
- [ ] **Step 5:** Run: `node --test src/lib/<mod>.node-test.mjs` → Expected: PASS.
- [ ] **Step 6:** Commit: `git add -A src/lib && git commit -m "refactor(frontend): port <mod> to plain js + node:test"`

### Task 6: Full lib test gate

- [ ] **Step 1:** Run: `node --test` (from project root) → Expected: all ported
  lib tests PASS, zero `.ts` test files remain in `src/lib`.
- [ ] **Step 2:** Run: `grep -rln "solid-js" src/lib/` → Expected: no output.

---

## Phase 3 — Port stores (`src/lib/*Store.ts` + `settings.ts` → `src/stores/*.js`)

Stores currently use `createSignal`. Convert each to a `createStore`-based
module. Pattern:

```js
// before (solid):  const [x, setX] = createSignal(init); export { x };
// after  (react):  import { createStore } from "./create-store.js";
//                  export const xStore = createStore(init);
//   reads  x()   → xStore.get()   (inside non-component logic)
//   reads  x()   → useStore(xStore) (inside components, Phase 4-7)
//   writes setX(v)/setX(p=>..) → xStore.set(v)/xStore.set(p=>..)
```

Keep every exported imperative function (`startRun`, `applyWatch`,
`newLocalSession`, `adoptSession`, etc.) — only swap the signal read/write
mechanism. Their `.test.ts` (e.g. `runStore.test.ts`, `sessionStore` deps,
`insightsStore.test.ts`, `viewStore.test.ts`, `vaultStore.test.ts`) port to
`.node-test.mjs` the same way as Phase 2.

### Task 7–13: one task per store (commit each)

Stores: `viewStore`, `settings`, `vaultStore`, `explorerStore`, `insightsStore`,
`sessionStore`, `runStore`. **Port in dependency order** (viewStore/settings
first, runStore last — runStore imports sessionStore). For EACH:

- [ ] **Step 1:** Read `src/lib/<store>.ts` + its `.test.ts` if present.
- [ ] **Step 2:** Create `src/stores/<store>.js` (move into `stores/`): replace
  `createSignal` with `createStore`; replace internal `signal()` reads with
  `store.get()` and `setSignal(...)` with `store.set(...)`; export the store
  object plus all existing functions. Update imports to `./create-store.js` and
  sibling stores (`./session-store.js` etc., kebab-case).
- [ ] **Step 3:** If a `.test.ts` exists, port to
  `src/stores/<store>.node-test.mjs` (vitest→node:test as in Phase 2).
- [ ] **Step 4:** Delete the old `.ts` + `.test.ts`.
- [ ] **Step 5:** Run: `node --test src/stores/<store>.node-test.mjs` (if test
  exists) → Expected: PASS.
- [ ] **Step 6:** Commit: `git commit -am "refactor(frontend): port <store> to createStore"`

### Task 14: Store gate

- [ ] **Step 1:** Run: `node --test` → all store + lib tests PASS.
- [ ] **Step 2:** Run: `grep -rln "createSignal\|solid-js" src/lib src/stores` →
  Expected: no output (all signals gone).

---

## Phase 4 — Port leaf components (no children / minimal deps)

For EACH component: read the source `.tsx`, produce kebab-case `.jsx` applying
the **Solid → React mapping** table at the top. Update all importers. Commit
each. These are leaves (small, few store deps) — port first to prove the
pattern.

### Task 15: `WindowControls.tsx` → `components/window-controls.jsx`
- [ ] Read source (23 lines). Port. Tauri window API calls (`getCurrentWindow().minimize()` etc.) are unchanged. Commit.

### Task 16: `ViewSwitcher.tsx` → `components/view-switcher.jsx`
- [ ] Read source (16 lines). Exports `View` type — drop the type, keep the
  component and any runtime view-list constant. Reads `viewStore` via
  `useStore`. Commit.

### Task 17: `settings/atoms.tsx` → `components/settings/atoms.jsx`
- [ ] Read source (67 lines). Port shared settings atoms. Commit.

### Task 18: `SpecialChrome.tsx` → `components/special-chrome.jsx`
- [ ] Read source (59 lines). Reads theme. Port. Commit.

### Task 19: `Explorer.tsx` → `components/explorer.jsx` (the 24-line wrapper)
- [ ] Read source (24 lines). It composes `explorer/Files|Map|Sessions`; those
  are ported in Phase 5 — import them by their future kebab `.jsx` paths.
  Commit (build will be red until Phase 5; that's fine — gate is Phase 7).

---

## Phase 5 — Port view components (data-bound, no canvas/d3)

### Task 20: `CommandPalette.tsx` → `components/command-palette.jsx`
- [ ] Read source (112 lines). Uses `commands` lib + view/run stores. Apply
  mapping; `onMount` keydown listener → `useEffect`. Commit.

### Task 21: `Settings.tsx` → `components/settings.jsx`
- [ ] Read source (114 lines). Uses `settings` store + `settings/atoms`. Commit.

### Task 22: `explorer/Sessions.tsx` → `components/explorer/sessions.jsx`
- [ ] Read source (87 lines). Uses `sessionStore`/`explorerStore`. Commit.

### Task 23: `explorer/Files.tsx` → `components/explorer/files.jsx`
- [ ] Read source (170 lines). Uses `fileTree` lib + `vaultStore`/`explorerStore`.
  `marked` for markdown render is unchanged. Commit.

### Task 24: `Console.tsx` → `components/console.jsx`
- [ ] Read source (439 lines — largest). Uses `sessionStore`, `runStore`,
  `consoleRail`. Preserve the grouped-rail DOM and ALL `pr-session-*`,
  `pr-spawn-marker`, `pr-crumb-loc` classes exactly. `<For>` over sessions →
  `.map` with stable `key` (use session id). Commit.

---

## Phase 6 — Port d3 / canvas components (highest risk)

These use imperative d3/canvas. Pattern: keep the d3/canvas code verbatim inside
a `useEffect(() => { … return cleanup }, [deps])`, with a `useRef` for the
container/canvas element. Recompute layout when store-derived inputs change by
listing them in the dep array (read them via `useStore` at component top).

### Task 25: `explorer/Map.tsx` → `components/explorer/map.jsx`
- [ ] Read source (126 lines, d3-force/hierarchy via `linksGraph`/`layout`).
  Move the d3 simulation setup into `useEffect`; store the simulation in a
  `useRef` so cleanup can `.stop()` it. Commit.

### Task 26: `Cockpit.tsx` → `components/cockpit.jsx`
- [ ] Read source (406 lines, d3-force radial via `cockpitView`/`graph`/`layout`).
  Same useEffect+useRef approach; preserve the radial layout and worktree
  node-collapse behavior. Verify no double-simulation under repeated mounts.
  Commit.

### Task 27: `AmbientCanvas.tsx` → `components/ambient-canvas.jsx`
- [ ] Read source (225 lines, raw canvas animation for special themes). Move
  rAF loop into `useEffect`; cancel via `cancelAnimationFrame` in cleanup.
  Gate by `data-reduce-motion`. Commit.

---

## Phase 7 — App shell, routing, styles

### Task 28: `App.tsx` → `src/app.jsx`
**Files:**
- Create: `src/app.jsx`
- Delete: `src/App.tsx`, `src/index.tsx`

- [ ] **Step 1:** Read `src/App.tsx` (already reviewed in spec). Port:
  - `ROUTES` map of `{ console, cockpit, explorer, settings }` → React
    components.
  - `<Show when={view()} keyed>{(v) => <div class="pr-page-enter"><Dynamic .../></div>}</Show>`
    → `const View = ROUTES[view]; return <div key={view} className="pr-page-enter"><View /></div>` where `view = useStore(viewStore)`.
  - `onMount` Ctrl/Cmd+K + decorations + version effects → `useEffect`s.
  - `setInterval(refreshMetas, 4000)` → `useEffect` with `clearInterval` cleanup.
  - Replace wrapper `class="td-root"` → `className="pr-root"` (see Task 30).
  - `classList={{ "is-glass": glass() }}` → conditional className.
- [ ] **Step 2:** Delete `src/index.tsx` (replaced by root `entry.jsx`).
- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: PASS — `dist/app.js` produced with no unresolved imports.

- [ ] **Step 4:** Commit: `git commit -am "feat(frontend): port App shell + routing to react"`

### Task 29: `themes/theme.ts` → `themes/theme.js`
- [ ] Read `src/themes/theme.ts`. Port to `.js` (strip types). Keep theme keys,
  `themedCopy`, and special-theme list identical. Update importers. Commit.

### Task 30: Rename CSS wrapper `.td-root` → `.pr-root`
**Files:**
- Modify: `src/themes/tokens.css` → rename to `src/themes/styles.css`
- Modify: every component referencing the wrapper class

- [ ] **Step 1:** `git mv src/themes/tokens.css src/themes/styles.css`.
- [ ] **Step 2:** In `styles.css`, replace selector `.td-root` → `.pr-root`
  everywhere (including `.td-root.is-glass`, `.td-root[data-theme=...]`).

Run: `grep -n "td-root" src/themes/styles.css` → Expected: no output after edit.

- [ ] **Step 3:** Update `index.html` stylesheet link to `styles.css` path
  (served static — see Task 32 for where Tauri serves it).
- [ ] **Step 4:** Grep app for any remaining `td-root` class string in `.jsx`;
  the only one should be `app.jsx` (handled in Task 28). Verify:

Run: `grep -rn "td-root" src/ index.html` → Expected: no output.

- [ ] **Step 5:** Commit: `git commit -am "refactor(frontend): rename .td-root wrapper to .pr-root, tokens.css->styles.css"`

### Task 31: Static asset references
- [ ] **Step 1:** Find Vite-style asset imports (`import x from "./assets/...svg"`).

Run: `grep -rn "from \"\.\./assets\|from \"\./assets\|assets/brand" src/`

- [ ] **Step 2:** For each, replace the imported-URL usage with a static path
  (`<img src="/assets/brand/foo.svg">`) OR inline the SVG. esbuild is NOT
  configured with asset loaders, so module imports of svg/png must go. Fonts in
  `src/themes/fonts/` are referenced by `styles.css` `@font-face` (static) —
  leave those.
- [ ] **Step 3:** Build gate: `npm run build` → PASS.
- [ ] **Step 4:** Commit: `git commit -am "refactor(frontend): serve brand assets statically"`

---

## Phase 8 — Tauri serves the static bundle

### Task 32: tauri.conf.json → static frontend
**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1:** Read current `tauri.conf.json`. Note `build.devUrl`
  (`http://localhost:1420`), `build.frontendDist`, `build.beforeDevCommand`.
- [ ] **Step 2:** Change `build`:
  - `frontendDist`: `"../"` (repo root, where `index.html` + `dist/` live) — or
    the dir holding `index.html`. Match how `index.html` references `/dist/app.js`.
  - `devUrl`: remove, or point at the same static dir. With esbuild watch there
    is no dev server URL.
  - `beforeBuildCommand`: `"npm run build"`.
  - `beforeDevCommand`: `"npm run dev"` (esbuild `--watch`, stays resident).
  - Confirm the served root exposes `index.html`, `dist/app.js`,
    `src/themes/styles.css`, `src/themes/fonts/*`, `assets/*`. Adjust the
    stylesheet/script hrefs in `index.html` to match the served root.
- [ ] **Step 3:** Build frontend: `npm run build`.
- [ ] **Step 4:** Launch gate (desktop):

Run: `npm run tauri dev` (or `cargo tauri dev`)
Expected: window opens; topbar, view switcher, and all four tabs render. NOTE:
per project memory, kill any already-running installed instance first
(single-instance hijack). Verify the dev window actually appears.

- [ ] **Step 5:** Commit: `git commit -am "build(tauri): serve esbuild static bundle instead of vite"`

---

## Phase 9 — Rust crate split (`core` / `cli` / `tauri`)

Do this AFTER the frontend is green so the two large changes don't interleave.

### Task 33: Create workspace + `praetorium-core`
**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `crates/praetorium-core/Cargo.toml`
- Create: `crates/praetorium-core/src/lib.rs`
- Move: pure modules from `src-tauri/src/` → `crates/praetorium-core/src/`

- [ ] **Step 1:** Create root `Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/praetorium-core", "crates/praetorium-cli", "crates/praetorium-tauri"]
```

- [ ] **Step 2:** Create `crates/praetorium-core/Cargo.toml`:

```toml
[package]
name = "praetorium-core"
version = "0.7.1"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
regex = "1"
```

- [ ] **Step 3:** `git mv` the pure modules into core and assemble its `lib.rs`:
  - `src-tauri/src/parser.rs` → `crates/praetorium-core/src/parser.rs`
  - `src-tauri/src/session_parse.rs` → `crates/praetorium-core/src/session_parse.rs`
  - `src-tauri/src/events.rs` → `crates/praetorium-core/src/events.rs` (type defs)
  - Split `sessions.rs`: move the pure file-reading/listing fns into
    `crates/praetorium-core/src/sessions.rs`; leave `#[tauri::command]`
    wrappers behind for the tauri crate (Task 35).
  - Split `vault.rs` likewise into `crates/praetorium-core/src/vault.rs`.
  - `crates/praetorium-core/src/lib.rs`:
    ```rust
    pub mod parser;
    pub mod session_parse;
    pub mod events;
    pub mod sessions;
    pub mod vault;
    ```
- [ ] **Step 4:** Move fixture tests: `src-tauri/tests/` → `crates/praetorium-core/tests/`; update any module paths.
- [ ] **Step 5:** Remove `tauri`/`tokio`/`notify` from core deps (core is pure).
  If a moved fn referenced Tauri types, leave that fn in the tauri crate.
- [ ] **Step 6:** Build core alone:

Run: `cargo build -p praetorium-core`
Expected: PASS.

Run: `cargo test -p praetorium-core`
Expected: fixture tests PASS.

- [ ] **Step 7:** Commit: `git commit -am "refactor(rust): extract praetorium-core pure library"`

### Task 34: Create `praetorium-cli`
**Files:**
- Create: `crates/praetorium-cli/Cargo.toml`
- Create: `crates/praetorium-cli/src/main.rs`

- [ ] **Step 1:** `Cargo.toml`:

```toml
[package]
name = "praetorium-cli"
version = "0.7.1"
edition = "2021"

[[bin]]
name = "praetorium"
path = "src/main.rs"

[dependencies]
praetorium-core = { path = "../praetorium-core" }
serde_json = "1"
```

- [ ] **Step 2:** `main.rs` — thin inspection surface over core:

```rust
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("parse-session") => {
            let path = args.get(2).expect("usage: praetorium parse-session <path>");
            let events = praetorium_core::session_parse::parse_file(path)
                .expect("parse failed");
            println!("{}", serde_json::to_string_pretty(&events).unwrap());
        }
        Some("vault-index") => {
            let dir = args.get(2).expect("usage: praetorium vault-index <dir>");
            let index = praetorium_core::vault::build_index(dir)
                .expect("index failed");
            println!("{}", serde_json::to_string_pretty(&index).unwrap());
        }
        _ => {
            eprintln!("commands: parse-session <path> | vault-index <dir>");
            std::process::exit(2);
        }
    }
}
```

NOTE: adjust `parse_file` / `build_index` to the actual public fn names exposed
by core (read core's `session_parse.rs`/`vault.rs` after Task 33 and match the
real signatures — do not invent names).

- [ ] **Step 3:** Build:

Run: `cargo build -p praetorium-cli`
Expected: PASS.

- [ ] **Step 4:** Smoke test against a real session file:

Run: `cargo run -p praetorium-cli -- parse-session <a real ~/.claude .jsonl>`
Expected: prints JSON event array.

- [ ] **Step 5:** Commit: `git commit -am "feat(rust): add thin praetorium-cli inspection bin"`

### Task 35: Move shell into `praetorium-tauri`
**Files:**
- Move: `src-tauri/` → `crates/praetorium-tauri/`
- Modify: `crates/praetorium-tauri/Cargo.toml`, `src/lib.rs`, command modules

- [ ] **Step 1:** `git mv src-tauri crates/praetorium-tauri`.
- [ ] **Step 2:** Update `crates/praetorium-tauri/Cargo.toml`:
  - Add `praetorium-core = { path = "../praetorium-core" }`.
  - Keep `tauri`, `tauri-plugin-*`, `tokio`, `notify`, `window-vibrancy`, serde.
  - Keep `[lib] name = "praetorium_lib"`, `crate-type` as-is.
- [ ] **Step 3:** The tauri crate now keeps: `process.rs`, `session_watch.rs`,
  `lib.rs` (glass + builder + `invoke_handler`), and the `#[tauri::command]`
  wrapper functions for sessions/vault. Each wrapper calls into
  `praetorium_core::…`. Update `mod` declarations and `use` paths
  (`use praetorium_core::events::…` etc.).
- [ ] **Step 4:** Update `tauri.conf.json` paths if `frontendDist` was relative
  to the old `src-tauri/` location (now `crates/praetorium-tauri/`). The bundle
  identifier, icons, and capabilities move with the dir.
- [ ] **Step 5:** Update any path in `.github/workflows/*` referencing
  `src-tauri/` → `crates/praetorium-tauri/`.
- [ ] **Step 6:** Build the workspace:

Run: `cargo build --workspace`
Expected: PASS.

Run: `cargo test --workspace`
Expected: PASS (core fixture tests).

- [ ] **Step 7:** Desktop launch gate:

Run: `cargo tauri dev` (kill any installed instance first)
Expected: window opens, all tabs work, live session streaming + glass + themes
behave as before the split.

- [ ] **Step 8:** Commit: `git commit -am "refactor(rust): move shell into crates/praetorium-tauri linking core"`

---

## Phase 10 — Documentation

### Task 36: Rewrite `CLAUDE.md`
- [ ] Rewrite to mirror Token Dashboard's CLAUDE.md structure: project overview,
  architecture (the new `crates/` + `frontend/` tree), data source, conventions
  (rusqlite note N/A — replace with "core is pure, no Tauri/process model"),
  Tauri build prereqs (frontend bundle must exist; esbuild build/watch), a
  "Frontend cache" section (theme keys, token CSS vars, `pr-*` class vocabulary,
  `.pr-root` wrapper, `createStore`/`useStore` pattern), and the verification
  commands (`cargo test --workspace`, `cargo fmt --check`, `cargo clippy`,
  `npm run build`, `node --test`). Commit.

### Task 37: Write `docs/parity.md`
- [ ] Create the cross-app convention map between Praetorium and Token Dashboard:
  - Build pipeline (both: esbuild `entry.jsx → dist/app.js`).
  - Store pattern (TD: `window.MOCK_DATA` + `td:data` event; Praetorium:
    `createStore` + `useSyncExternalStore`) — note both are plain-JS modules,
    and how Praetorium's stores would slot into TD.
  - Crate naming (`<app>-core` / `-cli` / `-tauri`; core = pure library).
  - Design tokens: list the shared CSS var names (`--bg`, `--panel`, `--accent`,
    `--good`/`--warn`/`--bad`, etc.) common to both.
  - Class-vocabulary mapping: Praetorium `pr-*` / `.pr-root` ↔ TD `a-*` /
    `.dir-a-root`, with a table of the closest equivalents (topbar, card, table,
    statusbar).
  - Theme keys present in each.
  - A short "merge checklist" describing what moving Praetorium's three tabs into
    TD would entail given this parity.
  - Commit.

---

## Phase 11 — Final verification

### Task 38: Full gate
- [ ] **Step 1:** `cargo build --workspace` → PASS.
- [ ] **Step 2:** `cargo test --workspace` → PASS.
- [ ] **Step 3:** `cargo fmt --check` → clean (run `cargo fmt` if not).
- [ ] **Step 4:** `cargo clippy --all-targets --workspace -- -D warnings` → clean.
- [ ] **Step 5:** `cd frontend`-equivalent (project root) `npm run build` → `dist/app.js` produced.
- [ ] **Step 6:** `node --test` → all ported tests PASS.
- [ ] **Step 7:** `cargo tauri dev` → manual parity check vs pre-port build:
  - Console: live session rail groups by cwd, sub-agents nest, local run works.
  - Cockpit: radial agent graph renders, worktree nodes collapse into repo.
  - Explorer: Files (markdown render + tree), Map (wikilink graph), Sessions.
  - Settings: theme switch (all keys), glass toggle, layout, reduce-motion.
  - Command palette: Ctrl/Cmd+K opens/closes.
  - Topbar version, drag region, window controls.
- [ ] **Step 8:** Confirm no `solid-js`, `vite`, `vitest`, `.tsx`, `.ts` remain:

Run: `grep -rln "solid-js" src/ ; find src -name '*.tsx' -o -name '*.ts' ; ls vite.config.ts vitest.config.ts tsconfig.json 2>/dev/null`
Expected: no output (delete leftover `vite.config.ts`, `vitest.config.ts`,
`tsconfig*.json` if present).

- [ ] **Step 9:** Final commit if cleanup occurred: `git commit -am "chore: remove vite/ts/solid leftovers"`

---

## Self-review notes (author)

- **Spec coverage:** every spec section maps to a phase — frontend port (P1–P7),
  Tauri static serve (P8), crate split (P9), docs incl. parity.md (P10),
  verification (P11). Store-bridge decision A implemented in Task 2; cli crate in
  Task 34; `.td-root`→`.pr-root` in Task 30.
- **Known unknowns the executor must resolve by reading source (flagged inline):**
  core public fn names for the cli (`parse_file`/`build_index` are placeholders to
  match to real signatures), exact `tauri.conf.json` path keys, and per-component
  Solid-isms (executor reads each `.tsx`).
- **Ordering guard:** frontend fully green before the Rust split; d3/canvas
  components last within the frontend; stores ported in dependency order.

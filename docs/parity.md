# Cross-app parity guide: Praetorium ↔ Token Dashboard

A convention map for future merges. Moving Praetorium's tabs into Token Dashboard should be a lookup, not archaeology.

---

## 1. Shared build pipeline

| Aspect | Praetorium | Token Dashboard |
|---|---|---|
| Bundler | esbuild | esbuild |
| Entry point | `entry.jsx` → `dist/app.js` | `frontend/entry.jsx` → `frontend/dist/app.js` |
| JSX transform | `--jsx=automatic` (React 18) | `--jsx=automatic` (React 18) |
| TypeScript | No (plain JSX/JS) | No (plain JSX/JS) |
| Unit tests | `node --test` on `src/lib/*.node-test.mjs` | `node --test` on `frontend/src/**/*.node-test.mjs` |
| Build script | `scripts/build.mjs` — assembles a self-contained `dist/`: app.js + index.html + styles.css + fonts/ + assets/ | Build runs inline in CI; axum static handler in `token-dashboard-cli` serves `frontend/dist/` at runtime |
| Dev iteration | `npm run dev` (esbuild `--watch`) | `npm run dev` (esbuild `--watch`) |
| Tauri conf | `crates/praetorium-tauri/tauri.conf.json`, `frontendDist: "../../dist"` | `crates/token-dashboard-tauri/tauri.conf.json`, `frontendDist: "../frontend/dist"` |

**Key difference:** Praetorium's build script creates a portable `dist/` that Tauri reads directly. Token Dashboard's CLI crate embeds a static file handler (axum) that serves `frontend/dist/`; the Tauri shell calls the CLI's `app(state)` function in-process rather than spawning it.

---

## 2. State / store pattern

Both apps use the same underlying primitive, but the data-flow model differs.

### Praetorium — `createStore` + `useStore`

`src/stores/create-store.js`:
```js
export function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get:       () => value,
    set:       (next) => { value = typeof next === "function" ? next(value) : next; subs.forEach(fn => fn()); },
    subscribe: (fn)  => { subs.add(fn); return () => subs.delete(fn); },
  };
}
```

`src/stores/use-store.js`:
```js
import { useSyncExternalStore } from "react";
export const useStore = (store) => useSyncExternalStore(store.subscribe, store.get);
```

Each store is a plain ES module — no globals, no context providers, no framework coupling. Components call `useStore(someStore)` to subscribe. Stores are independent and purpose-scoped (`vault-store.js`, `session-store.js`, `run-store.js`, `view-store.js`, `explorer-store.js`, `settings.js`, `theme.js`).

### Token Dashboard — `window.MOCK_DATA` + SSE nonce bump

TD's frontend receives one large data blob per fetch cycle. `api-client.js` populates `window.MOCK_DATA` from `/api/*` endpoints and fires a `td:data` custom event; route components re-render by incrementing a `nonce` state variable.

### Import compatibility

Because Praetorium's stores are plain JS modules with no TD-specific globals, they import cleanly into a TD build as-is. The only wiring needed when copying them over is replacing any `tauri.invoke` calls (in the store's action functions) with equivalent TD API calls or no-ops.

---

## 3. Crate naming & transport

| Layer | Praetorium | Token Dashboard |
|---|---|---|
| Pure library | `praetorium-core` | `token-dashboard-core` |
| CLI / server | `praetorium-cli` (inspection binary only) | `token-dashboard-cli` (axum HTTP + SSE server) |
| Desktop shell | `praetorium-tauri` | `token-dashboard-tauri` |
| Core rule | No Tauri, no async runtime, no process model | No Tauri, no process model |
| Transport | Tauri `invoke` + IPC `Channel<T>` events | HTTP REST + SSE (`/api/*`); Tauri shell calls CLI lib in-process |

The core/shell split is the shared pattern. The transport differs: Praetorium is Tauri-native end-to-end; Token Dashboard exposes an axum surface so both the Tauri shell and a headless CLI can share the same API.

---

## 4. Shared design tokens

Both apps descend from the same token set. The following CSS custom properties are defined identically (same names, same semantic roles) in both `src/themes/styles.css` (Praetorium) and `frontend/styles.css` (Token Dashboard):

| Token | Semantic role |
|---|---|
| `--bg` | Page / window background |
| `--panel` / `--panel-solid` | Card / panel surface |
| `--panel-2` / `--panel-2-solid` | Secondary panel / nested surface |
| `--iron-border` | Primary border |
| `--iron-border-2` | Secondary / subtle border |
| `--bone` | Primary text |
| `--gull` | Muted text |
| `--gull-2` | Faint / disabled text |
| `--accent` | Brand accent (≤10% of screen) |
| `--accent-2` | Muted accent / secondary highlight |
| `--good` | Neutral-positive indicator |
| `--pos` | Positive / success |
| `--warn` | Warning |
| `--bad` | Error / danger |
| `--grid-dot` | Dot-grid background motif |
| `--font-prose` | Inter — prose + body |
| `--font-mono` | JetBrains Mono — brand, nav, numbers |
| `--t-body`, `--t-card-title`, `--t-metric`, etc. | Semantic type composites |
| `--space-1..6`, `--radius-*`, `--dur-*`, `--ease`, `--shadow-*` | Spacing, radius, motion, shadow scales |

**Two-voice font rule** is identical in both apps: Inter for prose, JetBrains Mono for the brand prompt / nav / card titles / every number.

---

## 5. Class-vocabulary mapping

The apps use different namespace prefixes. Classes are **not unified** (deliberate: they are cosmetic, high-churn, and app-specific). This table is the bridge.

| Role | Praetorium | Token Dashboard |
|---|---|---|
| Root wrapper | `.pr-root` | `.dir-a-root` |
| Theme toggle | `data-theme="<key>"` on `.pr-root` | `class="theme-<key>"` on `.dir-a-root` |
| Glass toggle | `.pr-root.is-glass` | `.dir-a-root.is-glass` |
| Topbar | `.pr-topbar` | `.a-topbar` |
| Card | `.pr-card` / `.pr-set-card` | `.a-card` |
| KPI tile | *(no direct equivalent)* | `.a-kpi` / `.a-kpi-row` |
| Strip (3-col) | *(no direct equivalent)* | `.a-strip`, `.a-strip-{left,mid,right}` |
| Data table | *(inline table styles)* | `.a-table`, `.a-sticky-head` |
| Metric number | *(uses `--t-metric` token)* | `.a-metric` |
| Preformatted | *(inline)* | `.a-pre` |
| Page enter | `.pr-page-enter` | *(route-level transition)* |
| Status bar | `.pr-statusbar` | *(no exact equivalent)* |
| Glass slider | *(uses native `<input type=range>`)* | `.a-glass-slider` |

When porting Praetorium components into TD, either keep `pr-*` classes namespaced (simplest, no conflicts) or remap to `a-*` equivalents above.

---

## 6. Theme keys

All 19 theme keys are shared. Both apps define the same `data-theme` / `theme-*` values with identical palette values (the token set was synced from Token Dashboard into Praetorium):

- **Light:** `paper`, `linen`, `mint`, `lilac`, `bb-light`, `cyber-light`
- **Dark:** `forge`, `forest`, `dusk`, `ocean`, `matrix`, `rose`, `bb-dark`, `cyber-dark`, `dim` (+ bare root = base dark)
- **Special** (swap display fonts + drive `AmbientCanvas`): `terminal`, `cockpit`, `grimdark`

**Praetorium applies themes** via `data-theme="<key>"` attribute on `.pr-root`.  
**TD applies themes** via `theme-<key>` class on `.dir-a-root`.

The `AmbientCanvas` component (animated background for special themes) exists in both apps under the same filename (`ambient-canvas.jsx`) with the same logic. Motion is gated by `[data-reduce-motion="1"]` (Praetorium) / `applyReduceMotion()` (both).

---

## 7. Merge checklist

To move Praetorium's three tabs (Console, Cockpit, Explorer) into Token Dashboard:

1. **Copy store modules.** `src/stores/create-store.js`, `use-store.js`, `view-store.js`, `vault-store.js`, `session-store.js`, `run-store.js`, `explorer-store.js`, and `src/themes/theme.js` → `frontend/src/stores/`. No changes needed to the store logic itself.
2. **Copy lib modules.** `src/lib/*.js` (pure logic, no Tauri imports) → `frontend/src/lib/`. Files that call `tauri.invoke` (e.g. parts of `sessions.js`) need their transport swapped for TD API calls.
3. **Copy route components.** `src/components/console.jsx`, `cockpit.jsx`, `explorer.jsx`, and their sub-components → `frontend/src/routes/` or a new `frontend/src/components/praetorium/` subtree.
4. **Register routes.** Add `console`, `cockpit`, `explorer` entries to TD's `app.jsx` `ROUTES` map (or equivalent router).
5. **Wire Tauri commands.** The live views depend on `watch_sessions`, `run_claude`, `list_sessions`, `vault_index` Tauri commands. These must be registered in TD's `token-dashboard-tauri` crate (copy or re-expose the relevant `praetorium-tauri` command handlers, adapting the core calls).
6. **Fold stylesheets.** Either append Praetorium's `pr-*` component rules to TD's `frontend/styles.css` (keeping the namespacing — safest) or remap to `a-*` equivalents per the table in §5. Token-layer vars are already shared; no duplication needed there.
7. **Copy `AmbientCanvas`.** Already ported to React in both apps. Copy `ambient-canvas.jsx` and its BUILDERS if TD doesn't already have parity.
8. **Update `beforeBuildCommand`.** Ensure `tauri.conf.json` and CI both pre-build the merged frontend before `cargo tauri build`.
9. **Run test suites.** `cargo test --workspace` (Rust) + `node --test` (JS) + manual smoke of all five tabs in the Tauri window.

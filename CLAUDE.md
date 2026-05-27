# Praetorium

Solid + Tauri vault explorer with a "Terminal Status Readout" reskin.

## Design tokens & themes

All design tokens and the full component stylesheet live in [src/themes/tokens.css](src/themes/tokens.css) (~830 lines). Read it only for deep edits — the contract below covers most UI work.

**Wrapper contract:** apply `.td-root` to the app wrapper; pick a theme with `data-theme="<key>"` on the same element. Bare `.td-root` (no attr) = canonical dark baseline. Add `.is-glass` for translucent panels over OS vibrancy.

**Token layer** (defined on `.td-root`, every component reads these — theme blocks override only the var layer):
- Surfaces: `--bg`, `--panel` / `--panel-solid`, `--panel-2` / `--panel-2-solid`
- Borders: `--iron-border`, `--iron-border-2`
- Text: `--bone` (primary), `--gull` (muted), `--gull-2` (faint)
- Accent (one brand, ≤10% of screen): `--accent`, `--accent-2`
- Status: `--good`, `--pos`, `--warn`, `--bad`
- Type: `--font-prose` (Inter), `--font-mono` (JetBrains Mono); semantic `--t-*` (e.g. `--t-body`, `--t-card-title`, `--t-metric`)
- Scales: `--space-1..6`, `--radius-*`, `--dur-*` + `--ease`, `--shadow-*`
- Back-compat aliases exist (`--fg`, `--border`, `--danger`, `--r-*`, `--bw-*`, `--t-fast/base/slow`) — prefer the canonical tokens above in new code.

**Two-voice font rule:** Inter (`--font-prose`) carries prose/body only. JetBrains Mono (`--font-mono`) carries the brand prompt, nav, card titles, and every number/identifier.

**Theme keys** (`data-theme`):
- Light: `paper`, `linen`, `mint`, `lilac`, `bb-light`, `cyber-light`
- Dark: `forge`, `forest`, `dusk`, `ocean`, `matrix`, `rose`, `bb-dark`, `cyber-dark`, `dim` (+ bare `.td-root` = base dark)
- Special (swap display fonts + drive `components/AmbientCanvas.tsx`): `terminal`, `cockpit`, `grimdark`

**Component vocabulary:** all UI classes are prefixed `pr-*` (e.g. `.pr-topbar`, `.pr-card`, `.pr-console-grid`, `.pr-explorer`, `.pr-settings`, `.pr-statusbar`; console rail: `.pr-session-group`, `.pr-session-sub`, `.pr-session-observed`, `.pr-spawn-marker`, `.pr-crumb-loc`). Fonts are vendored woff2 under `src/themes/fonts/` (no CDN). Motion is gated by `[data-reduce-motion="1"]`.

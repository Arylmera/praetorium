# Command Palette — Design

**Date:** 2026-05-24
**Status:** Approved (pending implementation plan)
**Scope:** Fourth and last of the current feature batch. Best built after the others exist, but self-contained.

## Summary

A Ctrl/Cmd+K overlay for fast keyboard navigation. v1 covers two command groups: **Navigate** (switch view) and **Session** (jump to a live session). Deliberately lean — no theme/appearance, jump-to-file, or search commands in v1.

**Out of scope (YAGNI):** theme/appearance commands, jump-to-file, transcript search, command history/recents, fuzzy-rank scoring beyond simple substring match.

## Background

- `view` / `setView` are **local signals in `App.tsx`**, passed by props to `ViewSwitcher` and used by the status bar. Not globally reachable — a palette that navigates needs this lifted.
- Theme (`themes/theme.ts`), layout / glass / reduce-motion (`lib/settings.ts`) are already global signals with setters (relevant only if appearance commands are added later).
- Sessions: `sessionStore.ts` exposes `sessions()`, `metas()`, `activeId()`, `setActiveId()`. Switching the active session is already a supported operation (Console's session rail does it).
- Themed nav labels: `themes/theme.ts` `themedCopy()?.nav` maps each view to a theme-specific label (e.g. cockpit → "HELM").

## Architecture

### 1. Lift view state — `src/lib/viewStore.ts` (new)

- Move the `view` signal and `setView` out of `App.tsx` into this store; export `view` and `setView`. Type `View` stays defined in `ViewSwitcher.tsx` (or moves alongside; implementation plan decides) — no behavior change.
- `App.tsx` imports `view` / `setView` from the store instead of `createSignal`.
- `ViewSwitcher.tsx` drops its `view` / `setView` props and reads the store directly. Its callers (`App.tsx`) update accordingly.
- Status-bar shortcuts in `App.tsx` (`onClick={() => setView("settings")}`) use the store setter.

This is the only refactor and it is the palette's sole prerequisite.

### 2. Command registry

A typed command model:

```ts
type CommandGroup = "Navigate" | "Session";
type Command = {
  id: string;
  title: string;
  group: CommandGroup;
  hint?: string;       // e.g. project name for a session
  run: () => void;
};
```

- **Navigate** (static list of 4): Console / Cockpit / Explorer / Settings. `title` uses `themedCopy()?.nav[v]` when present, else the default label. `run = () => setView(v)`.
- **Session** (reactive, derived from `sessions()` + `metas()`): one command per live session. `title` = the session's `metas().get(id)?.title ?? project ?? id.slice(0,8)`; `hint` = project. `run = () => { setActiveId(id); setView("console"); }`.

A pure helper `filterCommands(list: Command[], query: string): Command[]` — case-insensitive substring match over `title` (+ `hint`), empty query returns all, preserves group order. Lives in a module separate from the component so it is unit-testable.

### 3. `src/components/CommandPalette.tsx` (new)

- Rendered once at the `App` root (sibling of `main`).
- **Open:** a global `keydown` listener (mounted in `App` via `onMount`, removed via `onCleanup`) toggles an `open` signal on Ctrl+K / Cmd+K, calling `preventDefault`.
- **Close:** Esc, backdrop click, or running a command.
- **UI:** a backdrop + centered panel containing an autofocused search input and a grouped result list (group headers "Navigate" / "Session"). Selection state is an index into the filtered flat list.
- **Keyboard:** ↑/↓ move the selected index (wrapping), Enter runs the selected command, Esc closes. Mouse hover sets selection; click runs.
- **Empty state:** "No matching commands."
- **Styling:** new `pr-*` classes — `.pr-palette` (backdrop), `.pr-palette-panel`, `.pr-palette-input`, `.pr-palette-group`, `.pr-palette-item` (+ `.is-selected`). Titles/hints in `--font-mono` per the two-voice font rule. Any open/close transition gated by `[data-reduce-motion="1"]`.

### 4. Data flow

```
Ctrl/Cmd+K (global listener in App) → open palette
  query input → filterCommands(buildCommands(), query) → grouped list
  buildCommands(): Navigate (static) + Session (from sessions()/metas())
  Enter / click → command.run()
       Navigate → setView(v)                     (viewStore)
       Session  → setActiveId(id); setView("console")
  → palette closes
```

## Error handling

- No live sessions → the Session group is empty (just omitted); Navigate always present.
- Running a command whose target session vanished between build and run: `setActiveId` on a stale id is harmless (Console simply shows nothing for it); acceptable. No guard needed.

## Testing

- **`filterCommands` (pure unit):** substring match, case-insensitivity, match on `hint`, empty query returns all, group order preserved.
- **`buildCommands` (unit):** 4 navigate commands always present; one session command per entry in `sessions()`; titles honor themed nav copy.
- **`viewStore` (light):** `setView` updates the signal.

## Files touched

- `src/lib/viewStore.ts` — **new** (lifted view state).
- `src/App.tsx` — consume `viewStore`; mount Ctrl/Cmd+K listener; render `<CommandPalette/>`.
- `src/components/ViewSwitcher.tsx` — read `viewStore` directly; drop props.
- `src/components/CommandPalette.tsx` — **new** overlay.
- `src/lib/commands.ts` — **new** `buildCommands` + `filterCommands` (registry + pure filter).
- `src/themes/tokens.css` — `.pr-palette*` classes.

# Cockpit Liveness & Drill-down — Design

**Date:** 2026-05-25
**Status:** Approved (implementing)
**Scope:** Overhaul the Cockpit tab (`src/components/Cockpit.tsx`) so it reads as a live readout of *what every agent is doing, where, right now* — adding liveness cues, a drill-down detail panel, scale/focus controls, and a richer stats bar. Builds entirely on data the frontend already receives (Approach A — no Rust changes).

## Summary

The cockpit today renders a static force/hierarchical graph (`project → repo/worktree → session(master) → subagent → folder`) with file-read pulses, zoom/pan, a layout switcher, and a 3-cell stats footer. It shows *topology* but not *liveness*: you can't tell what an agent is doing now, which are idle or failing, or drill into one.

We already collect the missing data — `insightsStore` (per-call tool name, ok/error, timing), `metas` (session state, last activity), and the watch event's tool `name` — but the cockpit doesn't join it in. This design adds that join as a pure view-model and reskins the cockpit into a Shell-C layout: full-bleed graph + persistent bottom bar + slide-in detail panel.

**Out of scope (YAGNI):** Rust/event-stream changes, historical replay of finished sessions, cost/token metrics (owned by Token-Dashboard), persisted filter/search state, cross-tab navigation to the Console.

## Goals (all four, as one cohesive view)

1. **Liveness & "what now"** — tool-typed pulses, activity heat, idle fade, status rings.
2. **Drill-down** — single-click a node → detail panel with metrics, recent calls, children.
3. **Scale & focus** — search, project/status filters, legend.
4. **Polish** — richer bottom stats bar with an activity sparkline.

## Architecture

### 1. Layout shell (Shell C)

`Cockpit.tsx` renders three zones inside `.pr-cockpit`:

- **Graph** — full-bleed SVG (unchanged zoom/pan/layout mechanics).
- **Bottom bar** (`.pr-cockpit-bar`) — persistent; counts, sparkline, search, filters, layout toggle, legend chip.
- **Detail panel** (`.pr-cockpit-detail`) — right-docked, slides in only when a node is selected; otherwise the graph is full width.

The existing `.pr-info-card` is removed: its layout toggle moves to the bar, and its explanatory copy becomes the legend popover content.

### 2. Data — `src/lib/cockpitView.ts` (new, pure)

A pure module (no Solid signals) that joins the three live stores into a derived view-model. Consumed via a `createMemo` in `Cockpit.tsx`.

**Tool categorization** — map a tool name to a category + color token:

```ts
export type ToolCategory = "read" | "edit" | "bash" | "web" | "search" | "other";
// Read/NotebookRead → read; Edit/Write/NotebookEdit → edit; Bash → bash;
// WebFetch/WebSearch → web; Grep/Glob → search; else → other.
export function toolCategory(name: string): ToolCategory;
export const CATEGORY_COLOR: Record<ToolCategory, string>; // CSS var refs
```

**Per-node live fields** — keyed by graph node id:

```ts
export interface NodeLive {
  id: string;
  callCount: number;      // calls attributable to this node (agent/master) this session
  failCount: number;
  lastActivityMs?: number; // max ts of pings/calls touching this node
  idleMs?: number;         // now - lastActivityMs (undefined if never active)
  recentRate: number;      // calls in the last ~10s → heat intensity 0..1
  lastTool?: ToolCategory; // most recent tool category (for the detail panel)
}
```

**Machine-wide aggregates** — for the bottom bar:

```ts
export interface CockpitAggregates {
  agents: number; sessions: number; fails: number; idle: number; folders: number;
  callsPerSec: number[]; // ~60 one-second buckets, oldest→newest, for the sparkline
}
```

**Detail model** — for a selected node:

```ts
export interface NodeDetail {
  title: string; state: string; repo?: string; project?: string;
  durationMs?: number; fails: number; calls: number; idleMs?: number;
  recentCalls: { tool: ToolCategory; name: string; target?: string; status: "running"|"ok"|"error"; durMs?: number }[];
  subagents: { label: string; status: NodeStatus }[];
  folders: string[];
}
```

Functions are pure `(graph, insights, metas, nowMs, [nodeId]) → …` so they unit-test without a DOM. `idleMs`/`recentRate`/`callsPerSec` take `nowMs` explicitly (caller passes `Date.now()`), matching the run-insights "frontend stamps time" convention.

**Idle threshold:** default 30 000 ms (a node with `idleMs > threshold` renders faded). Constant in `cockpitView.ts`.

### 3. Graph reducer change — preserve tool name on pings

`ActivityPing` in `types.ts` gains an optional `tool?: string`. In `graph.ts` `reduceWatch` (and the local `reduce`), the `toolActivity`/`toolCall` branch sets `tool: event.data.name` on the ping it pushes (the value is already in hand and currently discarded). This is the only change outside the new module + the component. Existing ping consumers ignore the extra field.

### 4. Liveness on nodes (B + C + D + E)

Rendered in the existing `<For>` over nodes/activity in `Cockpit.tsx`, driven by `NodeLive` + ping data:

- **B — tool-typed pulses:** the activity `<circle class="cockpit-ring">` stroke uses `CATEGORY_COLOR[toolCategory(ping.tool)]` instead of a single accent.
- **C — activity heat:** agent/master nodes get `filter: drop-shadow(...)` whose blur/opacity and a small radius bump scale with `recentRate`.
- **D — idle fade:** nodes with `idleMs > IDLE_MS` get a `.is-idle` class (reduced opacity / desaturated stroke) plus a faint `idle Ns` `<text>` tag.
- **E — status ring:** a second `<circle>` ring around master/agent nodes — animated dash on `running`, solid `--good` on `complete`, `--bad` on `failed`.

All animations gated behind `[data-reduce-motion="1"]` (heat/ring become static; idle still fades).

### 5. Detail panel (rows 1–4)

Local `selected` signal (node id | null). Single-click a node sets it; click on empty SVG background or the panel's X clears it. Renders `NodeDetail`:

1. **Header** — title (`sessionTitle` for masters), state badge, repo/worktree + project.
2. **Metric strip** — duration · fails · calls · idle (mono, `--font-mono`).
3. **Recent calls** — last ~8 from `insightsStore` for the node's session/agent: tool glyph, name/target, ok/error, ms.
4. **Subagents & folders touched** — children agents (with status) + the folder paths the node links to.

No "Open in Console" button (explicitly cut).

### 6. Bottom bar (all five) + legend (A+B)

`.pr-cockpit-bar` left→right:

- **Counts** — agents · sessions · fails · idle · folders (from `CockpitAggregates`).
- **Sparkline** — `.pr-spark` mini bar/area chart of `callsPerSec` (last ~60s), `--good` tinted.
- **Search** — text input; non-empty query dims (`.is-dimmed`, lowered opacity) nodes whose label/session-title/folder path doesn't match (case-insensitive substring). Pure filter over the displayed node set.
- **Filters** — project multi-select + status select (all/running/failed/idle); restrict the rendered graph (applied in the display-graph memo, after prune/collapse).
- **Layout toggle** — radial | hierarchical (moved from the info card).

**Legend (A+B mix):** an always-visible compact swatch row pinned in a graph corner (node kinds + status colors + tool-pulse colors), with a `?` chip that expands a fuller popover carrying the old info-card explanation.

### 7. Data flow

```
graph (topology)  ─┐
insightsStore     ─┼─→ cockpitView memo (pure join, nowMs)
metas             ─┘        ├─ NodeLive map      → node liveness (B/C/D/E)
                            ├─ CockpitAggregates → bottom bar + sparkline
                            └─ NodeDetail(sel)   → detail panel
```

Reactivity: a coarse `nowMs` tick signal (e.g. `setInterval` ~1 s, cleared on cleanup) drives idle/heat/sparkline recomputation without depending on event volume; topology still recomputes layout only on `topoKey` change (unchanged from today).

## Error handling

- Nodes with no observed calls: `idleMs`/`lastTool` undefined → render at rest (no heat, no idle tag until first activity).
- Orphan/duplicate tool events: already tolerated by `insightsStore`; `cockpitView` reads its output, so no new failure modes.
- Selected node pruned from the graph (session archived) while open: detail panel detects the missing id and closes itself.
- Empty graph: bar shows zeros, sparkline flat, no panel — same empty-state as today.

## Testing

- **`cockpitView` (unit):** `toolCategory` mapping; per-node `callCount`/`failCount`/`lastActivityMs`/`idleMs`/`recentRate`; `callsPerSec` bucketing across a fixed `nowMs`; aggregates (agents/sessions/fails/idle/folders); `NodeDetail` assembly incl. recent-calls ordering and master-vs-agent attribution; selected-but-missing node → empty detail.
- **`graph.ts` (unit):** `toolActivity`/`toolCall` ping carries `tool` name; existing ping consumers unaffected.
- **UI (manual, Tauri preview):** run real sessions; verify pulses color by tool, heat tracks activity, idle fade after 30 s, status rings, click→detail, search dim, project/status filters, sparkline movement, legend popover; confirm `[data-reduce-motion="1"]` stills animation.

## Files touched

- `src/lib/types.ts` — `ActivityPing.tool?: string`.
- `src/lib/graph.ts` — set `tool` on pushed pings (both `reduce` and `reduceWatch`).
- `src/lib/cockpitView.ts` — **new** pure view-model (categorization, NodeLive, aggregates, NodeDetail) + tests.
- `src/components/Cockpit.tsx` — Shell-C layout, liveness rendering, detail panel, bottom bar, search/filter/legend, nowMs tick.
- `src/themes/tokens.css` — `.pr-cockpit-bar`, `.pr-cockpit-detail`, `.pr-legend`, `.pr-spark`, `.is-idle`, `.is-dimmed`, status-ring + heat styles (motion-gated).

# Run Insights — Design

**Date:** 2026-05-24
**Status:** Approved (pending implementation plan)
**Scope:** First of several observability features for Praetorium. Sibling features (vault links, launch-agent-from-UI, command palette) get their own specs.

## Summary

Add two observability features to Praetorium's live-session view, built on one shared data enrichment:

1. **Tool-call timeline** — a swimlane (Gantt-style) view of tool calls per agent in the active session, showing duration and pass/fail.
2. **Failure radar** — surfaces errored tool calls (and run errors) across three places: a Console banner, session-list dots, and red nodes in the Cockpit graph.

Both depend on the watch event stream carrying **per-tool-call results**, which it does not today. That enrichment is the central change.

**Out of scope (YAGNI):** historical/replay of finished sessions, Rust-side event timestamps, a session scrubber, cost/token metrics (owned by the separate Token-Dashboard project).

## Problem

The current live stream (`WatchEvent` / `SessionEvent` in `src/lib/types.ts`) is lossy for observability:

- `SessionEvent::toolActivity` carries `toolUseId`, `name`, `filePath` — **no success/error, no timestamp**.
- Per-tool-call results only exist in the local-run `ClaudeEvent` path (`toolResult.isError`). The watched-session stream only emits `agentDone { isError }`, which is per-subagent, not per-call, and never fires for master-level tool calls.
- No event timestamps reach the frontend.

So neither "how long did each call take / did it pass" (timeline) nor "which calls failed" (radar) can be answered from the data the frontend receives.

## Architecture

### 1. Data model — Rust → frontend

Enrich the watch stream so each tool call reports its result.

- Keep `SessionEvent::toolActivity { toolUseId, name, filePath }` as the **call-start** signal (result unknown at call time).
- **Add `SessionEvent::toolDone { toolUseId, isError }`**, emitted when the matching `tool_result` is parsed from the session JSONL. This must fire for **master-level calls too**, not only subagent calls.
- Mirror the new variant in `src/lib/types.ts` (`SessionEvent` union).

Rust changes live in `src-tauri/src/session_watch.rs` (and the shared event enum / parser). The JSONL parser already recognizes `tool_result`; we route it into a `toolDone` watch event keyed by `toolUseId` instead of only collapsing it into `agentDone`.

**Timestamps:** live-only scope means the frontend stamps `Date.now()` on event arrival for both `toolActivity` and `toolDone`. No Rust timestamp work.

### 2. Frontend state — new `src/lib/insightsStore.ts`

A new store, kept separate from `graph.ts` (different concern, independently testable).

- Per session, derive an ordered list of:
  ```ts
  type ToolCall = {
    id: string;          // toolUseId
    name: string;
    filePath: string | null;
    agentRef: string;    // "master" or subagent ref
    startMs: number;     // arrival time of toolActivity
    endMs?: number;      // arrival time of toolDone
    status: "running" | "ok" | "error";
  };
  ```
- A pure reducer folds watch events: `toolActivity` opens a call (`status: "running"`); `toolDone` pairs by `toolUseId`, sets `endMs` and `status` (`error` if `isError`, else `ok`).
- Handle edge cases: `toolDone` with no prior `toolActivity` (ignore or create a zero-duration call); duplicate `toolDone` (last wins); calls that never complete (stay `running`).
- Cap retained calls per session (mirror the transcript's 500-line cap) to bound memory.
- Wire into `applyWatch` in `sessionStore.ts` alongside the existing `setGraph(reduceWatch(...))` call.

### 3. Timeline panel — Console

A collapsible strip inside `pr-console-right`, below the stream (`src/components/Console.tsx`).

- **Swimlanes:** one row for `master`, one per subagent `agentRef` present in the active session.
- **Bars:** each `ToolCall` is a bar positioned horizontally by `startMs`, width by `endMs - startMs`. A `running` call renders open-ended with an animated edge (gated by `[data-reduce-motion="1"]`).
- **Color (existing tokens):** ok → `--good` / `--pos`; error → `--bad`; running → `--accent`.
- **Time axis:** relative to the session's first call (`t+0s`). Auto-scale window to fit; no zoom in v1.
- **Interaction:** hover bar → tooltip (tool name, file, duration in ms). Click bar → scroll the transcript stream to that agent's block.
- **Styling:** new `pr-*` classes (e.g. `.pr-timeline`, `.pr-timeline-lane`, `.pr-timeline-bar`). Labels and numbers use `--font-mono` per the two-voice font rule. Add the classes to `src/themes/tokens.css`.

### 4. Failure radar — one signal, three surfaces

A derived selector `failures(sessionId)` over `insightsStore`: count of `status === "error"` calls, plus any `runError`.

- **Console banner:** when count > 0, a `--bad` strip at the stream head reading e.g. `▲ 3 failures`. Click → scroll to the first failing call.
- **Session-list dots:** the existing `.pr-session-bullet` in the LIVE SESSIONS sidebar turns `--bad` for any session with failures.
- **Cockpit red nodes:** extend `reduceWatch` in `graph.ts` so a `toolDone { isError: true }` marks the owning agent/folder node `failed` (today only `agentDone` sets failed status). The Cockpit already styles `failed` nodes red — no Cockpit component change needed beyond the reducer.

### 5. Data flow

```
session JSONL (disk)
  → Rust watcher parses tool_use / tool_result
  → emits WatchEvent { toolActivity | toolDone | ... } over Tauri channel
  → sessions.ts onEvent
  → sessionStore.applyWatch
       ├─ insightsStore.reduce  → ToolCall list (timeline + failures selector)
       └─ graph.reduceWatch     → red nodes on toolDone{isError}
  → Console renders timeline panel + banner; sidebar dots; Cockpit reads graph
```

## Error handling

- Missing/orphan `toolDone`: tolerated by the reducer (see §2 edge cases); never throws.
- A call with no `toolDone` stays `running` indefinitely — acceptable for live view; it resolves when the result arrives or the session ends.
- Rust parse failures of `tool_result` degrade to "no `toolDone`" (call stays running) rather than crashing the watcher.

## Testing

- **`insightsStore` reducer (unit):** call pairing, duration computation, out-of-order `toolDone`, missing `toolDone`, duplicate `toolDone`, per-session cap, master vs subagent attribution.
- **`failures` selector (unit):** counts errors, includes `runError`, isolates per session.
- **`reduceWatch` (unit):** `toolDone { isError }` marks the owning node `failed`.
- **Rust (unit):** JSONL `tool_result` → `toolDone { toolUseId, isError }` extraction, including master-level calls.

## Files touched

- `src-tauri/src/session_watch.rs` (+ shared event enum/parser) — emit `toolDone`.
- `src/lib/types.ts` — add `toolDone` to `SessionEvent`.
- `src/lib/insightsStore.ts` — **new** store + reducer + `failures` selector.
- `src/lib/sessionStore.ts` — wire `insightsStore.reduce` into `applyWatch`.
- `src/lib/graph.ts` — `toolDone{isError}` → `failed` node in `reduceWatch`.
- `src/components/Console.tsx` — timeline panel + failure banner; session-list dot state.
- `src/themes/tokens.css` — `.pr-timeline*` classes.

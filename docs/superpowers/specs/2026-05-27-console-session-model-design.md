# Console session model → Claude Code parity

**Date:** 2026-05-27
**Status:** Approved (brainstorm)

## Problem

The Console's LIVE SESSIONS rail has two kinds of entries decided by `isLocalSession(id)` (an id-prefix check):

- **Local sessions** — started in-app (`+ NEW` / `RUN`); the app owns the process. Typeable, RUN/CONTINUE, ■/× controls.
- **Observed sessions** — external Claude Code runs the file-watcher picks up. Read-only mirror, no × control.

This diverges from the Claude Code desktop app, where **every session is resumable** — you select any session and continue the conversation in place. In Praetorium, typing into a selected observed session silently spins up a *fresh blank local session* (`newLocalSession()`) because there's no handle to inject into the external process.

Secondary issues:
- Sub-agent activity renders as collapsible blocks **inline** in the master transcript, mixing sub-agent steps into the main feed.
- The cwd chip shows `cwd: default` instead of the app's actual working directory.
- The rail is a flat list — no grouping by directory, and the directory isn't shown.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Observed session input | **Resume via `--resume`** — typing converts it into an owned session, continuing in place |
| Sub-agent placement | **Nested under the session in the left rail** (option B) — out of the main feed |
| Sub-agent view | **Swap the main stream + breadcrumb** (`master / Explore`, click to go back) |
| Master view | **Master-only + inline `↳ spawned Explore` jump markers** |
| Rail grouping | **By directory; label = basename + repo sublabel** (option A) |
| Default cwd | **Resolve & show the real app working directory** basename |
| Resumed placement | **Same directory group** (grouping is by directory, not ownership) |

## Design

### 1. Backend (Rust)

- **Forward the real cwd.** Add `cwd: Option<String>` (full path, already parsed by `line_cwd`) to `SessionMeta` and the frontend `LiveSessionMeta` type. Existing `project` (basename) and `repo` stay. Needed for reliable directory grouping and for resuming in the correct working directory.
- **Expose the app working dir.** New Tauri command `app_cwd() -> String` wrapping `std::env::current_dir()`. Consumed once at startup by the frontend.

### 2. Ownership model refactor

Replace the id-prefix ownership test with **membership**:

- `isLocalSession(id)` becomes `localSessions().has(id)` (owned ⇔ present in the map). `newLocalSession()` still allocates `local`, `local-2`, … ids and adds them to the map, so existing behavior is preserved.
- **Resume-in-place.** When `submit()` runs with an observed (non-owned) active session, add that session to `localSessions` **under its own Claude session id** with `claudeSessionId = id`, `cwd = meta.cwd`, `status = "running"`, then call `startRun` (which already forwards `resumeId = claudeSessionId`). The transcript stays (same id in the `sessions` map), the `(observed)` tag drops, ■/× controls appear, and the conversation continues in place.
  - `newLocalSession` gains an options form, e.g. `newLocalSession(opts?: { id?; claudeSessionId?; cwd?; label? })`, or a sibling `adoptSession(meta)` helper — implementer's choice, kept in `runStore.ts`.
- **Watch dedup.** `claude --resume` appends to the same JSONL the file-watcher tails, so owned sessions would receive double events (run stream + watcher). Add an ownership guard on the watch→`applyWatch` path: drop file-watch events whose `sessionId` is in `localSessions`. The owned run stream is the source of truth. This also removes the existing phantom observed-entry a fresh local run can create when the CLI writes its own session file.

### 3. Rail — grouping + nested sub-agents

New pure, tested module `src/lib/consoleRail.ts`:

```ts
RailSub     = { ref: string; name: string; steps: number }
RailSession = { id: string; title: string; owned: boolean; observed: boolean;
                status?: RunStatus; failCount: number; subagents: RailSub[] }
RailGroup   = { dir: string; label: string; repo?: string; sessions: RailSession[] }
buildRail(input): RailGroup[]
```

- Input: `localSessions`, `metas`, `sessions` (for sub-agent refs + failure counts via insights), and `appCwd`.
- **Group key** = full cwd path. **Label** = basename; `repoLabel()` supplies the worktree sublabel. Owned sessions with no chosen cwd fall under the resolved `appCwd` group (never a literal "default").
- **Sub-agents** derived from each session's transcript lines where `agentRef !== "master"`; `steps` = line count for that ref.
- Groups and sessions sorted by most-recent activity.
- `Console.tsx` renders `<For>` groups → sessions → nested sub-agent rows. Observed (non-owned) sessions render the `(observed)` tag and no × control; owned render ■ (when running) + ×.

### 4. Shared agent naming

Extract the existing `agentNames()` logic from `Console.tsx` into `src/lib/agentNaming.ts` so the rail and the stream name sub-agents identically (duplicate types → "Explore 1"/"Explore 2", otherwise the type name, generics → "agent N").

### 5. Stream — master-only + markers + swap view

- New `viewRef` signal in `Console.tsx`: `null` = master view; an `agentRef` = that sub-agent's transcript.
- **Master view** renders only master turns. At the chronological position where each sub-agent was first spawned, emit a one-line `↳ spawned <agentName>` jump link (sets `viewRef`) instead of the inline `pr-sub` block. Today's inline collapsible sub-blocks are removed from master view.
- **Sub-agent view:** breadcrumb becomes `<sessionTitle> / <agentName>`, the master segment clickable to return (`viewRef = null`); stream shows only that ref's lines.
- Clicking a nested rail sub-agent sets `activeId = session` + `viewRef = ref`. Selecting a session row resets `viewRef = null`.
- The TIMELINE strip is unchanged (already master + lanes).

### 6. cwd chip default

When no folder is chosen, the chip shows the resolved `appCwd` basename instead of `cwd: default`; picking a folder overrides as today. `cwdLabel` / `repoLabel` unchanged.

## Testing

- `consoleRail.test.ts` — grouping by dir, repo sublabel, sub-agent nesting, sort order, observed-vs-owned tagging, `appCwd` fallback group.
- `agentNaming.test.ts` — duplicate types → "Explore 1/2", generic fallback, first-seen order.
- Extend `runStore.test.ts` — membership-based `isLocalSession`; resume-in-place adds an owned entry carrying `claudeSessionId` + `cwd`; watch dedup drops owned-id events.

## Out of scope

- Restyling the TIMELINE strip or failure banner.
- Persisting sessions across app restarts.
- Any change to the Explorer/Cockpit session views.

# Startup backfill of live sessions

## Problem

When Praetorium launches while a Claude Code session is already running, the app
shows the session **card** but its **transcript, graph, and insights are empty**
until the session emits a new line.

Two data paths feed the UI:

- `list_live_sessions` (polled every ~4s) produces the session **cards**. It
  already finds pre-existing files (age ≤ 10 min), so cards appear.
- `watch_sessions` streams **transcript lines, graph nodes, and insights**. At
  startup it seeds every existing file's offset to **EOF**
  ([session_watch.rs:125-151](../../../src-tauri/src/session_watch.rs)), so a
  session already running when the app opens never has its existing content
  replayed.

The result: a card you can click but which shows nothing until new activity.

## Goal

At startup, replay the recent content of **truly-live** sessions (modified in
the last 60s — the existing `LIVE_WINDOW_MS` threshold) so their transcript,
graph, and insights are fully reconstructed the moment the app opens. Idle (but
open) sessions older than 60s keep the current EOF-seed behavior.

## Approach: startup pump

All changes are inside `watch_sessions` in
[src-tauri/src/session_watch.rs](../../../src-tauri/src/session_watch.rs). No
frontend changes — `applyWatch` already handles the emitted events.

1. Create `ch = Arc::new(on_event)` first (currently created after seeding).
2. Add a pure helper to decide each file's seed behavior from its age, so the
   decision is unit-testable:

   ```rust
   enum Seed { Replay, SkipTo(usize) }

   fn seed_for(len: usize, age_ms: u64) -> Seed {
       if age_ms <= LIVE_WINDOW_MS { Seed::Replay } else { Seed::SkipTo(len) }
   }
   ```
3. Seeding loop (mains **and** subagents): for each `.jsonl`, compute `age` from
   its mtime.
   - `Seed::Replay` → insert offset `0` and push the path into a
     `to_backfill: Vec<PathBuf>`.
   - `Seed::SkipTo(len)` → insert offset `len` (current behavior).
4. After the loop, replay backlog: `for p in to_backfill { pump(&p, &offsets, &ch); }`.
   `pump` reads from offset 0 to EOF, emits each parsed event through the
   channel, and advances the offset to EOF.
5. Start the watcher exactly as today.

### Why no double-emit

`pump` advances the file's offset to EOF **before** the watcher is started, so
when the watcher later fires `pump` for the same file it reads only genuinely
new content. No line is sent twice.

### Subagents

Subagent files are evaluated per-file by their own mtime. A subagent active in
the last 60s is replayed too, so the `subagentSpawn` → `toolUseId` mapping that
names nested agents in the Console reconstructs correctly.

## Trade-offs

- A live session that has been open for hours replays its full transcript. The
  UI caps display at 500 lines; graph/insights process all emitted events. This
  is acceptable because the scope is narrow — typically 1–3 live files at once.
- We intentionally do **not** backfill idle (>60s) open sessions. They remain
  EOF-seeded; clicking them shows content only from new activity, as today.

## Testing

- Unit test `seed_for`: returns `Replay` at `age == LIVE_WINDOW_MS` and below,
  `SkipTo(len)` above.
- Manual verification: with a live Claude Code session running, launch
  Praetorium and confirm the session card opens to a populated transcript and a
  non-empty graph immediately, without waiting for new activity.

## Out of scope

- No new Tauri commands or IPC event types.
- No change to `list_live_sessions`, the card polling, or any frontend code.
- No configurable backfill window — the 60s `LIVE_WINDOW_MS` is reused as-is.

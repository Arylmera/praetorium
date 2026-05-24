# Local Session Manager — Design

**Date:** 2026-05-24
**Status:** Approved (pending implementation plan)
**Builds on:** [2026-05-24-launch-agent-design.md](2026-05-24-launch-agent-design.md) (launch with cwd + model) and the follow-on multiple-concurrent-local-sessions work (the `+ NEW` button, per-session run state).

## Summary

Turn the Console's local runs into a real **session manager**: each local session is one ongoing Claude conversation that you can **continue** (resume), **stop** mid-run, **rename**, and **close**, with a visible **status** per session. Several sessions run concurrently (already built); this layers lifecycle and identity on top.

**Resume model:** a local session maps 1:1 to a Claude conversation thread. The first prompt starts the thread (we capture Claude's real session id); every later prompt in that session auto-resumes the same thread with full context. `+ NEW` is how you start a fresh thread.

**Out of scope (YAGNI):** persistence across app restart, recent-cwd history, changing cwd/model mid-thread, concurrent runs *within* a single session, re-attaching to threads from Claude's on-disk history.

## Background

Current state (after the launch-agent + multi-session work):

- `process.rs::run_claude(prompt, cwd, model, on_event)` spawns `claude -p … [--model …]` with an optional `.current_dir(cwd)`. The spawned `CommandChild` is dropped (`_child`), so there is **no way to stop a run**.
- `runStore.ts` tracks a per-session running set (`isRunning(sid)`), allocates local ids via `newLocalSession()` (`local`, `local-2`, …), and routes events through `sessionStore.applyWatch`. There is **no per-session status, no run identity, no resume**.
- The `systemInit` ClaudeEvent already carries Claude's real `sessionId` (see `types.ts`), so resume needs no new Rust parsing — only capture and reuse.
- `claude -p` accepts `--resume <session-id>` to continue an existing conversation; there is no flag to force a subagent type for a top-level run (unchanged from the prior spec).

## Architecture

### 1. Session model

A **local session = one Claude conversation thread**, represented by a `LocalSession` record held in `runStore.ts`:

| field | meaning |
|---|---|
| `sid` | our id (`local`, `local-2`, …) — allocated by `newLocalSession()` |
| `label?` | rename override; when unset, the rail shows the cwd basename / `local run` |
| `cwd?`, `model?` | chosen at creation; **locked once the session has run at least once** (resume cannot change directory or model mid-thread) |
| `claudeSessionId?` | captured from the first `systemInit` event; its presence means "this thread can be resumed" |
| `status` | `idle \| running \| done \| failed \| stopped` |
| `runId?` | the id of the in-flight run, used to stop it |

Stored as a signal `localSessions: Map<string, LocalSession>`. This replaces the bare `runningSessions: Set<string>`. `isRunning(sid)` becomes `localSessions().get(sid)?.status === "running"`.

`runId` is a UUID generated on the frontend per launch (`crypto.randomUUID()`). It is distinct from `claudeSessionId`: `runId` identifies one spawn (for stop); `claudeSessionId` identifies the conversation (for resume).

### 2. Rust — process control + resume (`src-tauri/src/process.rs`, `lib.rs`)

**Run registry** — shared, mutable Tauri managed state:

```rust
#[derive(Default)]
pub struct RunRegistry(pub Mutex<HashMap<String, CommandChild>>);
```

Registered once in `lib.rs` via `.manage(RunRegistry::default())`.

**Arg builder** gains resume:

```rust
pub fn plan_claude(
    prompt: &str,
    cwd: Option<String>,
    model: Option<String>,
    resume_id: Option<String>,
) -> ClaudeInvocation
```

Base args unchanged; append `["--model", m]` when `model` is `Some`; append `["--resume", id]` when `resume_id` is `Some`. `cwd` carried through as before.

**`run_claude`** gains `run_id` + `resume_id` and the registry:

```rust
#[tauri::command]
pub async fn run_claude(
    app: AppHandle,
    run_id: String,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    resume_id: Option<String>,
    on_event: Channel<ClaudeEvent>,
    registry: State<'_, RunRegistry>,
) -> Result<(), String>
```

- On successful spawn, insert the `CommandChild` into the registry under `run_id`.
- In the streaming task, on `CommandEvent::Terminated`, remove `run_id` from the registry before sending `RunComplete`.
- `sanitized_env` / env handling unchanged.

**`stop_claude`** — new command:

```rust
#[tauri::command]
pub async fn stop_claude(run_id: String, registry: State<'_, RunRegistry>) -> Result<(), String>
```

Removes the child from the registry and calls `.kill()`. No-op (returns `Ok`) if the `run_id` is absent (already finished). Killing triggers `Terminated`, which flows through the normal `RunComplete` path; the frontend has already marked the session `stopped` optimistically.

> Note: `CommandChild` is not `Clone`; the registry owns it. Stop *takes* it out of the map (`remove`) and kills the owned value, which also avoids a double-remove race with the `Terminated` handler — whichever runs first wins, the other sees an empty slot.

### 3. Frontend store (`runStore.ts`, `sessionStore.ts`, `claude.ts`)

**`claude.ts`:**
- `runClaude(runId, prompt, onEvent, opts?: { cwd?; model?; resumeId? })` — forwards `runId`, `cwd`, `model`, `resumeId` in the `invoke("run_claude", …)` payload.
- `stopClaude(runId): Promise<void>` — `invoke("stop_claude", { runId })`.

**`runStore.ts`:**
- `localSessions` signal + helpers: `getLocalSession(sid)`, `isRunning(sid)`, `anyRunning()`.
- `newLocalSession()` — unchanged id allocation; seeds a `LocalSession` with `status: "idle"` and `ensureSession(sid)` in `sessionStore`; sets it active.
- `startRun(sid, prompt, opts?)`:
  - guard: ignore when `isRunning(sid)` or empty prompt.
  - resolve `resumeId = session.claudeSessionId` (continue) — on the first run it is `undefined`.
  - lock `cwd`/`model` onto the session if not already set; thereafter ignore incoming opts (the thread's dir/model are fixed).
  - `runId = crypto.randomUUID()`; set `status: "running"`, store `runId`.
  - call `runClaude(runId, prompt, onEvent, { cwd, model, resumeId })`.
  - event handling: capture `systemInit.sessionId` → set `claudeSessionId`; `result.isError` / `runError` → status `failed` + echo text; `runComplete` → status `done` (unless already `stopped`); transcript turns flow through `applyWatch` as today.
- `stopRun(sid)` — if running, set status `stopped`, call `stopClaude(runId)`.
- `closeSession(sid)` — if running, `stopRun` first; then remove from `localSessions` and from `sessionStore` (`removeSession`); if it was active, select another local session or `null`.
- `renameSession(sid, label)` — set `label` (empty string clears back to default).
- A pure `nextStatus(prev, event)` reducer encapsulates the transitions so it is unit-testable without the Tauri bridge.

**`sessionStore.ts`:**
- `ensureSession(sid)` already exists.
- add `removeSession(sid)` — drops the session from `sessions` (and clears `activeId` if it pointed there). Insights/graph entries for a removed local session are pruned opportunistically (best-effort; they already tolerate missing sessions).

### 4. UI (`src/components/Console.tsx`, `src/themes/tokens.css`)

**Session rail rows:**
- Status-colored bullet: `idle` → `--gull-2`; `running` → `--accent` (pulsing, gated by reduce-motion); `done` → `--good`/`--pos`; `failed` → `--bad`; `stopped` → `--warn`.
- **× close** control on the row (hover-revealed); confirm not required (in-memory, cheap to re-create).
- **rename**: double-click the title → inline text input; Enter commits `renameSession`, Escape cancels.
- **STOP**: shown on the active session (and/or inline on running rows) while `status === "running"`.

**Input bar:**
- cwd chip + model dropdown are editable only when the active session is `idle`. Once the session has started (`cwd`/`model` locked), they render as **read-only chips** showing the locked values.
- RUN button label is **RUN** for a fresh thread and **CONTINUE** when the active session has a `claudeSessionId`; placeholder shifts from `ask Claude (this machine)…` to `continue…`.
- The input/RUN gate on the *active* session's running state (`activeRunning()`), preserving concurrency.

**New `pr-*` classes:** status-bullet modifiers (`.is-idle/.is-running/.is-done/.is-failed/.is-stopped`), `.pr-session-close`, `.pr-session-rename` (input), `.pr-stop`, `.pr-cwd-chip.is-locked` / `.pr-model-select:disabled` styling. Path / model / id values use `--font-mono` per the two-voice rule. Motion (the running pulse) is gated by `[data-reduce-motion="1"]`.

### 5. Data flow

```
+ NEW → newLocalSession() (status: idle)
choose cwd / model            (only while idle)
RUN / CONTINUE → startRun(sid, prompt):
    runId = crypto.randomUUID()
    resumeId = session.claudeSessionId      (undefined on first run)
    status = running
  → runClaude(runId, prompt, { cwd, model, resumeId })
  → invoke("run_claude", { runId, prompt, cwd, model, resumeId })
  → registry.insert(runId, child); claude -p … [--model …] [--resume id]  (.current_dir when set)
  → systemInit ⇒ capture claudeSessionId
  → stream ⇒ transcript (applyWatch)
  → result/runComplete ⇒ status done | failed; registry.remove(runId)
STOP  → stopRun(sid): status = stopped → stopClaude(runId) → child.kill() → Terminated → RunComplete
CLOSE → closeSession(sid): stopRun if running → removeSession + drop LocalSession → reselect active
```

## Error handling

- **Stop with no active run** (already finished, or `runId` absent): `stop_claude` returns `Ok`; frontend no-op.
- **Stale resume id** (Claude can't find the conversation): `claude` exits non-zero / emits an error → existing `RunError` / `result.isError` path → status `failed`, error echoed as an assistant turn. No special handling.
- **Spawn failure** (invalid cwd, missing `claude`): existing `run_claude` `Err(...)` path → `runStore` `catch` → status `failed`.
- **Close while running**: `closeSession` stops first, then removes — no orphaned child (registry entry is killed/removed).
- **Empty prompt**: existing guard in `startRun` returns early.

## Testing

TDD throughout — write the test, watch it fail, then implement.

**Rust unit (`process.rs`):**
- `plan_claude` appends `--resume <id>` only when `resume_id` is `Some`; absent when `None`; composes correctly with `--model` (order: base, `--model`, `--resume`).
- existing `--model` / cwd / base-args / `sanitized_env` tests unchanged.
- registry behavior: a small helper that inserts then `remove`s a sentinel returns the value once and `None` thereafter (proves stop's take-once semantics without spawning a real process).

**Frontend unit:**
- `nextStatus` reducer: `idle→running` on start; `running→done` on `runComplete`; `running→failed` on `runError`/`result.isError`; `stopped` is sticky (a late `runComplete` does not flip `stopped`→`done`).
- `startRun` forwards `resumeId` only when the session already has a `claudeSessionId`; omits it on the first run; locks `cwd`/`model` after first run.
- `systemInit` capture sets `claudeSessionId` on the session.
- `closeSession` removes the session from both stores; `renameSession` sets/clears the label.
- existing `cwdLabel` and `newLocalSession` id-allocation tests unchanged.

**Verification gate:** `npm test`, `cargo test`, `npm run build`, `cargo build`, `tsc --noEmit` all green. UI (status bullets, stop, rename, close, continue) verified manually in `npm run tauri dev` — the native dialog and real process kill cannot be exercised in a plain browser preview.

## Files touched

- `src-tauri/src/process.rs` — `RunRegistry`; `plan_claude` resume arg; `run_claude` gains `run_id`/`resume_id` + registry insert/remove; new `stop_claude`.
- `src-tauri/src/lib.rs` — `.manage(RunRegistry::default())`; register `stop_claude` in the handler list.
- `src/lib/claude.ts` — `runClaude` gains `runId`/`resumeId`; new `stopClaude`.
- `src/lib/runStore.ts` — `LocalSession` model + status; `nextStatus` reducer; resume in `startRun`; `stopRun`, `closeSession`, `renameSession`.
- `src/lib/sessionStore.ts` — `removeSession`.
- `src/components/Console.tsx` — status bullets, stop/close/rename controls, continue UX, locked cwd/model chips.
- `src/themes/tokens.css` — status-bullet, stop, close, rename, locked-chip classes.

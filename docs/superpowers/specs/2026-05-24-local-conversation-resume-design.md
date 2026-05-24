# Local Conversation Resume — Design

**Date:** 2026-05-24
**Status:** Approved, pending implementation

## Problem

Typing a follow-up into the Console chat box starts a **brand-new Claude
conversation** instead of continuing the open one. Every submit spawns a fresh
`claude -p <prompt>` with no `--resume`, so the model has no memory of prior
turns — even though those turns accumulate visually under the single "local"
session card.

Root cause: `startRun` → `runClaude` → `run_claude` (`src-tauri/src/process.rs`)
always builds `claude -p <prompt> --output-format stream-json --verbose` with no
session-continuation flag.

## Scope

- **Resume the local run only.** Observed/external sessions are watched
  read-only on disk; we cannot inject input into a Claude process running
  elsewhere, so their input is hidden entirely.
- Add an explicit **NEW** control to start a fresh local conversation.

Out of scope: resuming/injecting into externally-observed sessions.

## Design

### 1. Resume the local conversation (core fix)

**Backend — `src-tauri/src/process.rs`**
- `plan_claude(prompt, cwd, model, resume: Option<String>)`: when `resume` is
  `Some(id)`, prepend `--resume <id>` to the arg vector
  (`claude --resume <id> -p <prompt> --output-format stream-json --verbose`).
- `run_claude` command gains a `resume: Option<String>` parameter, threaded into
  `plan_claude`.
- Update existing `plan_claude` unit tests for the new signature; add a test
  asserting `--resume <id>` is present when provided and absent when `None`.

**Frontend — `src/lib/claude.ts`**
- `runClaude(prompt, onEvent, opts)` — extend `opts` with `resume?: string` and
  pass it into `invoke("run_claude", { … resume: opts?.resume })`.

**Frontend — `src/lib/runStore.ts`**
- `startRun` passes `resume: localSessionId() ?? undefined` to `runClaude`.
- `setLocalSessionId` is already called on each run's `systemInit` line, so the
  next follow-up chains onto the latest id Claude reports. No extra tracking
  needed.

Behaviour: first prompt (no `localSessionId`) = fresh session; every subsequent
prompt = `--resume` onto the latest local session id. Context preserved.

### 2. Explicit NEW button

- Add a `resetLocal()` to `src/lib/runStore.ts` that:
  - `setLocalSessionId(null)`,
  - clears the `"local"` entry from the `sessions` map and its `insights` /
    `graph` state (via a `clearSession("local")` helper added to
    `sessionStore.ts`) so the transcript and timeline reset visually.
- Add a `+ NEW` chip to `.pr-launch-opts` in `src/components/Console.tsx`,
  `disabled={running()}`, calling `resetLocal()`.
- **Lock cwd + model selectors while a conversation is underway**
  (`localSessionId()` is set), since `--resume` reuses the original session's
  cwd and a mid-conversation change would silently no-op. They unlock after
  `resetLocal()`. Existing `disabled={running()}` is widened to
  `disabled={running() || localSessionId() != null}`.

### 3. Hide input on non-local sessions

- The `.pr-inputbar` form renders **only when `activeId() === "local"`**.
  Selecting an observed/external card hides it (read-only view).
- To keep the input reachable:
  - **Always render a "local" card** in the Console rail, even before the first
    run. Update `list()` so the local entry is always present (synthesize an
    empty `{ project, lines: [] }` when `sessions()` has no `"local"` yet).
  - **Default `activeId` to `"local"`** (`createSignal<string | null>("local")`
    in `sessionStore.ts`) so the input shows on load. `applyWatch`'s
    "adopt first arriving session when activeId is null" no longer fires for the
    initial external session, keeping local focus by default.

Net UX: input visible by default; clicking an external session hides it;
clicking the local card returns to the typeable view.

## Components touched

| File | Change |
|------|--------|
| `src-tauri/src/process.rs` | `resume` param on `plan_claude` + `run_claude`; `--resume` arg; tests |
| `src/lib/claude.ts` | `resume` in `opts`, passed to `invoke` |
| `src/lib/runStore.ts` | pass `resume`; add `resetLocal()` |
| `src/lib/sessionStore.ts` | default `activeId="local"`; `clearSession(id)` helper |
| `src/components/Console.tsx` | always-present local card; gate inputbar on `activeId==="local"`; NEW chip; lock cwd/model while conversation underway |
| `src/themes/tokens.css` | `.pr-new` chip styling (reuse `.pr-cwd-chip` vocabulary) |

## Error handling

- Resume of a stale/missing session id: `claude --resume` errors are already
  surfaced via the existing `runError` / `result.isError` paths into the
  transcript. No new handling required.

## Testing

- Rust: `plan_claude` tests for `--resume` presence/absence and arg order.
- Manual (preview): launch a prompt, send a follow-up, confirm the model
  references prior context; click NEW, confirm transcript/timeline clear and
  cwd/model unlock; select an external session, confirm the input is hidden;
  reselect local, confirm it returns.

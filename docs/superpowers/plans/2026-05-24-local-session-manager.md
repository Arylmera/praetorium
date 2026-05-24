# Local Session Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Console local runs a full session manager — stop/cancel a run, close/rename sessions, per-session status, and auto-continue (resume) a conversation thread.

**Architecture:** A Rust run-registry (`Arc<Mutex<HashMap<runId, CommandChild>>>`) in Tauri managed state owns process lifecycle so runs can be killed. Each local session is one Claude conversation thread; the frontend captures Claude's real session id from the `systemInit` event and passes `--resume <id>` on follow-up prompts. State is in-memory only.

**Tech Stack:** Rust + Tauri v2 (`tauri-plugin-shell`), SolidJS + TypeScript, Vitest, `cargo test`.

**Spec:** [docs/superpowers/specs/2026-05-24-local-session-manager-design.md](../specs/2026-05-24-local-session-manager-design.md)

---

## File Structure

- `src-tauri/src/process.rs` — add generic `Registry<T>` + `RunRegistry` alias; `plan_claude` gains `resume_id`; `run_claude` gains `run_id`/`resume_id` + registry insert/remove; new `stop_claude`.
- `src-tauri/src/lib.rs` — `.manage(RunRegistry::default())`; register `stop_claude`.
- `src/lib/claude.ts` — `runClaude` gains `runId` + `resumeId`; new `stopClaude`.
- `src/lib/sessionStore.ts` — new `removeSession`.
- `src/lib/runStore.ts` — `LocalSession` model + `RunStatus`; pure `nextStatus` reducer; `localSessions` map signal; rewritten `newLocalSession`/`startRun`; new `stopRun`/`closeSession`/`renameSession`.
- `src/lib/runStore.test.ts` — rewritten for the new API.
- `src/components/Console.tsx` — status bullets, stop/close/rename controls, continue UX, locked cwd/model chips.
- `src/components/Cockpit.tsx` — already recognizes `local-*` ids (no change needed).
- `src/themes/tokens.css` — status/stop/close/rename/locked-chip classes.

---

## Task 1: Rust — `plan_claude` resume arg

**Files:**
- Modify: `src-tauri/src/process.rs` (the `plan_claude` fn + its test module)

- [ ] **Step 1: Update the existing tests to the new 4-arg signature and add the resume test**

In `src-tauri/src/process.rs`, inside `mod tests`, change the three existing `plan_claude(...)` calls to pass a 4th `None` argument, and add a new test:

```rust
    #[test]
    fn includes_resume_arg_only_when_provided() {
        let with = plan_claude("hi", None, None, Some("sess-123".to_string()));
        assert!(with
            .args
            .windows(2)
            .any(|w| w[0] == "--resume" && w[1] == "sess-123"));

        let without = plan_claude("hi", None, None, None);
        assert!(!without.args.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn composes_model_and_resume() {
        let plan = plan_claude("hi", None, Some("opus".to_string()), Some("s1".to_string()));
        let joined = plan.args.join(" ");
        assert!(joined.contains("--model opus"));
        assert!(joined.contains("--resume s1"));
    }
```

Update the existing calls:
- `includes_model_arg_only_when_provided`: `plan_claude("hi", None, Some("opus".to_string()), None)` and `plan_claude("hi", None, None, None)`.
- `sets_cwd_only_when_provided`: `plan_claude("hi", Some("/tmp/proj".to_string()), None, None)` and `plan_claude("hi", None, None, None)`.
- `always_includes_base_args`: `plan_claude("do thing", None, None, None)`.

- [ ] **Step 2: Run the tests — verify they fail to compile**

Run: `cd src-tauri && cargo test --lib plan` 
Expected: FAIL — `plan_claude` takes 3 args, the new calls pass 4 (`this function takes 3 arguments but 4 arguments were supplied`).

- [ ] **Step 3: Add `resume_id` to `plan_claude`**

Replace the `plan_claude` function body:

```rust
pub fn plan_claude(
    prompt: &str,
    cwd: Option<String>,
    model: Option<String>,
    resume_id: Option<String>,
) -> ClaudeInvocation {
    let mut args = vec![
        "-p".to_string(),
        prompt.to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
    ];
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model);
    }
    if let Some(id) = resume_id {
        args.push("--resume".to_string());
        args.push(id);
    }
    ClaudeInvocation { args, cwd }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `cd src-tauri && cargo test --lib` 
Expected: PASS — the `run_claude` caller still passes 3 args, so it will NOT compile yet. If `run_claude` fails to compile, that is expected and fixed in Task 2; to isolate this task, temporarily update the `run_claude` call to `plan_claude(&prompt, cwd, model, None)` now (it stays correct after Task 2).

Update the `run_claude` body line to:

```rust
    let plan = plan_claude(&prompt, cwd, model, None);
```

Re-run: `cd src-tauri && cargo test --lib`
Expected: PASS (all `plan_claude` tests green).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/process.rs
git commit -m "feat(process): plan_claude supports --resume arg"
```

---

## Task 2: Rust — run registry + `run_claude` run_id/resume

**Files:**
- Modify: `src-tauri/src/process.rs` (imports, `Registry`, `run_claude`, test module)

- [ ] **Step 1: Write the failing registry test**

Add to `mod tests` in `src-tauri/src/process.rs`:

```rust
    #[test]
    fn registry_take_returns_value_once() {
        use super::Registry;
        let r: Registry<u32> = Registry::default();
        r.insert("a".to_string(), 7);
        assert_eq!(r.take("a"), Some(7));
        assert_eq!(r.take("a"), None);
    }
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd src-tauri && cargo test --lib registry`
Expected: FAIL — `cannot find type Registry in module super` / `no Registry in process`.

- [ ] **Step 3: Add the registry type and imports**

At the top of `src-tauri/src/process.rs`, add imports:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
```

(Merge with the existing `use` lines; remove any now-duplicated ones. Keep `use crate::events::ClaudeEvent;` and `use crate::parser::parse_line;`.)

Add the registry after the `ClaudeInvocation` struct:

```rust
/// A run id → child-process registry, so in-flight `claude` runs can be killed.
pub struct Registry<T>(pub Arc<Mutex<HashMap<String, T>>>);

impl<T> Default for Registry<T> {
    fn default() -> Self {
        Registry(Arc::new(Mutex::new(HashMap::new())))
    }
}

impl<T> Clone for Registry<T> {
    fn clone(&self) -> Self {
        Registry(self.0.clone())
    }
}

impl<T> Registry<T> {
    pub fn insert(&self, id: String, val: T) {
        self.0.lock().unwrap().insert(id, val);
    }
    /// Remove and return the value; second call for the same id yields `None`.
    pub fn take(&self, id: &str) -> Option<T> {
        self.0.lock().unwrap().remove(id)
    }
}

pub type RunRegistry = Registry<CommandChild>;
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd src-tauri && cargo test --lib registry`
Expected: PASS.

- [ ] **Step 5: Wire `run_claude` to take run_id/resume_id and use the registry**

Replace the `run_claude` signature and the spawn/registry handling:

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
) -> Result<(), String> {
    let plan = plan_claude(&prompt, cwd, model, resume_id);
    let shell = app.shell();
    let mut command = shell
        .command("claude")
        .args(plan.args)
        .env_clear()
        .envs(sanitized_env(std::env::vars()));
    if let Some(dir) = plan.cwd {
        command = command.current_dir(dir);
    }
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("failed to spawn claude: {e}"))?;
    registry.insert(run_id.clone(), child);

    let reg = registry.inner().clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    for ev in parse_line(&line) {
                        let _ = on_event.send(ev);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let msg = String::from_utf8_lossy(&bytes).to_string();
                    let _ = on_event.send(ClaudeEvent::RunError { message: msg });
                }
                CommandEvent::Terminated(payload) => {
                    reg.take(&run_id);
                    let code = payload.code.unwrap_or(-1);
                    let _ = on_event.send(ClaudeEvent::RunComplete { exit_code: code });
                }
                _ => {}
            }
        }
    });

    Ok(())
}
```

Note: `registry.inner()` returns `&RunRegistry`; `.clone()` clones the `Arc` (cheap) so the streaming task owns a handle without borrowing `State`.

- [ ] **Step 6: Run the lib tests — verify they still pass**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS (all existing + new tests). The crate will not fully build until `lib.rs` registers the registry (Task 3) — `cargo test --lib` compiles the lib including `run_claude`; the `State<RunRegistry>` param compiles fine without `.manage`. If you see an unresolved-state error it only surfaces at runtime, not compile time.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/process.rs
git commit -m "feat(process): run registry + run_id/resume on run_claude"
```

---

## Task 3: Rust — `stop_claude` + register in `lib.rs`

**Files:**
- Modify: `src-tauri/src/process.rs` (new command)
- Modify: `src-tauri/src/lib.rs` (manage state + handler)

- [ ] **Step 1: Add the `stop_claude` command**

Append to `src-tauri/src/process.rs` (before the test module):

```rust
/// Kill an in-flight run by its run id. No-op if the run already finished.
#[tauri::command]
pub async fn stop_claude(run_id: String, registry: State<'_, RunRegistry>) -> Result<(), String> {
    if let Some(child) = registry.take(&run_id) {
        let _ = child.kill();
    }
    Ok(())
}
```

- [ ] **Step 2: Register the state and command in `lib.rs`**

In `src-tauri/src/lib.rs`, add `.manage(...)` and extend the handler. Replace the builder chain:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(process::RunRegistry::default())
        .invoke_handler(tauri::generate_handler![process::run_claude, process::stop_claude, vault::read_vault_file, vault::vault_index, vault::vault_links, vault::read_cartographicum, vault::read_folder_graph, sessions::list_sessions, sessions::read_session, session_watch::list_live_sessions, session_watch::watch_sessions])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

- [ ] **Step 3: Build — verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: PASS (finishes with no errors).

- [ ] **Step 4: Run all Rust tests**

Run: `cd src-tauri && cargo test --lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/process.rs src-tauri/src/lib.rs
git commit -m "feat(process): stop_claude command + register run registry"
```

---

## Task 4: Frontend — `claude.ts` runId/resume + stopClaude

**Files:**
- Modify: `src/lib/claude.ts`

- [ ] **Step 1: Rewrite `runClaude` and add `stopClaude`**

Replace the whole body of `src/lib/claude.ts`:

```typescript
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ClaudeEvent } from "./types";

/** Run a prompt; `onEvent` fires for every streamed event. Resolves once spawn returns. */
export async function runClaude(
  runId: string,
  prompt: string,
  onEvent: (event: ClaudeEvent) => void,
  opts?: { cwd?: string; model?: string; resumeId?: string },
): Promise<void> {
  const channel = new Channel<ClaudeEvent>();
  channel.onmessage = onEvent;
  await invoke("run_claude", {
    runId,
    prompt,
    cwd: opts?.cwd,
    model: opts?.model,
    resumeId: opts?.resumeId,
    onEvent: channel,
  });
}

/** Kill an in-flight run by its run id. */
export async function stopClaude(runId: string): Promise<void> {
  await invoke("stop_claude", { runId });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — `runStore.ts` still calls `runClaude(prompt, onEvent, opts)` (3 args, wrong order). This is fixed in Task 6. Proceed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/claude.ts
git commit -m "feat(claude): runId + resumeId on runClaude; add stopClaude"
```

---

## Task 5: Frontend — `nextStatus` reducer (TDD)

**Files:**
- Modify: `src/lib/runStore.ts` (add types + reducer)
- Modify: `src/lib/runStore.test.ts` (add reducer tests)

- [ ] **Step 1: Write the failing reducer tests**

Add to `src/lib/runStore.test.ts` (keep the existing `cwdLabel` describe; the `startRun`/`concurrency`/`newLocalSession` describes are replaced in Task 6 — leave them for now, they will be rewritten). Add the import `nextStatus` and a new describe:

```typescript
import { nextStatus } from "./runStore";

describe("nextStatus", () => {
  test("running → done on runComplete", () => {
    expect(nextStatus("running", { type: "runComplete", data: { exitCode: 0 } } as any)).toBe("done");
  });
  test("running → failed on runError", () => {
    expect(nextStatus("running", { type: "runError", data: { message: "x" } } as any)).toBe("failed");
  });
  test("running → failed on errored result", () => {
    expect(nextStatus("running", { type: "result", data: { isError: true, result: "x" } } as any)).toBe("failed");
  });
  test("failed stays failed on a later runComplete", () => {
    expect(nextStatus("failed", { type: "runComplete", data: { exitCode: 1 } } as any)).toBe("failed");
  });
  test("stopped is sticky", () => {
    expect(nextStatus("stopped", { type: "runComplete", data: { exitCode: -1 } } as any)).toBe("stopped");
  });
  test("non-terminal events keep the status", () => {
    expect(nextStatus("running", { type: "assistantText", data: { text: "hi", parentToolUseId: null } } as any)).toBe("running");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run src/lib/runStore.test.ts -t nextStatus`
Expected: FAIL — `nextStatus is not a function`.

- [ ] **Step 3: Add the types and reducer at the top of `runStore.ts`**

In `src/lib/runStore.ts`, after the imports, add:

```typescript
export type RunStatus = "idle" | "running" | "done" | "failed" | "stopped";

export interface LocalSession {
  sid: string;
  label?: string;
  cwd?: string;
  model?: string;
  claudeSessionId?: string;
  status: RunStatus;
  runId?: string;
}

/** Pure status transition for a session given a streamed event. `stopped` is sticky. */
export function nextStatus(prev: RunStatus, ev: ClaudeEvent): RunStatus {
  if (prev === "stopped") return "stopped";
  switch (ev.type) {
    case "runError":
      return "failed";
    case "result":
      return ev.data.isError ? "failed" : prev;
    case "runComplete":
      return prev === "failed" ? "failed" : "done";
    default:
      return prev;
  }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run src/lib/runStore.test.ts -t nextStatus`
Expected: PASS (the 6 reducer tests). Other describes in the file may fail to compile against the not-yet-changed API — that is fixed in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runStore.ts src/lib/runStore.test.ts
git commit -m "feat(runStore): add LocalSession model + nextStatus reducer"
```

---

## Task 6: Frontend — session store model, startRun resume, lifecycle ops (TDD)

**Files:**
- Modify: `src/lib/sessionStore.ts` (add `removeSession`)
- Modify: `src/lib/runStore.ts` (localSessions map, rewritten startRun, stopRun/closeSession/renameSession)
- Modify: `src/lib/runStore.test.ts` (replace the startRun/concurrency/newLocalSession describes)

- [ ] **Step 1: Add `removeSession` to `sessionStore.ts`**

In `src/lib/sessionStore.ts`, after `ensureSession`, add:

```typescript
/** Remove a session entirely (used when closing a local session). */
export function removeSession(sid: string) {
  setSessions((prev) => {
    if (!prev.has(sid)) return prev;
    const next = new Map(prev);
    next.delete(sid);
    return next;
  });
  if (activeId() === sid) setActiveId(null);
}
```

- [ ] **Step 2: Write the failing runStore behavior tests**

Replace the `startRun`, `concurrency`, and `newLocalSession` describes in `src/lib/runStore.test.ts` with the following (keep `cwdLabel` and `nextStatus` describes). Update the mock to the new `runClaude(runId, prompt, onEvent, opts)` signature with controllable events:

```typescript
const h = vi.hoisted(() => ({
  emit: [] as unknown[],
  lastOnEvent: null as ((e: unknown) => void) | null,
}));

vi.mock("./claude", () => ({
  runClaude: vi.fn((_runId: string, _prompt: string, onEvent: (e: unknown) => void) => {
    h.lastOnEvent = onEvent;
    for (const e of h.emit) onEvent(e);
    return Promise.resolve();
  }),
  stopClaude: vi.fn(() => Promise.resolve()),
}));

import { runClaude, stopClaude } from "./claude";
import {
  cwdLabel,
  nextStatus,
  startRun,
  stopRun,
  closeSession,
  renameSession,
  isRunning,
  newLocalSession,
  localSessions,
} from "./runStore";

const RUNCOMPLETE = { type: "runComplete", data: { exitCode: 0 } };

describe("newLocalSession", () => {
  test("allocates 'local' first, then suffixed ids, each idle", () => {
    const a = newLocalSession();
    expect(a).toBe("local");
    expect(localSessions().get(a)?.status).toBe("idle");
    const b = newLocalSession();
    expect(b).not.toBe("local");
    expect(b).toMatch(/^local-\d+$/);
  });
});

describe("startRun", () => {
  beforeEach(() => {
    vi.mocked(runClaude).mockClear();
    h.emit = [RUNCOMPLETE];
  });

  test("forwards opts (no resumeId on first run) and a generated runId", async () => {
    const sid = newLocalSession();
    await startRun(sid, "hello", { cwd: "/home/u/proj", model: "opus" });
    expect(runClaude).toHaveBeenCalledWith(
      expect.any(String),
      "hello",
      expect.any(Function),
      { cwd: "/home/u/proj", model: "opus", resumeId: undefined },
    );
  });

  test("ignores empty prompts", async () => {
    const sid = newLocalSession();
    await startRun(sid, "   ");
    expect(runClaude).not.toHaveBeenCalled();
  });

  test("captures claudeSessionId from systemInit and resumes on the next run", async () => {
    const sid = newLocalSession();
    h.emit = [{ type: "systemInit", data: { sessionId: "claude-abc" } }, RUNCOMPLETE];
    await startRun(sid, "first", { cwd: "/p" });
    expect(localSessions().get(sid)?.claudeSessionId).toBe("claude-abc");

    vi.mocked(runClaude).mockClear();
    h.emit = [RUNCOMPLETE];
    await startRun(sid, "second");
    expect(runClaude).toHaveBeenCalledWith(
      expect.any(String),
      "second",
      expect.any(Function),
      { cwd: "/p", model: undefined, resumeId: "claude-abc" },
    );
  });

  test("locks cwd/model after the first run", async () => {
    const sid = newLocalSession();
    h.emit = [RUNCOMPLETE];
    await startRun(sid, "first", { cwd: "/locked", model: "opus" });
    vi.mocked(runClaude).mockClear();
    await startRun(sid, "second", { cwd: "/ignored", model: "haiku" });
    expect(runClaude).toHaveBeenCalledWith(
      expect.any(String),
      "second",
      expect.any(Function),
      { cwd: "/locked", model: "opus", resumeId: undefined },
    );
  });

  test("sets status done on completion", async () => {
    const sid = newLocalSession();
    h.emit = [RUNCOMPLETE];
    await startRun(sid, "go");
    expect(localSessions().get(sid)?.status).toBe("done");
  });
});

describe("concurrency", () => {
  beforeEach(() => {
    vi.mocked(runClaude).mockClear();
    h.emit = []; // leave runs in-flight (no completion)
  });

  test("marks the session running and blocks a second run on it", async () => {
    const sid = newLocalSession();
    await startRun(sid, "first");
    expect(isRunning(sid)).toBe(true);
    await startRun(sid, "second");
    expect(runClaude).toHaveBeenCalledTimes(1);
  });

  test("allows different sessions concurrently", async () => {
    const a = newLocalSession();
    const b = newLocalSession();
    await startRun(a, "a");
    await startRun(b, "b");
    expect(isRunning(a)).toBe(true);
    expect(isRunning(b)).toBe(true);
    expect(runClaude).toHaveBeenCalledTimes(2);
  });
});

describe("stopRun", () => {
  beforeEach(() => {
    vi.mocked(runClaude).mockClear();
    vi.mocked(stopClaude).mockClear();
    h.emit = [];
  });

  test("sets status stopped and calls stopClaude with the runId", async () => {
    const sid = newLocalSession();
    await startRun(sid, "go");
    await stopRun(sid);
    expect(localSessions().get(sid)?.status).toBe("stopped");
    expect(stopClaude).toHaveBeenCalledWith(expect.any(String));
  });

  test("a late runComplete does not flip stopped back to done", async () => {
    const sid = newLocalSession();
    await startRun(sid, "go");
    await stopRun(sid);
    h.lastOnEvent?.(RUNCOMPLETE);
    expect(localSessions().get(sid)?.status).toBe("stopped");
  });
});

describe("closeSession / renameSession", () => {
  beforeEach(() => { h.emit = [RUNCOMPLETE]; });

  test("closeSession removes it from localSessions", async () => {
    const sid = newLocalSession();
    await closeSession(sid);
    expect(localSessions().has(sid)).toBe(false);
  });

  test("renameSession sets and clears the label", () => {
    const sid = newLocalSession();
    renameSession(sid, "my run");
    expect(localSessions().get(sid)?.label).toBe("my run");
    renameSession(sid, "");
    expect(localSessions().get(sid)?.label).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests — verify they fail**

Run: `npx vitest run src/lib/runStore.test.ts`
Expected: FAIL — `localSessions`, `stopRun`, `closeSession`, `renameSession` are not exported; `startRun` has the old signature/behavior.

- [ ] **Step 4: Rewrite the body of `runStore.ts`**

Replace everything in `src/lib/runStore.ts` BELOW the `nextStatus` reducer (added in Task 5) — i.e. the old `runningSessions`/`isRunning`/`anyRunning`/`setRunning`, `localCount`/`newLocalSession`, `cwdLabel`, `toWatch`, and `startRun` — with:

```typescript
const [localSessions, setLocalSessions] = createSignal<Map<string, LocalSession>>(new Map());
export { localSessions };

export function isLocalSession(id: string | null | undefined): id is string {
  return !!id && (id === "local" || id.startsWith("local-"));
}

export function isRunning(sid: string): boolean {
  return localSessions().get(sid)?.status === "running";
}
export function anyRunning(): boolean {
  return [...localSessions().values()].some((s) => s.status === "running");
}

function updateSession(sid: string, patch: Partial<LocalSession>) {
  setLocalSessions((prev) => {
    const cur = prev.get(sid);
    if (!cur) return prev;
    return new Map(prev).set(sid, { ...cur, ...patch });
  });
}

let localCount = 0;
/** Allocate a fresh local session ("local", then "local-2", …), seed it so it
 *  shows in the rail immediately, make it active, and return its id. */
export function newLocalSession(): string {
  localCount += 1;
  const sid = localCount === 1 ? "local" : `local-${localCount}`;
  setLocalSessions((prev) => new Map(prev).set(sid, { sid, status: "idle" }));
  ensureSession(sid);
  setActiveId(sid);
  return sid;
}

/** Derive the local session's project label from the chosen cwd: its basename,
 *  or "local run" when no cwd is set. Tolerates trailing and Windows separators. */
export function cwdLabel(cwd?: string): string {
  if (!cwd) return LOCAL_PROJECT;
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const base = trimmed.split(/[/\\]/).pop();
  return base || LOCAL_PROJECT;
}

/** Translate a locally-launched run's ClaudeEvent into a WatchEvent so the app's
 *  own run flows through the same sessionStore pipeline as observed sessions. */
function toWatch(ev: ClaudeEvent, sid: string, project: string): WatchEvent | null {
  const wrap = (agentRef: string, event: SessionEvent): WatchEvent =>
    ({ type: "session", data: { sessionId: sid, project, agentRef, event } });
  switch (ev.type) {
    case "assistantText":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "turn", data: { role: "assistant", text: ev.data.text } });
    case "subagentSpawn":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "subagentSpawn", data: { toolUseId: ev.data.toolUseId, subagentType: ev.data.subagentType } });
    case "toolCall":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "toolActivity", data: { toolUseId: ev.data.toolUseId, name: ev.data.name, filePath: ev.data.filePath } });
    case "toolResult":
      return wrap(ev.data.parentToolUseId ?? "master", { kind: "toolDone", data: { toolUseId: ev.data.toolUseId, isError: ev.data.isError } });
    default:
      return null;
  }
}

export async function startRun(sid: string, prompt: string, opts?: { cwd?: string; model?: string }): Promise<void> {
  const s = localSessions().get(sid);
  if (!s || s.status === "running" || !prompt.trim()) return;
  // Lock cwd/model onto the thread on the first run; ignore opts thereafter.
  const cwd = s.cwd ?? opts?.cwd;
  const model = s.model ?? opts?.model;
  const project = s.label ?? cwdLabel(cwd);
  const runId = crypto.randomUUID();
  const resumeId = s.claudeSessionId;
  const turn = (role: string, text: string): WatchEvent =>
    ({ type: "session", data: { sessionId: sid, project, agentRef: "master", event: { kind: "turn", data: { role, text } } } });

  updateSession(sid, { status: "running", runId, cwd, model });
  applyWatch(turn("user", prompt));
  try {
    await runClaude(runId, prompt, (ev: ClaudeEvent) => {
      if (ev.type === "systemInit") updateSession(sid, { claudeSessionId: ev.data.sessionId });
      const w = toWatch(ev, sid, project);
      if (w) applyWatch(w);
      else if (ev.type === "result" && ev.data.isError) applyWatch(turn("assistant", ev.data.result));
      else if (ev.type === "runError") applyWatch(turn("assistant", ev.data.message));
      const prev = localSessions().get(sid)?.status ?? "running";
      updateSession(sid, { status: nextStatus(prev, ev) });
    }, { cwd, model, resumeId });
  } catch (e) {
    applyWatch(turn("assistant", String(e)));
    updateSession(sid, { status: "failed" });
  }
}

export async function stopRun(sid: string): Promise<void> {
  const s = localSessions().get(sid);
  if (!s || s.status !== "running" || !s.runId) return;
  updateSession(sid, { status: "stopped" });
  await stopClaude(s.runId);
}

export async function closeSession(sid: string): Promise<void> {
  const s = localSessions().get(sid);
  if (!s) return;
  if (s.status === "running") await stopRun(sid);
  setLocalSessions((prev) => {
    if (!prev.has(sid)) return prev;
    const next = new Map(prev);
    next.delete(sid);
    return next;
  });
  removeSession(sid);
  if (activeId() === null) {
    const fallback = [...localSessions().keys()][0];
    if (fallback) setActiveId(fallback);
  }
}

export function renameSession(sid: string, label: string) {
  updateSession(sid, { label: label.trim() || undefined });
}
```

Update the imports at the very top of `runStore.ts` to:

```typescript
import { createSignal } from "solid-js";
import { runClaude, stopClaude } from "./claude";
import { applyWatch, ensureSession, removeSession, setActiveId, activeId } from "./sessionStore";
import type { ClaudeEvent, WatchEvent, SessionEvent } from "./types";

const LOCAL_PROJECT = "local run";
```

(`activeId` is already exported from `sessionStore.ts`. Remove the old `LOCAL_SID` constant if still present.)

- [ ] **Step 5: Run the tests — verify they pass**

Run: `npx vitest run src/lib/runStore.test.ts`
Expected: PASS (all describes).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL only in `Console.tsx` (it imports/uses the old `running`/`startRun` shape). Fixed in Task 7.

- [ ] **Step 7: Commit**

```bash
git add src/lib/runStore.ts src/lib/runStore.test.ts src/lib/sessionStore.ts
git commit -m "feat(runStore): session lifecycle (resume, stop, close, rename) + status"
```

---

## Task 7: UI — Console controls + continue UX

**Files:**
- Modify: `src/components/Console.tsx`
- Modify: `src/themes/tokens.css`

- [ ] **Step 1: Update Console imports and derived helpers**

In `src/components/Console.tsx`, change the runStore import (line 5) to:

```typescript
import { startRun, stopRun, closeSession, renameSession, isRunning, newLocalSession, isLocalSession, localSessions, cwdLabel } from "../lib/runStore";
```

Add, near the other derived signals (after the `activeRunning` definition):

```typescript
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const sess = (id: string) => localSessions().get(id);
  const activeSess = () => { const id = activeId(); return isLocalSession(id) ? sess(id) : undefined; };
  const canContinue = () => !!activeSess()?.claudeSessionId;
  const locked = () => { const s = activeSess(); return !!(s && (s.cwd !== undefined || s.model !== undefined) && s.status !== "idle"); };
```

- [ ] **Step 2: Rewrite `submit` to feed cwd/model only for idle sessions**

Replace `submit`:

```typescript
  async function submit(e: Event) {
    e.preventDefault();
    const p = prompt();
    if (!p.trim()) return;
    setPrompt("");
    const m = model();
    const id = activeId();
    const sid = isLocalSession(id) ? id : newLocalSession();
    await startRun(sid, p, { cwd: cwd(), model: m === "default" ? undefined : m });
  }
```

(Once a session has run, `startRun` ignores the passed cwd/model — they are locked server-side in the store — so no extra guard is needed here.)

- [ ] **Step 3: Add status-bullet class + controls to the session rows**

Replace the session row (`<For each={list()}>` block) body with:

```tsx
          <For each={list()}>{([id, s]) => {
            const m = () => metas().get(id);
            const status = () => sess(id)?.status;
            const bulletCls = () => {
              if (failCount(id) > 0) return " is-failed";
              const st = status();
              return st ? ` is-${st}` : "";
            };
            return (
              <div class={`pr-session${id === activeId() ? " is-active" : ""}`} onClick={() => setActiveId(id)} title={id}>
                <span class={`pr-session-bullet${bulletCls()}`} />
                <Show
                  when={renaming() === id}
                  fallback={
                    <span class="pr-session-title" onDblClick={(e) => { e.stopPropagation(); setRenaming(id); }}>
                      {sess(id)?.label ?? m()?.title ?? s.project ?? id.slice(0, 8)}
                    </span>
                  }
                >
                  <input
                    class="pr-session-rename"
                    autofocus
                    value={sess(id)?.label ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { renameSession(id, e.currentTarget.value); setRenaming(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { renameSession(id, e.currentTarget.value); setRenaming(null); }
                      else if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                </Show>
                <span class="pr-session-time">{isLocalSession(id) ? (status() === "running" ? "live" : "now") : ""}</span>
                <Show when={isLocalSession(id) && status() === "running"}>
                  <button class="pr-session-stop" type="button" title="stop run"
                    onClick={(e) => { e.stopPropagation(); void stopRun(id); }}>■</button>
                </Show>
                <Show when={isLocalSession(id)}>
                  <button class="pr-session-close" type="button" title="close session"
                    onClick={(e) => { e.stopPropagation(); void closeSession(id); }}>×</button>
                </Show>
              </div>
            );
          }}</For>
```

- [ ] **Step 4: Update the input bar — locked chips + CONTINUE label**

Replace the `pr-launch-opts` block and the RUN button area:

```tsx
          <div class="pr-launch-opts">
            <Show
              when={!locked()}
              fallback={
                <>
                  <span class="pr-cwd-chip is-locked" title={activeSess()?.cwd ?? "app working directory"}>
                    {activeSess()?.cwd ? cwdLabel(activeSess()!.cwd) : "cwd: default"}
                  </span>
                  <span class="pr-model-chip is-locked">{activeSess()?.model ?? "default"}</span>
                </>
              }
            >
              <button type="button" class="pr-cwd-chip" onClick={pickCwd} disabled={activeRunning()}
                title={cwd() ?? "run in app's working directory"}>
                <span class="pr-cwd-label">{cwd() ? cwdLabel(cwd()) : "cwd: default"}</span>
                <Show when={cwd()}>
                  <span class="pr-cwd-clear" role="button" aria-label="clear working directory"
                    onClick={(e) => { e.stopPropagation(); if (!activeRunning()) setCwd(undefined); }}>×</span>
                </Show>
              </button>
              <select class="pr-model-select" value={model()} disabled={activeRunning()}
                onChange={(e) => setModel(e.currentTarget.value)}>
                <option value="default">default</option>
                <option value="opus">opus</option>
                <option value="sonnet">sonnet</option>
                <option value="haiku">haiku</option>
              </select>
            </Show>
          </div>
          <div class="pr-input-wrap">
            <span class="pr-input-ps">$</span>
            <input class="pr-input" value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)}
              placeholder={activeRunning() ? "running…" : canContinue() ? "continue…" : "ask Claude (this machine)…"}
              disabled={activeRunning()} />
          </div>
          <button class={`pr-run${activeRunning() ? " is-running" : ""}`} type="submit" disabled={activeRunning()}>
            {activeRunning() ? "RUNNING" : canContinue() ? "CONTINUE" : "RUN"}
          </button>
```

- [ ] **Step 5: Add CSS to `tokens.css`**

After the `.pr-new-session` rules, add:

```css
.pr-session-bullet.is-idle { background: var(--gull-2); }
.pr-session-bullet.is-running { background: var(--accent); animation: pr-blink 1s steps(2) infinite; }
.pr-session-bullet.is-done { background: var(--good); }
.pr-session-bullet.is-failed { background: var(--bad); }
.pr-session-bullet.is-stopped { background: var(--warn); }
.pr-session-stop, .pr-session-close { margin-left: 6px; background: transparent; border: 0; color: var(--gull); cursor: pointer; font: 500 12px var(--font-mono); line-height: 1; padding: 0 2px; opacity: 0; transition: opacity var(--dur-snap), color var(--dur-snap); }
.pr-session:hover .pr-session-stop, .pr-session:hover .pr-session-close, .pr-session-stop { opacity: 1; }
.pr-session-stop { color: var(--warn); opacity: 1; }
.pr-session-stop:hover { color: var(--bad); }
.pr-session-close:hover { color: var(--bad); }
.pr-session-rename { flex: 1; min-width: 0; background: var(--panel-2); border: 1px solid var(--accent); border-radius: var(--radius-sm); color: var(--bone); font: 500 12px var(--font-mono); padding: 2px 6px; outline: none; }
.pr-model-chip, .pr-cwd-chip.is-locked { display: inline-flex; align-items: center; background: transparent; border: 1px dashed var(--iron-border); border-radius: var(--radius-sm); color: var(--gull); padding: 4px 10px; font: 500 11px var(--font-mono); cursor: default; }
[data-reduce-motion="1"] .pr-session-bullet.is-running { animation: none; }
```

- [ ] **Step 6: Typecheck + tests + build**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (tsc clean; all vitest suites green).

- [ ] **Step 7: Commit**

```bash
git add src/components/Console.tsx src/themes/tokens.css
git commit -m "feat(console): per-session status, stop/close/rename, continue UX"
```

---

## Task 8: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Frontend tests**

Run: `npm test`
Expected: PASS — all suites, including the new reducer / lifecycle tests.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Frontend build**

Run: `npm run build`
Expected: built successfully (the pre-existing `@tauri-apps/api/window.js` dynamic-import warning is unrelated and OK).

- [ ] **Step 4: Rust test + build**

Run: `cd src-tauri && cargo test --lib && cargo build`
Expected: all tests pass; build finishes clean.

- [ ] **Step 5: Manual smoke test (desktop)**

Run: `npm run tauri dev`. Verify: `+ NEW` makes a fresh idle session; RUN streams and the bullet goes running→done; STOP kills a run (bullet → stopped); a second prompt in a finished session shows CONTINUE and resumes context; cwd/model chips lock after first run; rename (double-click) and close (×) work; two sessions run concurrently. Note explicitly that the native dialog + real kill are only exercisable here, not in a browser preview.

- [ ] **Step 6: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage:**
- Stop/cancel → Tasks 2, 3 (registry + `stop_claude`), 6 (`stopRun`), 7 (STOP button). ✓
- Close/rename → Task 6 (`closeSession`/`renameSession` + `removeSession`), 7 (× + dbl-click rename). ✓
- Per-session status → Task 5 (`nextStatus`), 6 (status field), 7 (bullets). ✓
- Resume/auto-continue → Task 1 (`--resume`), 2 (`resume_id`), 6 (capture systemInit + pass resumeId), 7 (CONTINUE). ✓
- cwd/model locked after first run → Task 6 (`startRun` lock), 7 (locked chips). ✓
- In-memory only → no persistence task. ✓

**Type consistency:** `RunStatus` values (`idle/running/done/failed/stopped`) used identically in reducer, store, and CSS class names (`is-<status>`). `runClaude(runId, prompt, onEvent, opts)` order matches between `claude.ts` (Task 4), the test mock (Task 6), and `startRun` (Task 6). `Registry<T>` `insert`/`take` used in `run_claude`, `stop_claude`, and the test (Tasks 2–3). `removeSession` defined in Task 6 step 1, used later same task.

**Placeholder scan:** none — every code/test step contains full content.

# Console Session Model — Claude Code Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Console's LIVE SESSIONS behave like the Claude Code desktop app — observed sessions resume in place, sub-agents nest in the rail instead of polluting the feed, sessions group by directory, and the cwd chip shows the real working directory.

**Architecture:** Ownership becomes membership-based (`localSessions.has(id)`) so an observed session can be adopted under its own Claude session id and resumed via the existing `resumeId` path. The file-watcher is deduped against owned ids. A pure `consoleRail` module groups sessions by directory with nested sub-agents; the stream renders master-only with jump markers and a swap-to-sub-agent breadcrumb view. The backend forwards the full cwd and exposes its own working directory.

**Tech Stack:** Solid.js (signals), TypeScript, Vitest, Tauri (Rust), Vite.

---

## File Structure

- `src-tauri/src/session_watch.rs` — add `cwd` to `SessionMeta`, populate it (MODIFY)
- `src-tauri/src/process.rs` or `lib.rs` — new `app_cwd` command (MODIFY) + register it
- `src/lib/types.ts` — add `cwd?` to `LiveSessionMeta` (MODIFY)
- `src/lib/sessions.ts` — `appCwd()` wrapper (MODIFY)
- `src/lib/agentNaming.ts` — extracted pure sub-agent naming (CREATE) + `agentNaming.test.ts`
- `src/lib/consoleRail.ts` — pure directory-grouping tree builder (CREATE) + `consoleRail.test.ts`
- `src/lib/runStore.ts` — membership ownership, `adoptSession`, ownership probe wiring (MODIFY)
- `src/lib/sessionStore.ts` — `applyWatch` external/owned guard + ownership probe (MODIFY)
- `src/App.tsx` — mark watcher events external (MODIFY)
- `src/components/Console.tsx` — rail grouping render, resume submit, `viewRef` stream/breadcrumb/markers, cwd chip default (MODIFY)
- `src/themes/tokens.css` — nested rail + spawn-marker + breadcrumb styles (MODIFY)

Tasks are ordered by dependency. Tasks 3, 4, and 5 are independent of each other and may be dispatched in parallel; Task 7 depends on all prior tasks.

---

## Task 1: Backend — forward full cwd + expose app working dir

**Files:**
- Modify: `src-tauri/src/session_watch.rs:9-17` (SessionMeta struct), `:101-110` (populate cwd)
- Modify: `src-tauri/src/lib.rs` (register `app_cwd` in the invoke handler)
- Create: `app_cwd` command (add to `session_watch.rs` next to `list_live_sessions`)

- [ ] **Step 1: Add `cwd` to the `SessionMeta` struct**

In `src-tauri/src/session_watch.rs`, add the field:

```rust
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub project: String,
    pub title: String,
    pub last_activity_ms: u64,
    pub state: String,
    pub cwd: Option<String>,
}
```

- [ ] **Step 2: Populate `cwd` in `list_live_sessions`**

The full cwd is already parsed locally as part of deriving `cwd_basename`. Capture and forward it. Replace the `cwd_basename`/`friendly_project` lines (around `:103-104`) and the push (`:110`):

```rust
let cwd_full = content.lines().find_map(line_cwd);
let cwd_basename = cwd_full.as_deref().map(basename);
let friendly_project = cwd_basename.unwrap_or_else(|| project.clone());
```

and add `cwd: cwd_full,` to the `SessionMeta { ... }` constructed at `:110`.

- [ ] **Step 3: Add the `app_cwd` command**

Add to `src-tauri/src/session_watch.rs`:

```rust
#[tauri::command]
pub fn app_cwd() -> Option<String> {
    std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string())
}
```

- [ ] **Step 4: Register `app_cwd` in the invoke handler**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler![...]` macro and add `session_watch::app_cwd` to the list (alongside the existing `session_watch::list_live_sessions`). Match the existing module path style used for `list_live_sessions`.

- [ ] **Step 5: Build the Rust crate to verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: compiles with no errors (warnings about unused are acceptable).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/session_watch.rs src-tauri/src/lib.rs
git commit -m "feat(backend): forward session cwd and expose app_cwd"
```

---

## Task 2: Frontend types + bindings for cwd

**Files:**
- Modify: `src/lib/types.ts:62` (LiveSessionMeta)
- Modify: `src/lib/sessions.ts` (add `appCwd`)

- [ ] **Step 1: Add `cwd` to `LiveSessionMeta`**

In `src/lib/types.ts`, change line 62 to:

```ts
export interface LiveSessionMeta { id: string; project: string; title: string; lastActivityMs: number; state: string; cwd?: string }
```

- [ ] **Step 2: Add the `appCwd` binding**

In `src/lib/sessions.ts`, add:

```ts
export async function appCwd(): Promise<string | undefined> {
  try { return (await invoke<string | null>("app_cwd")) ?? undefined; } catch { return undefined; }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/sessions.ts
git commit -m "feat: surface session cwd and app_cwd binding to frontend"
```

---

## Task 3: Extract sub-agent naming into a pure module

**Files:**
- Create: `src/lib/agentNaming.ts`
- Create: `src/lib/agentNaming.test.ts`

The naming logic currently lives inline in `Console.tsx` `agentNames()` (`:58-80`). Extract the pure core so the rail and the stream name agents identically.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agentNaming.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAgentNames } from "./agentNaming";

describe("buildAgentNames", () => {
  it("uses the subagent type when unique", () => {
    const names = buildAgentNames(["r1"], (r) => (r === "r1" ? "Explore" : undefined));
    expect(names.get("r1")).toBe("Explore");
  });

  it("numbers duplicate types in first-seen order", () => {
    const typeOf = (r: string) => (r === "r1" || r === "r2" ? "Explore" : undefined);
    const names = buildAgentNames(["r1", "r2"], typeOf);
    expect(names.get("r1")).toBe("Explore 1");
    expect(names.get("r2")).toBe("Explore 2");
  });

  it("falls back to sequential generic names when no type", () => {
    const names = buildAgentNames(["r1", "r2"], () => undefined);
    expect(names.get("r1")).toBe("agent 1");
    expect(names.get("r2")).toBe("agent 2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/agentNaming.test.ts`
Expected: FAIL — cannot find module `./agentNaming`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/agentNaming.ts`:

```ts
/** Stable, legible names for nested agents from their refs in first-seen order.
 *  Duplicate subagent types are numbered ("Explore 1"/"Explore 2"); a unique
 *  type is used bare; refs with no type fall back to sequential "agent N". */
export function buildAgentNames(
  refsInOrder: string[],
  typeOf: (ref: string) => string | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  const typeTotals = new Map<string, number>();
  for (const r of refsInOrder) { const t = typeOf(r); if (t) typeTotals.set(t, (typeTotals.get(t) ?? 0) + 1); }
  const typeSeen = new Map<string, number>();
  let generic = 0;
  for (const r of refsInOrder) {
    const t = typeOf(r);
    if (t) {
      const n = (typeSeen.get(t) ?? 0) + 1;
      typeSeen.set(t, n);
      map.set(r, (typeTotals.get(t) ?? 1) > 1 ? `${t} ${n}` : t);
    } else {
      map.set(r, `agent ${++generic}`);
    }
  }
  return map;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/agentNaming.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentNaming.ts src/lib/agentNaming.test.ts
git commit -m "feat: extract buildAgentNames pure helper"
```

---

## Task 4: `consoleRail` — directory grouping with nested sub-agents

**Files:**
- Create: `src/lib/consoleRail.ts`
- Create: `src/lib/consoleRail.test.ts`

Pure tree builder. Takes flat rail entries (assembled by `Console.tsx`) plus the resolved app cwd; groups by directory. Reuses `repoLabel` from `runStore`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/consoleRail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRail, type RailEntry } from "./consoleRail";

const entry = (over: Partial<RailEntry>): RailEntry => ({
  id: "x", title: "t", owned: true, observed: false, status: "idle",
  failCount: 0, lastActivityMs: 0, cwd: undefined, subagents: [], ...over,
});

describe("buildRail", () => {
  it("groups by cwd and labels with the basename", () => {
    const groups = buildRail([
      entry({ id: "a", cwd: "C:/git/praetorium", lastActivityMs: 1 }),
      entry({ id: "b", cwd: "C:/git/praetorium", lastActivityMs: 3 }),
      entry({ id: "c", cwd: "C:/git/token-dashboard", lastActivityMs: 2 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["praetorium", "token-dashboard"]);
    // newest session first within the group
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("orders groups by their most-recent session", () => {
    const groups = buildRail([
      entry({ id: "a", cwd: "C:/x", lastActivityMs: 1 }),
      entry({ id: "b", cwd: "C:/y", lastActivityMs: 5 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["y", "x"]);
  });

  it("derives a repo sublabel for worktree cwds", () => {
    const groups = buildRail([
      entry({ id: "a", cwd: "C:/git/praetorium/.claude/worktrees/kind-bartik" }),
    ]);
    expect(groups[0].repo).toBe("praetorium");
  });

  it("places cwd-less owned sessions under the resolved app cwd", () => {
    const groups = buildRail([entry({ id: "a", cwd: undefined })], "C:/git/praetorium");
    expect(groups[0].label).toBe("praetorium");
    expect(groups[0].dir).toBe("C:/git/praetorium");
  });

  it("keeps sub-agents nested on their session", () => {
    const groups = buildRail([
      entry({ id: "a", cwd: "C:/x", subagents: [{ ref: "r1", name: "Explore", steps: 6 }] }),
    ]);
    expect(groups[0].sessions[0].subagents).toEqual([{ ref: "r1", name: "Explore", steps: 6 }]);
  });

  it("retains observed tagging", () => {
    const groups = buildRail([entry({ id: "a", cwd: "C:/x", owned: false, observed: true })]);
    expect(groups[0].sessions[0].observed).toBe(true);
    expect(groups[0].sessions[0].owned).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/consoleRail.test.ts`
Expected: FAIL — cannot find module `./consoleRail`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/consoleRail.ts`:

```ts
import type { RunStatus } from "./runStore";
import { cwdLabel, repoLabel } from "./runStore";

export interface RailSub { ref: string; name: string; steps: number }
export interface RailEntry {
  id: string;
  title: string;
  owned: boolean;
  observed: boolean;
  status?: RunStatus;
  failCount: number;
  lastActivityMs: number;
  cwd?: string;
  subagents: RailSub[];
}
export interface RailGroup {
  dir: string;        // group key: the resolved cwd (or "" when none)
  label: string;      // basename of dir
  repo?: string;      // worktree repo sublabel
  sessions: RailEntry[];
}

/** Group rail entries by their working directory. Entries with no cwd fall back
 *  to `appCwd`; if that is also undefined they collect under an empty-key group.
 *  Sessions sort newest-first within a group; groups sort by their newest member. */
export function buildRail(entries: RailEntry[], appCwd?: string): RailGroup[] {
  const groups = new Map<string, RailEntry[]>();
  for (const e of entries) {
    const dir = e.cwd ?? appCwd ?? "";
    (groups.get(dir) ?? groups.set(dir, []).get(dir)!).push(e);
  }
  const out: RailGroup[] = [];
  for (const [dir, sessions] of groups) {
    sessions.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
    out.push({ dir, label: dir ? cwdLabel(dir) : "local", repo: repoLabel(dir), sessions });
  }
  out.sort((a, b) => (b.sessions[0]?.lastActivityMs ?? 0) - (a.sessions[0]?.lastActivityMs ?? 0));
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/consoleRail.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/consoleRail.ts src/lib/consoleRail.test.ts
git commit -m "feat: consoleRail directory grouping with nested sub-agents"
```

---

## Task 5: runStore — membership ownership + adopt/resume + ownership probe

**Files:**
- Modify: `src/lib/runStore.ts:36-38` (isLocalSession), `:58-68` (newLocalSession), add `adoptSession`, add probe wiring
- Modify: `src/lib/runStore.test.ts` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/runStore.test.ts` (inside the file, after the existing imports add `isLocalSession`, `adoptSession`, `metas`-free):

First extend the import block at the top to include `isLocalSession` and `adoptSession`:

```ts
import {
  cwdLabel, nextStatus, startRun, stopRun, closeSession, renameSession,
  isRunning, newLocalSession, isLocalSession, adoptSession, localSessions,
} from "./runStore";
```

Then append these describe blocks at the end of the file:

```ts
describe("isLocalSession (membership)", () => {
  test("true once a session is in the map, regardless of id shape", () => {
    adoptSession({ id: "claude-xyz", project: "p", title: "t", lastActivityMs: 0, cwd: "/p" });
    expect(isLocalSession("claude-xyz")).toBe(true);
  });
  test("false for an unknown id", () => {
    expect(isLocalSession("nope-not-here")).toBe(false);
  });
  test("false for null/undefined", () => {
    expect(isLocalSession(null)).toBe(false);
    expect(isLocalSession(undefined)).toBe(false);
  });
});

describe("adoptSession (resume in place)", () => {
  beforeEach(() => { vi.mocked(runClaude).mockClear(); h.emit = [RUNCOMPLETE]; });

  test("adds an owned entry carrying claudeSessionId and cwd", () => {
    adoptSession({ id: "claude-r", project: "p", title: "t", lastActivityMs: 0, cwd: "/work/dir" });
    const s = localSessions().get("claude-r");
    expect(s?.claudeSessionId).toBe("claude-r");
    expect(s?.cwd).toBe("/work/dir");
  });

  test("a subsequent run resumes via the adopted claudeSessionId", async () => {
    adoptSession({ id: "claude-r2", project: "p", title: "t", lastActivityMs: 0, cwd: "/d" });
    await startRun("claude-r2", "go");
    expect(runClaude).toHaveBeenCalledWith(
      expect.any(String), "go", expect.any(Function),
      { cwd: "/d", model: undefined, resumeId: "claude-r2" },
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/runStore.test.ts`
Expected: FAIL — `adoptSession` is not exported; `isLocalSession` membership assertions fail.

- [ ] **Step 3: Make `isLocalSession` membership-based**

In `src/lib/runStore.ts`, replace the existing `isLocalSession` (`:35-38`):

```ts
/** True for any owned (locally-driven) session — one present in the map. This
 *  includes both `newLocalSession` ids and observed sessions adopted for resume. */
export function isLocalSession(id: string | null | undefined): id is string {
  return !!id && localSessions().has(id);
}
```

Note: `localSessions` is declared below this point. Move the `const [localSessions, setLocalSessions] = ...` / `export { localSessions };` block (`:40-41`) to ABOVE `isLocalSession` so the reference resolves. (Function bodies are hoisted, but keep declaration order clean.)

- [ ] **Step 4: Add `adoptSession` and the ownership probe**

Add the import at the top of `src/lib/runStore.ts`:

```ts
import { setOwnershipProbe } from "./sessionStore";
```

(extend the existing `./sessionStore` import line rather than adding a second import). Add `LiveSessionMeta` to the `./types` import.

Add `adoptSession` near `newLocalSession`:

```ts
/** Adopt an observed session as an owned one so it can be resumed in place:
 *  key it under its own Claude session id, seed claudeSessionId (the resume
 *  target) and the real cwd, and focus it. No-op if already owned. */
export function adoptSession(meta: LiveSessionMeta): void {
  if (localSessions().has(meta.id)) { setActiveId(meta.id); return; }
  setLocalSessions((prev) => new Map(prev).set(meta.id, {
    sid: meta.id, claudeSessionId: meta.id, cwd: meta.cwd, status: "idle",
  }));
  ensureSession(meta.id);
  setActiveId(meta.id);
}
```

At the bottom of the module (after all declarations), wire the probe so the watcher can recognise owned ids:

```ts
// Let sessionStore drop file-watch events for sessions we already drive.
setOwnershipProbe((id) => localSessions().has(id));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/runStore.test.ts`
Expected: PASS (existing + new tests). `setOwnershipProbe` must already exist from Task 6 — if running this task first, it will fail to import; dispatch Task 6's Step 1-2 (the export) before this step, or run them together.

- [ ] **Step 6: Commit**

```bash
git add src/lib/runStore.ts src/lib/runStore.test.ts
git commit -m "feat: membership-based ownership + adoptSession for resume-in-place"
```

---

## Task 6: sessionStore — external/owned watch guard

**Files:**
- Modify: `src/lib/sessionStore.ts:60-80` (applyWatch + probe)
- Modify: `src/App.tsx:51` (mark watcher events external)
- Modify: `src/lib/sessionStore.test.ts` if present, else covered by runStore tests

- [ ] **Step 1: Add the ownership probe and guard to `applyWatch`**

In `src/lib/sessionStore.ts`, add near the top (after the signals):

```ts
// Injected by runStore: reports whether a session id is locally driven (owned).
// Used to drop duplicate file-watch events for sessions we already stream.
let isOwned: (id: string) => boolean = () => false;
export function setOwnershipProbe(fn: (id: string) => boolean): void { isOwned = fn; }
```

Change the `applyWatch` signature and add the guard as the first lines of the body:

```ts
export function applyWatch(e: WatchEvent, opts?: { external?: boolean }) {
  if (e.type !== "session") return;
  if (opts?.external && isOwned(e.data.sessionId)) return; // owned run is source of truth
  const { sessionId, project, event, agentRef } = e.data;
  // ...unchanged below...
```

- [ ] **Step 2: Mark watcher events external in `App.tsx`**

In `src/App.tsx`, change line 51:

```ts
watchSessions((e) => applyWatch(e, { external: true }));
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`runStore` imports `setOwnershipProbe` — confirm it resolves.)

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — all suites green, including the new `runStore` adopt/membership tests (the probe is now wired end-to-end).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessionStore.ts src/App.tsx
git commit -m "feat: drop duplicate file-watch events for owned sessions"
```

---

## Task 7: Console.tsx — rail grouping, resume, sub-agent view, cwd default

**Files:**
- Modify: `src/components/Console.tsx` (rail render, submit, viewRef, stream, crumb, cwd chip)

- [ ] **Step 1: Resolve the app cwd on mount and import the new helpers**

At the top of `src/components/Console.tsx`, extend imports:

```ts
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { appCwd } from "../lib/sessions";
import { buildRail, type RailEntry } from "../lib/consoleRail";
import { buildAgentNames } from "../lib/agentNaming";
import { adoptSession } from "../lib/runStore";
```

(merge `adoptSession` into the existing `../lib/runStore` import line; merge `appCwd` is a new line from `../lib/sessions`.)

Inside `Console()`, add:

```ts
const [appDir, setAppDir] = createSignal<string | undefined>(undefined);
onMount(async () => setAppDir(await appCwd()));
const [viewRef, setViewRef] = createSignal<string | null>(null);
```

- [ ] **Step 2: Replace inline `agentNames()` with the extracted helper**

Replace the body of `agentNames` (`:58-80`) so it delegates to `buildAgentNames`, preserving the existing ref-collection order:

```ts
const agentNames = () => {
  const refs: string[] = [];
  const push = (r: string) => { if (r !== "master" && !refs.includes(r)) push2(r); };
  const push2 = (r: string) => refs.push(r);
  for (const l of active()?.lines ?? []) push(l.agentRef);
  for (const c of activeCalls()) push(c.agentRef);
  const typeOf = (r: string) => subagentTypes().get(`${activeId()}:${r}`);
  return buildAgentNames(refs, typeOf);
};
```

- [ ] **Step 3: Build rail entries and group them**

Add a helper that assembles `RailEntry[]` from the live stores, then groups. Sub-agent refs per session come from that session's transcript lines; names reuse `buildAgentNames` scoped to that session.

```ts
const railSubs = (id: string): { ref: string; name: string; steps: number }[] => {
  const lines = sessions().get(id)?.lines ?? [];
  const refs: string[] = [];
  const steps = new Map<string, number>();
  for (const l of lines) if (l.agentRef !== "master") {
    if (!refs.includes(l.agentRef)) refs.push(l.agentRef);
    steps.set(l.agentRef, (steps.get(l.agentRef) ?? 0) + 1);
  }
  const names = buildAgentNames(refs, (r) => subagentTypes().get(`${id}:${r}`));
  return refs.map((r) => ({ ref: r, name: names.get(r) ?? r, steps: steps.get(r) ?? 0 }));
};

const railGroups = () => {
  const entries: RailEntry[] = list().map(([id, s]) => {
    const ls = sess(id);
    const m = metas().get(id);
    return {
      id,
      title: ls?.label ?? m?.title ?? s.project ?? id.slice(0, 8),
      owned: isLocalSession(id),
      observed: !isLocalSession(id) && metas().has(id),
      status: ls?.status,
      failCount: failCount(id),
      lastActivityMs: m?.lastActivityMs ?? (isLocalSession(id) ? now() : 0),
      cwd: ls?.cwd ?? (m?.cwd),
      subagents: railSubs(id),
    };
  });
  return buildRail(entries, appDir());
};
```

- [ ] **Step 4: Render the grouped rail with nested sub-agents**

Replace the `<div class="pr-sessions-list">…</div>` block (`:174-221`) with a grouped render. Selecting a session resets `viewRef`; clicking a sub-agent selects the session and sets `viewRef`.

```tsx
<div class="pr-sessions-list">
  <For each={railGroups()}>{(g) => (
    <div class="pr-session-group">
      <div class="pr-session-group-head">
        <span class="pr-session-group-dir">{g.label}</span>
        <Show when={g.repo}><span class="pr-session-group-repo">{g.repo}</span></Show>
      </div>
      <For each={g.sessions}>{(e) => {
        const bulletCls = () => {
          if (e.failCount > 0) return " is-failed";
          return e.status ? ` is-${e.status}` : "";
        };
        return (
          <>
            <div class={`pr-session${e.id === activeId() && viewRef() === null ? " is-active" : ""}`}
                 onClick={() => { setActiveId(e.id); setViewRef(null); }} title={e.id}>
              <span class={`pr-session-bullet${bulletCls()}`} />
              <Show when={renaming() === e.id}
                fallback={
                  <span class="pr-session-title"
                        onDblClick={(ev) => { ev.stopPropagation(); if (e.owned) setRenaming(e.id); }}>
                    {e.title}
                  </span>
                }>
                <input class="pr-session-rename" autofocus value={sess(e.id)?.label ?? ""}
                  onClick={(ev) => ev.stopPropagation()}
                  onBlur={(ev) => { renameSession(e.id, ev.currentTarget.value); setRenaming(null); }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") { renameSession(e.id, ev.currentTarget.value); setRenaming(null); }
                    else if (ev.key === "Escape") setRenaming(null);
                  }} />
              </Show>
              <span class="pr-session-time">
                {e.observed ? "" : e.status === "running" ? "live" : "now"}
              </span>
              <Show when={e.owned && e.status === "running"}>
                <button class="pr-session-stop" type="button" title="stop run"
                  onClick={(ev) => { ev.stopPropagation(); void stopRun(e.id); }}>■</button>
              </Show>
              <Show when={e.owned}>
                <button class="pr-session-close" type="button" title="close session"
                  onClick={(ev) => { ev.stopPropagation(); void closeSession(e.id); }}>×</button>
              </Show>
              <Show when={e.observed}><span class="pr-session-observed">observed</span></Show>
            </div>
            <For each={e.subagents}>{(sub) => (
              <div class={`pr-session-sub${e.id === activeId() && viewRef() === sub.ref ? " is-active" : ""}`}
                   onClick={() => { setActiveId(e.id); setViewRef(sub.ref); }}
                   title={`${sub.name} · ${sub.steps} steps`}>
                <span class="pr-session-sub-arrow">↳</span>
                <span class="pr-session-sub-name">{sub.name}</span>
                <span class="pr-session-sub-steps">{sub.steps}</span>
              </div>
            )}</For>
          </>
        );
      }}</For>
    </div>
  )}</For>
</div>
```

- [ ] **Step 5: Resume observed sessions on submit**

Replace `submit` (`:96-107`) so an observed active session is adopted (resumed in place) instead of spinning up a blank session:

```ts
async function submit(e: Event) {
  e.preventDefault();
  const p = prompt();
  if (!p.trim()) return;
  setPrompt("");
  const m = model();
  const id = activeId();
  let sid: string;
  if (isLocalSession(id)) sid = id;
  else if (id && metas().has(id)) { adoptSession(metas().get(id)!); sid = id; }
  else sid = newLocalSession();
  setViewRef(null);
  await startRun(sid, p, { cwd: cwd(), model: m === "default" ? undefined : m });
}
```

- [ ] **Step 6: Master-only stream with spawn markers; sub-agent swap view + breadcrumb**

Change the breadcrumb (`:226-234`) to reflect `viewRef`:

```tsx
<div class="pr-stream-crumb">
  <span class="pr-crumb-loc" onClick={() => setViewRef(null)}>{activeTitle()}</span>
  <Show when={viewRef()}>
    <span class="pr-crumb-sep">/</span>
    <b>{agentName(viewRef()!)}</b>
  </Show>
</div>
```

Replace the transcript render (`:257-297`) so master view shows master turns plus `↳ spawned <name>` markers (no inline sub-blocks), and sub-agent view shows only the selected ref's lines:

```tsx
<Show when={active()}>
  <Show
    when={viewRef() === null}
    fallback={
      <div data-agent-ref={viewRef()!}>
        <For each={(active()?.lines ?? []).filter((l) => l.agentRef === viewRef())}>{(l) => (
          <Show when={l.role !== "user"} fallback={<div class="pr-line pr-line-prompt">{l.text}</div>}>
            <For each={toolSegs(l.text)}>{(s) => s.tool
              ? <div class="pr-line pr-tool-line"><span class="pr-tool"><span class="pr-tool-n">{s.name}</span><Show when={s.arg}><span class="pr-tool-a">{s.arg}</span></Show></span></div>
              : <Show when={s.text.trim()}><div class="pr-line pr-line-asst">{s.text}</div></Show>}</For>
          </Show>
        )}</For>
      </div>
    }
  >
    <div data-agent-ref="master">
      <For each={masterFlow()}>{(item) => (
        <Show
          when={item.kind === "marker"}
          fallback={(() => {
            const l = (item as { line: TranscriptLine }).line;
            return (
              <Show when={l.role !== "user"} fallback={<div class="pr-line pr-line-prompt">{l.text}</div>}>
                <div class={answerLines().has(l) ? "pr-answer" : undefined}>
                  <For each={toolSegs(l.text)}>{(s) => s.tool
                    ? <div class="pr-line pr-tool-line"><span class="pr-tool"><span class="pr-tool-n">{s.name}</span><Show when={s.arg}><span class="pr-tool-a">{s.arg}</span></Show></span></div>
                    : <Show when={s.text.trim()}><div class={answerLines().has(l) ? "pr-line pr-answer-text" : "pr-line pr-line-asst"}>{s.text}</div></Show>}</For>
                </div>
              </Show>
            );
          })()}
        >
          <button class="pr-spawn-marker" type="button"
            onClick={() => setViewRef((item as { ref: string }).ref)}>
            ↳ spawned {agentName((item as { ref: string }).ref)}
          </button>
        </Show>
      )}</For>
    </div>
  </Show>
</Show>
```

Add the `masterFlow()` helper (a master line list with a marker inserted at each sub-agent's first appearance) near `blocks()` (`blocks()` itself is now unused for the master view and may be removed):

```ts
type FlowItem = { kind: "line"; line: TranscriptLine } | { kind: "marker"; ref: string };
const masterFlow = (): FlowItem[] => {
  const out: FlowItem[] = [];
  const seenSub = new Set<string>();
  for (const l of active()?.lines ?? []) {
    if (l.agentRef === "master") out.push({ kind: "line", line: l });
    else if (!seenSub.has(l.agentRef)) { seenSub.add(l.agentRef); out.push({ kind: "marker", ref: l.agentRef }); }
  }
  return out;
};
```

- [ ] **Step 7: Default cwd chip shows the resolved app dir**

Update the unlocked cwd chip (`:350-357`) so it shows the resolved app dir basename when no folder is picked:

```tsx
<button type="button" class="pr-cwd-chip" onClick={pickCwd} disabled={activeRunning()}
  title={cwd() ?? appDir() ?? "run in app's working directory"}>
  <span class="pr-cwd-label">{cwd() ? cwdLabel(cwd()) : appDir() ? cwdLabel(appDir()!) : "cwd: default"}</span>
  <Show when={cwd()}>
    <span class="pr-cwd-clear" role="button" aria-label="clear working directory"
      onClick={(e) => { e.stopPropagation(); if (!activeRunning()) setCwd(undefined); }}>×</span>
  </Show>
</button>
```

Also import `cwdLabel` (already imported) — confirm it's in the `../lib/runStore` import list.

- [ ] **Step 8: Typecheck and run the suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. Remove any now-unused symbols (`blocks`, the old `Block` type, `laneName` is still used by the timeline — keep it) flagged by `tsc`.

- [ ] **Step 9: Commit**

```bash
git add src/components/Console.tsx
git commit -m "feat(console): grouped rail, resume observed sessions, sub-agent rail view"
```

---

## Task 8: Styles for the grouped rail, sub-agent rows, and spawn markers

**Files:**
- Modify: `src/themes/tokens.css` (add `pr-session-group*`, `pr-session-sub*`, `pr-session-observed`, `pr-spawn-marker`, `pr-crumb-loc`)

- [ ] **Step 1: Add the new component styles**

Append to `src/themes/tokens.css`, using existing tokens (`--gull`, `--gull-2`, `--accent`, `--font-mono`, `--space-*`, `--t-*`). Match the surrounding `pr-session*` rules' style.

```css
.pr-session-group { margin-bottom: var(--space-2); }
.pr-session-group-head {
  display: flex; align-items: baseline; gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  font-family: var(--font-mono); font-size: var(--t-meta, 11px);
  text-transform: uppercase; letter-spacing: .05em; color: var(--gull-2);
}
.pr-session-group-repo { color: var(--gull-2); opacity: .7; }
.pr-session-sub {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 2px var(--space-2) 2px calc(var(--space-2) * 3);
  font-family: var(--font-mono); font-size: var(--t-meta, 11px);
  color: var(--gull); cursor: pointer; opacity: .8;
}
.pr-session-sub:hover { opacity: 1; }
.pr-session-sub.is-active { color: var(--bone); background: var(--panel-2); }
.pr-session-sub-arrow { color: var(--gull-2); }
.pr-session-sub-steps { margin-left: auto; color: var(--gull-2); }
.pr-session-observed {
  font-family: var(--font-mono); font-size: var(--t-meta, 11px);
  color: var(--gull-2); text-transform: uppercase; letter-spacing: .04em;
}
.pr-spawn-marker {
  display: block; width: 100%; text-align: left;
  background: none; border: none; cursor: pointer;
  font-family: var(--font-mono); font-size: var(--t-meta, 12px);
  color: var(--accent); padding: var(--space-1) 0; opacity: .85;
}
.pr-spawn-marker:hover { opacity: 1; text-decoration: underline; }
.pr-crumb-loc { cursor: pointer; }
.pr-crumb-loc:hover { color: var(--bone); }
```

- [ ] **Step 2: Verify the dev server renders without console errors**

Use the preview workflow: `preview_start`, then `preview_snapshot` of the Console view and `preview_console_logs` for errors. Confirm: rail shows directory group headers, sub-agent rows nest under sessions, and selecting a sub-agent swaps the stream with a breadcrumb.

- [ ] **Step 3: Commit**

```bash
git add src/themes/tokens.css
git commit -m "style: grouped rail, nested sub-agent rows, spawn markers"
```

- [ ] **Step 4: Update CLAUDE.md component vocabulary**

Per the project memory ([[feedback_claudemd_tokens_sync]]), add the new `pr-session-group*`, `pr-session-sub*`, `pr-session-observed`, `pr-spawn-marker`, and `pr-crumb-loc` classes to the component-vocabulary note in `CLAUDE.md` if it enumerates classes. Commit:

```bash
git add CLAUDE.md
git commit -m "docs: note new console rail classes"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full build + test + lint**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean typecheck, all unit suites pass, production build succeeds.

- [ ] **Step 2: Manual smoke (preview)**

Confirm in the running app:
1. A fresh session's cwd chip shows the app dir basename (not "cwd: default").
2. Sessions group by directory with the basename + repo sublabel.
3. Sub-agents appear nested under their session; clicking one swaps the stream + shows `title / agent` breadcrumb; clicking the breadcrumb location returns to master.
4. The master feed shows `↳ spawned <name>` markers, not inline sub-agent blocks.
5. Selecting an observed session and submitting continues it in place (it gains ■/× and loses the `observed` tag) rather than opening a blank session.

- [ ] **Step 3: Final commit if any fixups were needed**

```bash
git add -A && git commit -m "chore: console session model verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** Backend cwd + app_cwd (T1/T2), ownership refactor + resume + watch dedup (T5/T6), rail grouping + nested sub-agents (T4/T7), shared naming (T3/T7), master-only + markers + swap view (T7), cwd default (T7), styles (T8), tests (T3/T4/T5). All spec sections mapped.
- **Cross-task type consistency:** `RailEntry`/`RailGroup`/`RailSub` (T4) consumed in T7; `buildAgentNames` (T3) consumed in T7; `adoptSession(LiveSessionMeta)` (T5) consumed in T7; `setOwnershipProbe` (T6) consumed in T5; `cwd` on `LiveSessionMeta` (T2) consumed in T5/T7; `app_cwd`/`appCwd` (T1/T2) consumed in T7.
- **Ordering note:** T5 imports `setOwnershipProbe` from T6 and T6's tests rely on T5's adopt logic — dispatch T5 and T6 together (or T6 Step 1 before T5 Step 5). T7 depends on T2, T3, T4, T5. T1→T2.

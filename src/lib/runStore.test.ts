import { describe, test, expect, vi, beforeEach } from "vitest";

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
  isLocalSession,
  adoptSession,
  localSessions,
} from "./runStore";

const RUNCOMPLETE = { type: "runComplete", data: { exitCode: 0 } };

describe("cwdLabel", () => {
  test("returns the basename of a unix path", () => {
    expect(cwdLabel("/home/u/projects/praetorium")).toBe("praetorium");
  });
  test("ignores a trailing slash", () => {
    expect(cwdLabel("/home/u/projects/praetorium/")).toBe("praetorium");
  });
  test("handles Windows separators", () => {
    expect(cwdLabel("C:\\Users\\guill\\praetorium")).toBe("praetorium");
  });
  test("handles a trailing Windows separator", () => {
    expect(cwdLabel("C:\\Users\\guill\\praetorium\\")).toBe("praetorium");
  });
  test("falls back to 'local run' when undefined", () => {
    expect(cwdLabel(undefined)).toBe("local run");
  });
  test("falls back to 'local run' for an empty string", () => {
    expect(cwdLabel("")).toBe("local run");
  });
});

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

describe("isLocalSession (membership)", () => {
  test("true once a session is in the map, regardless of id shape", () => {
    adoptSession({ id: "claude-xyz", project: "p", title: "t", lastActivityMs: 0, state: "idle", cwd: "/p" });
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
    adoptSession({ id: "claude-r", project: "p", title: "t", lastActivityMs: 0, state: "idle", cwd: "/work/dir" });
    const s = localSessions().get("claude-r");
    expect(s?.claudeSessionId).toBe("claude-r");
    expect(s?.cwd).toBe("/work/dir");
  });

  test("a subsequent run resumes via the adopted claudeSessionId", async () => {
    adoptSession({ id: "claude-r2", project: "p", title: "t", lastActivityMs: 0, state: "idle", cwd: "/d" });
    await startRun("claude-r2", "go");
    expect(runClaude).toHaveBeenCalledWith(
      expect.any(String), "go", expect.any(Function),
      { cwd: "/d", model: undefined, resumeId: "claude-r2" },
    );
  });
});

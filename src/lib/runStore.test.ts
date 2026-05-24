import { describe, test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  autoComplete: true,
  lastOnEvent: null as ((e: unknown) => void) | null,
}));

vi.mock("./claude", () => ({
  runClaude: vi.fn((_prompt: string, onEvent: (e: unknown) => void) => {
    h.lastOnEvent = onEvent;
    // Optionally drive the run to completion so `isRunning` resets.
    if (h.autoComplete) onEvent({ type: "runComplete", data: { exitCode: 0 } });
    return Promise.resolve();
  }),
}));

import { runClaude } from "./claude";
import { cwdLabel, startRun, isRunning, newLocalSession } from "./runStore";

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

describe("startRun", () => {
  beforeEach(() => {
    vi.mocked(runClaude).mockClear();
    h.autoComplete = true;
  });

  test("forwards opts to runClaude", async () => {
    await startRun("local", "hello", { cwd: "/home/u/proj", model: "opus" });
    expect(runClaude).toHaveBeenCalledWith("hello", expect.any(Function), {
      cwd: "/home/u/proj",
      model: "opus",
    });
  });

  test("forwards no opts when omitted", async () => {
    await startRun("local", "hello");
    expect(runClaude).toHaveBeenCalledWith("hello", expect.any(Function), undefined);
  });

  test("ignores empty prompts", async () => {
    await startRun("local", "   ");
    expect(runClaude).not.toHaveBeenCalled();
  });
});

describe("concurrency", () => {
  beforeEach(() => {
    vi.mocked(runClaude).mockClear();
    h.autoComplete = false; // leave runs in-flight so we can observe running state
  });

  test("marks a session running and blocks a second run on the same session", async () => {
    await startRun("guard-a", "first");
    expect(isRunning("guard-a")).toBe(true);
    await startRun("guard-a", "second");
    expect(runClaude).toHaveBeenCalledTimes(1);
  });

  test("allows different sessions to run concurrently", async () => {
    await startRun("conc-a", "a");
    await startRun("conc-b", "b");
    expect(isRunning("conc-a")).toBe(true);
    expect(isRunning("conc-b")).toBe(true);
    expect(runClaude).toHaveBeenCalledTimes(2);
  });

  test("clears running state on completion", async () => {
    await startRun("done-a", "go");
    expect(isRunning("done-a")).toBe(true);
    h.lastOnEvent?.({ type: "runComplete", data: { exitCode: 0 } });
    expect(isRunning("done-a")).toBe(false);
  });
});

describe("newLocalSession", () => {
  test("allocates 'local' first, then suffixed ids", () => {
    expect(newLocalSession()).toBe("local");
    const second = newLocalSession();
    expect(second).not.toBe("local");
    expect(second).toMatch(/^local-\d+$/);
  });
});

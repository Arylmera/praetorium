import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("./claude", () => ({
  runClaude: vi.fn((_prompt: string, onEvent: (e: unknown) => void) => {
    // Drive the run to completion so `running()` resets between tests.
    onEvent({ type: "runComplete", data: { exitCode: 0 } });
    return Promise.resolve();
  }),
}));

import { runClaude } from "./claude";
import { cwdLabel, startRun, resetLocal } from "./runStore";

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
  });

  test("forwards opts to runClaude", async () => {
    await startRun("hello", { cwd: "/home/u/proj", model: "opus" });
    expect(runClaude).toHaveBeenCalledWith("hello", expect.any(Function), {
      cwd: "/home/u/proj",
      model: "opus",
    });
  });

  test("forwards no opts when omitted", async () => {
    await startRun("hello");
    expect(runClaude).toHaveBeenCalledWith("hello", expect.any(Function), undefined);
  });

  test("resumes the prior local session on a follow-up", async () => {
    // First run reports its session id via systemInit; the follow-up must carry it.
    vi.mocked(runClaude).mockImplementationOnce((_p, onEvent) => {
      onEvent({ type: "systemInit", data: { sessionId: "sess-abc" } });
      onEvent({ type: "runComplete", data: { exitCode: 0 } });
      return Promise.resolve();
    });
    await startRun("first");
    expect(runClaude).toHaveBeenLastCalledWith("first", expect.any(Function), undefined);

    await startRun("follow up");
    expect(runClaude).toHaveBeenLastCalledWith("follow up", expect.any(Function), { resume: "sess-abc" });
  });

  test("NEW clears the resume id so the next prompt starts fresh", async () => {
    vi.mocked(runClaude).mockImplementationOnce((_p, onEvent) => {
      onEvent({ type: "systemInit", data: { sessionId: "sess-xyz" } });
      onEvent({ type: "runComplete", data: { exitCode: 0 } });
      return Promise.resolve();
    });
    await startRun("first");
    resetLocal();
    await startRun("after reset");
    expect(runClaude).toHaveBeenLastCalledWith("after reset", expect.any(Function), undefined);
  });
});

import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("./claude", () => ({
  runClaude: vi.fn((_prompt: string, onEvent: (e: unknown) => void) => {
    // Drive the run to completion so `running()` resets between tests.
    onEvent({ type: "runComplete", data: { exitCode: 0 } });
    return Promise.resolve();
  }),
}));

import { runClaude } from "./claude";
import { cwdLabel, startRun } from "./runStore";

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
});

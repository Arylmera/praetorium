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

import { describe, it, expect } from "vitest";
import { HierarchicalLayout, RadialForceLayout } from "./layout";
import { reduceWatch, emptyGraph } from "./graph";
import type { WatchEvent } from "./types";

// Build a realistic constellation: project node + 2 session masters + a subagent + a shared folder.
const evs: WatchEvent[] = [
  { type: "session", data: { sessionId: "s1", project: "Terra", agentRef: "master", event: { kind: "turn", data: { role: "user", text: "hi" } } } },
  { type: "session", data: { sessionId: "s2", project: "Terra", agentRef: "master", event: { kind: "turn", data: { role: "user", text: "yo" } } } },
  { type: "session", data: { sessionId: "s1", project: "Terra", agentRef: "master", event: { kind: "subagentSpawn", data: { toolUseId: "a1", subagentType: "genetor" } } } },
  { type: "session", data: { sessionId: "s1", project: "Terra", agentRef: "a1", event: { kind: "toolActivity", data: { toolUseId: "r1", name: "Edit", filePath: "/repo/shared/x.md" } } } },
  { type: "session", data: { sessionId: "s2", project: "Terra", agentRef: "master", event: { kind: "toolActivity", data: { toolUseId: "r2", name: "Edit", filePath: "/repo/shared/y.md" } } } },
];
const g = evs.reduce(reduceWatch, emptyGraph());

describe("HierarchicalLayout on a multi-session constellation", () => {
  it("does not throw and positions every node", () => {
    let pos: ReturnType<typeof HierarchicalLayout.prototype.layout> = [];
    expect(() => { pos = new HierarchicalLayout().layout(g, 900, 640); }).not.toThrow();
    expect(pos.length).toBe(g.nodes.size);
    for (const p of pos) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
  });
  it("differs from the radial layout (so switching is visible)", () => {
    const hier = new Map(new HierarchicalLayout().layout(g, 900, 640).map((p) => [p.id, p]));
    const rad = new Map(new RadialForceLayout().layout(g, 900, 640).map((p) => [p.id, p]));
    let anyDiff = false;
    for (const [id, hp] of hier) { const rp = rad.get(id)!; if (Math.abs(hp.x - rp.x) > 1 || Math.abs(hp.y - rp.y) > 1) anyDiff = true; }
    expect(anyDiff).toBe(true);
  });
});

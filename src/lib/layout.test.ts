import { describe, it, expect } from "vitest";
import { RadialForceLayout, HierarchicalLayout } from "./layout";
import { reduce, emptyGraph } from "./graph";
import type { ClaudeEvent, GraphState, GraphNode, GraphEdge } from "./types";

// Hub-and-spoke: one root with N children (the shape that produced spoke crossings).
function hubAndSpoke(children: number): GraphState {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const mk = (id: string): GraphNode => ({ id, kind: "folder", label: id, status: "complete" });
  nodes.set("root", mk("root"));
  for (let i = 0; i < children; i++) {
    const id = `c${i}`;
    nodes.set(id, mk(id));
    edges.set(`root->${id}`, { id: `root->${id}`, source: "root", target: id });
  }
  return { nodes, edges, activity: [] };
}

const state = ([
  { type: "subagentSpawn", data: { toolUseId: "a1", subagentType: "g", parentToolUseId: null } },
  { type: "toolCall", data: { toolUseId: "t1", name: "Edit", filePath: "/repo/src/x.ts", parentToolUseId: "a1" } },
] as ClaudeEvent[]).reduce(reduce, emptyGraph());

describe("RadialForceLayout", () => {
  it("assigns a finite position to every node", () => {
    const pos = new RadialForceLayout().layout(state, 800, 600);
    expect(pos.length).toBe(state.nodes.size);
    for (const p of pos) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("returns one position per node id", () => {
    const pos = new RadialForceLayout().layout(state, 800, 600);
    const ids = new Set(pos.map((p) => p.id));
    expect(ids).toEqual(new Set(state.nodes.keys()));
  });

  it("bands nodes into depth rings: children sit farther from center than the root", () => {
    const W = 1200, H = 860, cx = W / 2, cy = H / 2;
    const pos = new RadialForceLayout().layout(hubAndSpoke(8), W, H);
    const r = (id: string) => {
      const p = pos.find((q) => q.id === id)!;
      return Math.hypot(p.x - cx, p.y - cy);
    };
    const rootR = r("root");
    const childRs = [...Array(8)].map((_, i) => r(`c${i}`));
    // Every child should sit outside the root's ring (root depth 0, children depth 1).
    for (const cr of childRs) expect(cr).toBeGreaterThan(rootR);
    // Children share a ring: their radii should be tightly clustered, not scattered.
    const mean = childRs.reduce((a, b) => a + b, 0) / childRs.length;
    for (const cr of childRs) expect(Math.abs(cr - mean) / mean).toBeLessThan(0.35);
  });
});

describe("HierarchicalLayout", () => {
  it("assigns finite positions for a rooted graph", () => {
    const pos = new HierarchicalLayout().layout(state, 800, 600);
    expect(pos.length).toBe(state.nodes.size);
    for (const p of pos) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
  });
});

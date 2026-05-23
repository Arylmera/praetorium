import { describe, it, expect } from "vitest";
import { RadialForceLayout, HierarchicalLayout } from "./layout";
import { reduce, emptyGraph } from "./graph";
import type { ClaudeEvent } from "./types";

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
});

describe("HierarchicalLayout", () => {
  it("assigns finite positions for a rooted graph", () => {
    const pos = new HierarchicalLayout().layout(state, 800, 600);
    expect(pos.length).toBe(state.nodes.size);
    for (const p of pos) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
  });
});

import { describe, it, expect } from "vitest";
import { reduce, emptyGraph, MASTER_ID } from "./graph";
import type { ClaudeEvent } from "./types";

const run = (events: ClaudeEvent[]) => events.reduce(reduce, emptyGraph());

describe("graph reducer", () => {
  it("creates the master node on first event", () => {
    const s = run([{ type: "systemInit", data: { sessionId: "s1" } }]);
    expect(s.nodes.get(MASTER_ID)?.kind).toBe("master");
  });

  it("adds a subagent node + edge from master", () => {
    const s = run([
      { type: "subagentSpawn", data: { toolUseId: "a1", subagentType: "genetor", parentToolUseId: null } },
    ]);
    expect(s.nodes.get("a1")).toMatchObject({ kind: "agent", label: "genetor", status: "running" });
    expect(s.edges.has(`${MASTER_ID}->a1`)).toBe(true);
  });

  it("creates a folder node from a file tool call, attributed to the owning agent", () => {
    const s = run([
      { type: "subagentSpawn", data: { toolUseId: "a1", subagentType: "g", parentToolUseId: null } },
      { type: "toolCall", data: { toolUseId: "t1", name: "Edit", filePath: "/repo/src/lib/x.ts", parentToolUseId: "a1" } },
    ]);
    expect(s.nodes.get("/repo/src/lib")?.kind).toBe("folder");
    expect(s.edges.has("a1->/repo/src/lib")).toBe(true);
    expect(s.activity.length).toBe(1);
  });

  it("attributes a master-level file call to master", () => {
    const s = run([
      { type: "toolCall", data: { toolUseId: "t1", name: "Read", filePath: "/repo/a/b.md", parentToolUseId: null } },
    ]);
    expect(s.edges.has(`${MASTER_ID}->/repo/a`)).toBe(true);
  });

  it("marks an agent complete on its tool_result", () => {
    const s = run([
      { type: "subagentSpawn", data: { toolUseId: "a1", subagentType: "g", parentToolUseId: null } },
      { type: "toolResult", data: { toolUseId: "a1", isError: false, parentToolUseId: null } },
    ]);
    expect(s.nodes.get("a1")?.status).toBe("complete");
  });

  it("marks an agent failed on an error result", () => {
    const s = run([
      { type: "subagentSpawn", data: { toolUseId: "a1", subagentType: "g", parentToolUseId: null } },
      { type: "toolResult", data: { toolUseId: "a1", isError: true, parentToolUseId: null } },
    ]);
    expect(s.nodes.get("a1")?.status).toBe("failed");
  });

  it("tolerates a tool call whose parent agent is unknown (falls back to master)", () => {
    const s = run([
      { type: "toolCall", data: { toolUseId: "t1", name: "Read", filePath: "/x/y.md", parentToolUseId: "ghost" } },
    ]);
    expect(s.edges.has(`${MASTER_ID}->/x`)).toBe(true);
  });

  it("does not mutate the previous state", () => {
    const a = emptyGraph();
    const b = reduce(a, { type: "subagentSpawn", data: { toolUseId: "a1", subagentType: "g", parentToolUseId: null } });
    expect(a.nodes.size).toBe(0);
    expect(b.nodes.size).toBeGreaterThan(0);
  });
});

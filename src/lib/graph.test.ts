import { describe, it, expect } from "vitest";
import { reduce, reduceWatch, emptyGraph, MASTER_ID } from "./graph";
import type { ClaudeEvent, WatchEvent, SessionEvent } from "./types";

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

describe("reduceWatch toolDone → failed nodes", () => {
  const SID = "sess1";
  const ev = (agentRef: string, event: SessionEvent): WatchEvent =>
    ({ type: "session", data: { sessionId: SID, project: "proj", agentRef, event } });
  const master = `${SID}:master`;

  it("marks the session master node failed on an errored master-level call", () => {
    let g = reduceWatch(emptyGraph(), ev("master", { kind: "toolActivity", data: { toolUseId: "t1", name: "Bash", filePath: "/r/a.txt" } }));
    expect(g.nodes.get(master)!.status).toBe("running");
    g = reduceWatch(g, ev("master", { kind: "toolDone", data: { toolUseId: "t1", isError: true } }));
    expect(g.nodes.get(master)!.status).toBe("failed");
  });

  it("does not mark the owner failed on a successful call", () => {
    let g = reduceWatch(emptyGraph(), ev("master", { kind: "toolActivity", data: { toolUseId: "t1", name: "Read", filePath: "/r/a.txt" } }));
    g = reduceWatch(g, ev("master", { kind: "toolDone", data: { toolUseId: "t1", isError: false } }));
    expect(g.nodes.get(master)!.status).toBe("running");
  });

  it("marks an errored subagent-level call's owning subagent node failed, not master", () => {
    let g = reduceWatch(emptyGraph(), ev("genetor", { kind: "toolActivity", data: { toolUseId: "t9", name: "Edit", filePath: "/r/x.ts" } }));
    const subId = `${SID}:genetor`;
    expect(g.nodes.get(subId)!.status).toBe("running");
    g = reduceWatch(g, ev("genetor", { kind: "toolDone", data: { toolUseId: "t9", isError: true } }));
    expect(g.nodes.get(subId)!.status).toBe("failed");
    expect(g.nodes.get(master)!.status).toBe("running");
  });

  it("marks a spawned agent node complete when its spawn-id toolDone arrives", () => {
    let g = reduceWatch(emptyGraph(), ev("master", { kind: "subagentSpawn", data: { toolUseId: "a1", subagentType: "genetor" } }));
    const agentId = `${SID}:a1`;
    expect(g.nodes.get(agentId)!.status).toBe("running");
    g = reduceWatch(g, ev("master", { kind: "toolDone", data: { toolUseId: "a1", isError: false } }));
    expect(g.nodes.get(agentId)!.status).toBe("complete");
  });
});

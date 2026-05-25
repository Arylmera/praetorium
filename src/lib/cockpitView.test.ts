import { describe, it, expect } from "vitest";
import {
  toolCategory,
  buildNodeLive,
  buildAggregates,
  buildDetail,
  collapseFinishedAgents,
  IDLE_MS,
} from "./cockpitView";
import type { GraphState, GraphNode, GraphEdge, ActivityPing } from "./types";
import type { InsightsState, ToolCall } from "./insightsStore";
import type { LiveSessionMeta } from "./types";

// ---- builders -------------------------------------------------------------
const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, kind: "agent", label: id, status: "running", ...over,
});
const edge = (source: string, target: string): GraphEdge => ({ id: `${source}->${target}`, source, target });
const graphOf = (nodes: GraphNode[], edges: GraphEdge[] = [], activity: ActivityPing[] = []): GraphState => ({
  nodes: new Map(nodes.map((n) => [n.id, n])),
  edges: new Map(edges.map((e) => [e.id, e])),
  activity,
});
const call = (over: Partial<ToolCall> = {}): ToolCall => ({
  id: "t1", name: "Read", filePath: "/a/b.ts", agentRef: "master", startMs: 0, status: "ok", ...over,
});
const insightsOf = (rec: Record<string, ToolCall[]>): InsightsState => new Map(Object.entries(rec));
const meta = (id: string, over: Partial<LiveSessionMeta> = {}): LiveSessionMeta => ({
  id, project: "praetorium", title: "Title", lastActivityMs: 0, state: "active", ...over,
});

// ---- toolCategory ---------------------------------------------------------
describe("toolCategory", () => {
  it("maps known tools to categories", () => {
    expect(toolCategory("Read")).toBe("read");
    expect(toolCategory("NotebookRead")).toBe("read");
    expect(toolCategory("Edit")).toBe("edit");
    expect(toolCategory("Write")).toBe("edit");
    expect(toolCategory("Bash")).toBe("bash");
    expect(toolCategory("WebFetch")).toBe("web");
    expect(toolCategory("WebSearch")).toBe("web");
    expect(toolCategory("Grep")).toBe("search");
    expect(toolCategory("Glob")).toBe("search");
  });
  it("falls back to other for unknown tools", () => {
    expect(toolCategory("TaskCreate")).toBe("other");
    expect(toolCategory("")).toBe("other");
  });
});

// ---- buildNodeLive --------------------------------------------------------
describe("buildNodeLive", () => {
  it("attributes calls to master and subagent node ids", () => {
    const insights = insightsOf({
      s1: [
        call({ id: "a", agentRef: "master", name: "Read", startMs: 100, endMs: 150, status: "ok" }),
        call({ id: "b", agentRef: "sub7", name: "Edit", startMs: 200, endMs: 260, status: "error" }),
        call({ id: "c", agentRef: "sub7", name: "Bash", startMs: 300, status: "running" }),
      ],
    });
    const live = buildNodeLive(insights, 1000);
    expect(live.get("s1:master")?.callCount).toBe(1);
    expect(live.get("s1:master")?.lastTool).toBe("read");
    const sub = live.get("s1:sub7")!;
    expect(sub.callCount).toBe(2);
    expect(sub.failCount).toBe(1);
    expect(sub.lastTool).toBe("bash"); // most recent by startMs
  });

  it("computes lastActivityMs/idleMs from latest call edge", () => {
    const insights = insightsOf({ s1: [call({ startMs: 100, endMs: 400 })] });
    const live = buildNodeLive(insights, 1400);
    expect(live.get("s1:master")?.lastActivityMs).toBe(400);
    expect(live.get("s1:master")?.idleMs).toBe(1000);
  });

  it("recentRate reflects calls within the last 10s, clamped to 0..1", () => {
    const now = 100_000;
    const calls: ToolCall[] = [];
    for (let i = 0; i < 10; i++) calls.push(call({ id: `r${i}`, startMs: now - 1000 - i * 100 }));
    const live = buildNodeLive(insightsOf({ s1: calls }), now);
    expect(live.get("s1:master")?.recentRate).toBe(1);

    const few = insightsOf({ s2: [call({ agentRef: "master", startMs: now - 500 })] });
    const live2 = buildNodeLive(few, now);
    const r = live2.get("s2:master")!.recentRate;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

// ---- buildAggregates ------------------------------------------------------
describe("buildAggregates", () => {
  it("counts kinds, fails, idle and buckets callsPerSec", () => {
    const g = graphOf([
      node("s1:master", { kind: "master", session: "s1", status: "running" }),
      node("s1:sub", { kind: "agent", session: "s1", status: "failed" }),
      node("s2:master", { kind: "master", session: "s2", status: "running" }),
      node("/a", { kind: "folder" }),
      node("/b", { kind: "folder" }),
      node("proj:praetorium", { kind: "project" }),
    ]);
    const now = 60_000;
    const insights = insightsOf({
      s1: [call({ agentRef: "master", startMs: now - 500 })], // s1 master active → not idle
      // s2 has no calls → idle
    });
    const live = buildNodeLive(insights, now);
    const agg = buildAggregates(g, live, insights, now);
    expect(agg.agents).toBe(1);
    expect(agg.sessions).toBe(2);
    expect(agg.folders).toBe(2);
    expect(agg.fails).toBe(1); // the failed agent node
    expect(agg.idle).toBe(1);  // s2:master never active
    expect(agg.callsPerSec).toHaveLength(60);
    expect(agg.callsPerSec[59]).toBe(1); // one call in the last second bucket
  });
});

// ---- buildDetail ----------------------------------------------------------
describe("buildDetail", () => {
  const g = graphOf(
    [
      node("s1:master", { kind: "master", session: "s1", label: "praetorium", status: "running" }),
      node("s1:sub", { kind: "agent", session: "s1", label: "Explore", status: "complete" }),
      node("/a", { kind: "folder", label: "/a" }),
      node("/b", { kind: "folder", label: "/b" }),
    ],
    [edge("s1:master", "s1:sub"), edge("s1:master", "/a"), edge("s1:sub", "/b")],
  );
  const insights = insightsOf({
    s1: [
      call({ id: "a", agentRef: "master", name: "Read", filePath: "/a/x.ts", startMs: 100, endMs: 150, status: "ok" }),
      call({ id: "b", agentRef: "sub", name: "Bash", filePath: null, startMs: 200, endMs: 800, status: "error" }),
    ],
  });
  const metas = new Map([["s1", meta("s1", { state: "active", title: "Refactor auth" })]]);

  it("assembles session detail for a master node", () => {
    const d = buildDetail(g, "s1:master", insights, metas, 2000)!;
    expect(d.state).toBe("active");
    expect(d.calls).toBe(2);
    expect(d.fails).toBe(1);
    expect(d.subagents).toEqual([{ label: "Explore", status: "complete" }]);
    expect(d.folders.sort()).toEqual(["/a", "/b"]); // union across master + subagent
    expect(d.recentCalls[d.recentCalls.length - 1]).toMatchObject({ tool: "bash", status: "error", durMs: 600 });
  });

  it("scopes recent calls to the agent for an agent node", () => {
    const d = buildDetail(g, "s1:sub", insights, metas, 2000)!;
    expect(d.calls).toBe(1);
    expect(d.recentCalls).toHaveLength(1);
    expect(d.recentCalls[0]).toMatchObject({ tool: "bash", status: "error" });
  });

  it("returns null for a missing node", () => {
    expect(buildDetail(g, "nope", insights, metas, 2000)).toBeNull();
  });
});

describe("collapseFinishedAgents", () => {
  it("folds finished subagents into a done count on the master and redirects their folders", () => {
    const g = graphOf(
      [
        node("s1:master", { kind: "master", session: "s1", status: "running" }),
        node("s1:run", { kind: "agent", session: "s1", status: "running" }),
        node("s1:ok", { kind: "agent", session: "s1", status: "complete" }),
        node("s1:bad", { kind: "agent", session: "s1", status: "failed" }),
        node("/a", { kind: "folder" }),
        node("/b", { kind: "folder" }),
      ],
      [
        edge("s1:master", "s1:run"),
        edge("s1:master", "s1:ok"),
        edge("s1:master", "s1:bad"),
        edge("s1:ok", "/a"),   // finished agent's folder → should redirect to master
        edge("s1:run", "/b"),  // running agent's folder → untouched
      ],
    );
    const out = collapseFinishedAgents(g);
    // finished agents removed, running one kept
    expect(out.nodes.has("s1:ok")).toBe(false);
    expect(out.nodes.has("s1:bad")).toBe(false);
    expect(out.nodes.has("s1:run")).toBe(true);
    // master annotated
    const m = out.nodes.get("s1:master")!;
    expect(m.done).toBe(2);
    expect(m.doneFailed).toBe(1);
    // finished subagents' identities preserved for the detail panel
    expect(m.doneAgents).toEqual([
      { label: "s1:ok", status: "complete" },
      { label: "s1:bad", status: "failed" },
    ]);
    // folder of the finished agent now hangs off the master
    expect(out.edges.has("s1:master->/a")).toBe(true);
    expect(out.nodes.has("/a")).toBe(true);
  });

  it("is a no-op when there are no finished subagents", () => {
    const g = graphOf(
      [node("s1:master", { kind: "master", session: "s1", status: "running" }),
       node("s1:run", { kind: "agent", session: "s1", status: "running" })],
      [edge("s1:master", "s1:run")],
    );
    expect(collapseFinishedAgents(g)).toBe(g);
  });
});

describe("IDLE_MS", () => {
  it("is a positive threshold", () => expect(IDLE_MS).toBeGreaterThan(0));
});

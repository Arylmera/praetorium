import { describe, test, expect } from "vitest";
import { emptyInsights, reduceInsights, failures, MAX_CALLS_PER_SESSION } from "./insightsStore";
import type { WatchEvent, SessionEvent } from "./types";

const SID = "s1";

function ev(agentRef: string, event: SessionEvent, sessionId = SID): WatchEvent {
  return { type: "session", data: { sessionId, project: "p", agentRef, event } };
}
const activity = (id: string, name = "Read", filePath: string | null = null) =>
  ({ kind: "toolActivity", data: { toolUseId: id, name, filePath } }) as SessionEvent;
const done = (id: string, isError = false) =>
  ({ kind: "toolDone", data: { toolUseId: id, isError } }) as SessionEvent;

describe("reduceInsights", () => {
  test("toolActivity opens a running call stamped with arrival time", () => {
    const s = reduceInsights(emptyInsights(), ev("master", activity("t1", "Bash", "/a/b")), 1000);
    const calls = s.get(SID)!;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: "t1", name: "Bash", filePath: "/a/b", agentRef: "master", startMs: 1000, status: "running",
    });
    expect(calls[0].endMs).toBeUndefined();
  });

  test("toolDone pairs by toolUseId, sets endMs and duration, status ok", () => {
    let s = reduceInsights(emptyInsights(), ev("master", activity("t1")), 1000);
    s = reduceInsights(s, ev("master", done("t1", false)), 1300);
    const c = s.get(SID)![0];
    expect(c.status).toBe("ok");
    expect(c.endMs).toBe(1300);
    expect(c.endMs! - c.startMs).toBe(300);
  });

  test("toolDone with isError marks the call error", () => {
    let s = reduceInsights(emptyInsights(), ev("sub-a", activity("t1")), 1000);
    s = reduceInsights(s, ev("sub-a", done("t1", true)), 1100);
    expect(s.get(SID)![0].status).toBe("error");
  });

  test("out-of-order: toolDone before its toolActivity is ignored (orphan)", () => {
    const s = reduceInsights(emptyInsights(), ev("master", done("ghost", true)), 1000);
    expect(s.get(SID) ?? []).toHaveLength(0);
  });

  test("missing toolDone: call stays running indefinitely", () => {
    const s = reduceInsights(emptyInsights(), ev("master", activity("t1")), 1000);
    expect(s.get(SID)![0].status).toBe("running");
    expect(s.get(SID)![0].endMs).toBeUndefined();
  });

  test("duplicate toolDone: last one wins", () => {
    let s = reduceInsights(emptyInsights(), ev("master", activity("t1")), 1000);
    s = reduceInsights(s, ev("master", done("t1", false)), 1100);
    s = reduceInsights(s, ev("master", done("t1", true)), 1200);
    const c = s.get(SID)![0];
    expect(c.status).toBe("error");
    expect(c.endMs).toBe(1200);
  });

  test("per-session cap bounds retained calls", () => {
    let s = emptyInsights();
    for (let i = 0; i < MAX_CALLS_PER_SESSION + 50; i++) {
      s = reduceInsights(s, ev("master", activity(`t${i}`)), 1000 + i);
    }
    expect(s.get(SID)!).toHaveLength(MAX_CALLS_PER_SESSION);
    // oldest dropped, newest kept
    expect(s.get(SID)![s.get(SID)!.length - 1].id).toBe(`t${MAX_CALLS_PER_SESSION + 49}`);
  });

  test("master vs subagent attribution preserved", () => {
    let s = reduceInsights(emptyInsights(), ev("master", activity("m1")), 1000);
    s = reduceInsights(s, ev("genetor", activity("g1")), 1010);
    const refs = s.get(SID)!.map((c) => c.agentRef);
    expect(refs).toEqual(["master", "genetor"]);
  });

  test("calls are isolated per session", () => {
    let s = reduceInsights(emptyInsights(), ev("master", activity("a"), "s1"), 1000);
    s = reduceInsights(s, ev("master", activity("b"), "s2"), 1010);
    expect(s.get("s1")!).toHaveLength(1);
    expect(s.get("s2")!).toHaveLength(1);
  });

  test("non tool events (turn/subagentSpawn) do not create calls", () => {
    let s = reduceInsights(emptyInsights(), ev("master", { kind: "turn", data: { role: "user", text: "hi" } }), 1000);
    s = reduceInsights(s, ev("master", { kind: "subagentSpawn", data: { toolUseId: "x", subagentType: "genetor" } }), 1010);
    expect(s.get(SID) ?? []).toHaveLength(0);
  });
});

describe("failures selector", () => {
  test("counts error calls for a session", () => {
    let s = reduceInsights(emptyInsights(), ev("master", activity("t1")), 1000);
    s = reduceInsights(s, ev("master", done("t1", true)), 1100);
    s = reduceInsights(s, ev("master", activity("t2")), 1200);
    s = reduceInsights(s, ev("master", done("t2", false)), 1300);
    s = reduceInsights(s, ev("master", activity("t3")), 1400);
    s = reduceInsights(s, ev("master", done("t3", true)), 1500);
    expect(failures(s, SID)).toBe(2);
  });

  test("includes a run error", () => {
    let s = reduceInsights(emptyInsights(), ev("master", activity("t1")), 1000);
    s = reduceInsights(s, ev("master", done("t1", true)), 1100);
    expect(failures(s, SID, { runError: true })).toBe(2);
  });

  test("isolates per session", () => {
    let s = reduceInsights(emptyInsights(), ev("master", activity("t1"), "s1"), 1000);
    s = reduceInsights(s, ev("master", done("t1", true), "s1"), 1100);
    s = reduceInsights(s, ev("master", activity("t2"), "s2"), 1200);
    s = reduceInsights(s, ev("master", done("t2", false), "s2"), 1300);
    expect(failures(s, "s1")).toBe(1);
    expect(failures(s, "s2")).toBe(0);
  });

  test("zero when session unknown", () => {
    expect(failures(emptyInsights(), "nope")).toBe(0);
  });
});

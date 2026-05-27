import { describe, it, expect } from "vitest";
import {
  toolSegs, masterFlow, answerLines, lanes, timeSpan, orderedAgentRefs, subagentSteps,
} from "./consoleView";
import type { TranscriptLine } from "./sessionStore";
import type { ToolCall } from "./insightsStore";

const line = (over: Partial<TranscriptLine> = {}): TranscriptLine => ({
  agentRef: "master", role: "assistant", text: "", ...over,
});
const call = (over: Partial<ToolCall> = {}): ToolCall => ({
  id: "t", name: "Read", filePath: null, agentRef: "master", startMs: 0, status: "ok", ...over,
});

describe("toolSegs", () => {
  it("splits tool placeholders from prose", () => {
    const segs = toolSegs("thinking\n[Read src/a.ts]\n[Bash]");
    expect(segs[0]).toEqual({ tool: false, text: "thinking" });
    expect(segs[1]).toEqual({ tool: true, name: "Read", arg: "src/a.ts" });
    expect(segs[2]).toEqual({ tool: true, name: "Bash", arg: "" });
  });
});

describe("masterFlow", () => {
  it("keeps master lines and emits one marker per first subagent appearance", () => {
    const lines = [
      line({ text: "a" }),
      line({ agentRef: "sub1", text: "x" }),
      line({ agentRef: "sub1", text: "y" }), // second sub1 line → no extra marker
      line({ text: "b" }),
      line({ agentRef: "sub2", text: "z" }),
    ];
    const flow = masterFlow(lines);
    expect(flow.map((f) => f.kind)).toEqual(["line", "marker", "line", "marker"]);
    expect(flow.filter((f) => f.kind === "marker").map((f) => (f as { ref: string }).ref)).toEqual(["sub1", "sub2"]);
  });
});

describe("answerLines", () => {
  it("marks the last assistant line before each user turn", () => {
    const a1 = line({ text: "narration" });
    const a2 = line({ text: "answer 1" });
    const u = line({ role: "user", text: "q2" });
    const a3 = line({ text: "answer 2" });
    const set = answerLines([line({ role: "user", text: "q1" }), a1, a2, u, a3], false);
    expect(set.has(a2)).toBe(true);   // last before the user turn
    expect(set.has(a1)).toBe(false);  // narration stays muted
    expect(set.has(a3)).toBe(true);   // trailing answer, run finished
  });
  it("does not mark the trailing answer while still running", () => {
    const a = line({ text: "partial" });
    expect(answerLines([line({ role: "user" }), a], true).has(a)).toBe(false);
  });
});

describe("lanes", () => {
  it("orders master first, then subagents in first-seen order", () => {
    const calls = [call({ agentRef: "sub2" }), call({ agentRef: "master" }), call({ agentRef: "sub1" }), call({ agentRef: "sub2" })];
    expect(lanes(calls)).toEqual(["master", "sub2", "sub1"]);
  });
});

describe("timeSpan", () => {
  it("returns a 1s default window when there are no calls", () => {
    expect(timeSpan([], 1000)).toEqual({ t0: 0, ms: 1000 });
  });
  it("spans first start to last end, clamped to a 1s minimum", () => {
    expect(timeSpan([call({ startMs: 100, endMs: 5100 })], 9999)).toEqual({ t0: 100, ms: 5000 });
    expect(timeSpan([call({ startMs: 100, endMs: 200 })], 9999)).toEqual({ t0: 100, ms: 1000 });
  });
  it("uses now for an open-ended running call", () => {
    expect(timeSpan([call({ startMs: 0, endMs: undefined, status: "running" })], 3000)).toEqual({ t0: 0, ms: 3000 });
  });
});

describe("orderedAgentRefs", () => {
  it("collects non-master refs first from lines then from calls", () => {
    const lines = [line({ agentRef: "sub1" }), line({ agentRef: "master" })];
    const calls = [call({ agentRef: "sub1" }), call({ agentRef: "sub2" })];
    expect(orderedAgentRefs(lines, calls)).toEqual(["sub1", "sub2"]);
  });
});

describe("subagentSteps", () => {
  it("tallies steps per subagent ref, ignoring master", () => {
    const lines = [line({ agentRef: "master" }), line({ agentRef: "sub1" }), line({ agentRef: "sub1" }), line({ agentRef: "sub2" })];
    const { refs, steps } = subagentSteps(lines);
    expect(refs).toEqual(["sub1", "sub2"]);
    expect(steps.get("sub1")).toBe(2);
    expect(steps.get("sub2")).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { reduce, emptyGraph, MASTER_ID } from "./graph";
import type { ClaudeEvent } from "./types";

// End-to-end: the exact ClaudeEvent sequence the Rust parser emits for a real
// subagent run (mirrors src-tauri/tests/fixtures/subagent-run.jsonl after serde
// serialization) folded through the reducer. Proves the full non-visual pipeline:
// parser wire-shape -> reducer -> final graph the Cockpit renders.
const transcript: ClaudeEvent[] = [
  { type: "systemInit", data: { sessionId: "s1" } },
  { type: "assistantText", data: { text: "Spawning a subagent.", parentToolUseId: null } },
  { type: "subagentSpawn", data: { toolUseId: "toolu_agent1", subagentType: "genetor", parentToolUseId: null } },
  { type: "toolCall", data: { toolUseId: "toolu_read1", name: "Read", filePath: "/repo/Hera/Technical/Network/Map.md", parentToolUseId: "toolu_agent1" } },
  { type: "toolResult", data: { toolUseId: "toolu_read1", isError: false, parentToolUseId: "toolu_agent1" } },
  { type: "toolCall", data: { toolUseId: "toolu_edit1", name: "Edit", filePath: "/repo/Hera/Technical/Network/Map.md", parentToolUseId: "toolu_agent1" } },
  { type: "toolResult", data: { toolUseId: "toolu_agent1", isError: false, parentToolUseId: null } },
  { type: "result", data: { isError: false, result: "finished" } },
];

describe("end-to-end subagent run -> graph", () => {
  const g = transcript.reduce(reduce, emptyGraph());
  const FOLDER = "/repo/Hera/Technical/Network";

  it("produces master + one subagent + one folder node", () => {
    expect(g.nodes.size).toBe(3);
    expect(g.nodes.get(MASTER_ID)?.kind).toBe("master");
    expect(g.nodes.get("toolu_agent1")).toMatchObject({ kind: "agent", label: "genetor" });
    expect(g.nodes.get(FOLDER)?.kind).toBe("folder");
  });

  it("wires master->subagent and subagent->folder edges", () => {
    expect(g.edges.has(`${MASTER_ID}->toolu_agent1`)).toBe(true);
    expect(g.edges.has(`toolu_agent1->${FOLDER}`)).toBe(true);
    expect(g.edges.size).toBe(2); // no duplicate folder edge despite two file ops
  });

  it("marks the subagent complete and the master complete", () => {
    expect(g.nodes.get("toolu_agent1")?.status).toBe("complete");
    expect(g.nodes.get(MASTER_ID)?.status).toBe("complete");
  });

  it("records one activity ping per file touch (read + edit)", () => {
    expect(g.activity.length).toBe(2);
    expect(g.activity.every((a) => a.folderId === FOLDER)).toBe(true);
  });
});

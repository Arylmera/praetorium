import { describe, it, expect } from "vitest";
import { reduceWatch, emptyGraph } from "./graph";
import type { WatchEvent } from "./types";

const fileAct = (sid: string, agentRef: string, fp: string): WatchEvent => ({
  type: "session", data: { sessionId: sid, project: "p", agentRef, event: { kind: "toolActivity", data: { toolUseId: "t" + Math.random(), name: "Edit", filePath: fp } } },
});

describe("reduceWatch constellation", () => {
  it("namespaces masters per session", () => {
    const g = ([
      { type: "session", data: { sessionId: "s1", project: "Terra", agentRef: "master", event: { kind: "turn", data: { role: "user", text: "hi" } } } },
      { type: "session", data: { sessionId: "s2", project: "praet", agentRef: "master", event: { kind: "turn", data: { role: "user", text: "yo" } } } },
    ] as WatchEvent[]).reduce(reduceWatch, emptyGraph());
    expect(g.nodes.has("s1:master")).toBe(true);
    expect(g.nodes.has("s2:master")).toBe(true);
  });
  it("shares a global folder node across two sessions", () => {
    const g = [fileAct("s1", "master", "/repo/shared/x.md"), fileAct("s2", "master", "/repo/shared/y.md")].reduce(reduceWatch, emptyGraph());
    expect(g.nodes.get("/repo/shared")?.kind).toBe("folder");
    expect(g.edges.has("s1:master->/repo/shared")).toBe(true);
    expect(g.edges.has("s2:master->/repo/shared")).toBe(true);
    expect([...g.nodes.values()].filter((n) => n.kind === "folder").length).toBe(1);
  });
  it("groups same-project sessions under one project node", () => {
    const mk = (sid: string, project: string): WatchEvent => ({ type: "session", data: { sessionId: sid, project, agentRef: "master", event: { kind: "turn", data: { role: "user", text: "hi" } } } });
    const g = [mk("s1", "Terra"), mk("s2", "Terra"), mk("s3", "Other")].reduce(reduceWatch, emptyGraph());
    expect(g.nodes.get("proj:Terra")?.kind).toBe("project");
    expect(g.edges.has("proj:Terra->s1:master")).toBe(true);
    expect(g.edges.has("proj:Terra->s2:master")).toBe(true);
    expect([...g.nodes.values()].filter((n) => n.kind === "project").length).toBe(2); // Terra + Other
  });
});

import { describe, it, expect } from "vitest";
import { buildCommands, filterCommands, type Command } from "./commands";
import type { LiveSessionMeta } from "./types";

const meta = (id: string, over: Partial<LiveSessionMeta> = {}): LiveSessionMeta => ({
  id,
  project: "proj",
  title: "Title",
  lastActivityMs: 0,
  state: "active",
  ...over,
});

describe("filterCommands", () => {
  const list: Command[] = [
    { id: "nav:console", title: "Console", group: "Navigate", run: () => {} },
    { id: "nav:settings", title: "Settings", group: "Navigate", run: () => {} },
    { id: "session:s1", title: "alpha", group: "Session", hint: "praetorium", run: () => {} },
  ];

  it("returns all commands on an empty or whitespace query", () => {
    expect(filterCommands(list, "")).toHaveLength(3);
    expect(filterCommands(list, "   ")).toHaveLength(3);
  });

  it("matches a substring of the title", () => {
    expect(filterCommands(list, "sole").map((c) => c.id)).toEqual(["nav:console"]);
  });

  it("is case-insensitive", () => {
    expect(filterCommands(list, "CONSOLE").map((c) => c.id)).toEqual(["nav:console"]);
  });

  it("matches on the hint", () => {
    expect(filterCommands(list, "praet").map((c) => c.id)).toEqual(["session:s1"]);
  });

  it("preserves group order", () => {
    expect(filterCommands(list, "").map((c) => c.group)).toEqual([
      "Navigate",
      "Navigate",
      "Session",
    ]);
  });
});

describe("buildCommands", () => {
  const noSessions = () => new Map<string, { project?: string }>();
  const noMetas = () => new Map<string, LiveSessionMeta>();

  it("always includes the four navigate commands in order", () => {
    const cmds = buildCommands({ sessions: noSessions, metas: noMetas, themedCopy: () => undefined });
    expect(cmds.filter((c) => c.group === "Navigate").map((c) => c.title)).toEqual([
      "console",
      "cockpit",
      "explorer",
      "settings",
    ]);
  });

  it("honors themed nav labels when present", () => {
    const cmds = buildCommands({
      sessions: noSessions,
      metas: noMetas,
      themedCopy: () => ({
        nav: { console: "COMMS", cockpit: "HELM", explorer: "CHARTS", settings: "CONFIG" },
      }),
    });
    expect(cmds.filter((c) => c.group === "Navigate").map((c) => c.title)).toEqual([
      "COMMS",
      "HELM",
      "CHARTS",
      "CONFIG",
    ]);
  });

  it("emits one Session command per live session", () => {
    const sessions = () =>
      new Map<string, { project?: string }>([
        ["s1", { project: "p1" }],
        ["s2", { project: "p2" }],
      ]);
    const metas = () => new Map<string, LiveSessionMeta>([["s1", meta("s1", { title: "First", project: "p1" })]]);
    const sess = buildCommands({ sessions, metas, themedCopy: () => undefined }).filter(
      (c) => c.group === "Session",
    );
    expect(sess).toHaveLength(2);
    expect(sess[0].title).toBe("First");
    expect(sess[1].title).toBe("p2"); // no meta → falls back to project
    expect(sess[1].hint).toBe("p2");
  });

  it("session command activates the session then switches to console", () => {
    let active = "";
    let viewed = "";
    const sessions = () => new Map<string, { project?: string }>([["sid", { project: "p" }]]);
    const cmd = buildCommands({
      sessions,
      metas: noMetas,
      themedCopy: () => undefined,
      setActiveId: (id) => { active = id; },
      setView: (v) => { viewed = v; },
    }).find((c) => c.group === "Session")!;
    cmd.run();
    expect(active).toBe("sid");
    expect(viewed).toBe("console");
  });
});

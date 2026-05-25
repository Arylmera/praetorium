import { describe, it, expect } from "vitest";
import { linksToGraph } from "./linksGraph";
import type { NoteLinks } from "./types";

describe("linksToGraph", () => {
  it("creates a node per note and an edge per resolved link", () => {
    const notes: NoteLinks[] = [{ rel: "a/x.md", links: ["a/y.md"], unresolved: 0 }];
    const g = linksToGraph(notes);
    expect(g.nodes.has("a/x.md")).toBe(true);
    expect(g.nodes.has("a/y.md")).toBe(true);
    expect([...g.edges.keys()]).toEqual(["a/x.md->a/y.md"]);
  });

  it("tags each node with its top-level folder via the session field", () => {
    const g = linksToGraph([{ rel: "notes/deep/x.md", links: [], unresolved: 0 }]);
    expect(g.nodes.get("notes/deep/x.md")!.session).toBe("notes");
  });

  it("labels root-level notes with folder 'root'", () => {
    const g = linksToGraph([{ rel: "x.md", links: [], unresolved: 0 }]);
    expect(g.nodes.get("x.md")!.session).toBe("root");
  });

  it("weights nodes by degree (in + out)", () => {
    const notes: NoteLinks[] = [
      { rel: "a.md", links: ["hub.md"], unresolved: 0 },
      { rel: "b.md", links: ["hub.md"], unresolved: 0 },
    ];
    const g = linksToGraph(notes);
    expect(g.nodes.get("hub.md")!.weight).toBe(2);
    expect(g.nodes.get("a.md")!.weight).toBe(1);
  });

  it("uses the stem (no folders, no .md) as the label", () => {
    const g = linksToGraph([{ rel: "a/b/Note.md", links: [], unresolved: 0 }]);
    expect(g.nodes.get("a/b/Note.md")!.label).toBe("Note");
  });
});

import { describe, it, expect } from "vitest";
import { buildLinkMaps } from "./vaultLinks";
import type { NoteLinks } from "./types";

describe("buildLinkMaps", () => {
  it("builds a forward map of each note's outgoing links", () => {
    const notes: NoteLinks[] = [
      { rel: "A.md", links: ["B.md", "C.md"], unresolved: 0 },
      { rel: "B.md", links: [], unresolved: 1 },
    ];
    const { forward } = buildLinkMaps(notes);
    expect(forward.get("A.md")).toEqual(["B.md", "C.md"]);
    expect(forward.get("B.md")).toEqual([]);
  });

  it("builds a backward (reverse) map of who links to a note", () => {
    const notes: NoteLinks[] = [
      { rel: "A.md", links: ["C.md"], unresolved: 0 },
      { rel: "B.md", links: ["C.md"], unresolved: 0 },
    ];
    const { backward } = buildLinkMaps(notes);
    expect(backward.get("C.md")).toEqual(["A.md", "B.md"]);
  });

  it("omits dangling targets from the backward map", () => {
    const notes: NoteLinks[] = [{ rel: "A.md", links: ["B.md"], unresolved: 2 }];
    const { backward } = buildLinkMaps(notes);
    expect(backward.get("B.md")).toEqual(["A.md"]);
    expect(backward.has("Ghost")).toBe(false);
  });

  it("dedupes a source that links the same target twice in backward map", () => {
    // links arrive deduped from Rust, but guard anyway
    const notes: NoteLinks[] = [{ rel: "A.md", links: ["B.md", "B.md"], unresolved: 0 }];
    const { backward } = buildLinkMaps(notes);
    expect(backward.get("B.md")).toEqual(["A.md"]);
  });

  it("handles a note linked by several others", () => {
    const notes: NoteLinks[] = [
      { rel: "A.md", links: ["Hub.md"], unresolved: 0 },
      { rel: "B.md", links: ["Hub.md"], unresolved: 0 },
      { rel: "C.md", links: ["Hub.md"], unresolved: 0 },
    ];
    const { backward } = buildLinkMaps(notes);
    expect(backward.get("Hub.md")).toEqual(["A.md", "B.md", "C.md"]);
  });
});

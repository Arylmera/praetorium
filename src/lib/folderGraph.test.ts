import { describe, it, expect } from "vitest";
import { parseFolderGraph } from "./folderGraph";

const raw = JSON.stringify({
  nodes: [
    { id: "fileA", label: "a.py", file_type: "code", source_file: "C:/x/a.py", source_location: "L1", community: 1 },
    { id: "symA", label: "fn()", file_type: "code", source_file: "C:/x/a.py", source_location: "L10", community: 1 },
    { id: "fileB", label: "b.py", file_type: "code", source_file: "C:/x/b.py", source_location: "L1", community: 2 },
  ],
  links: [
    { source: "fileA", target: "symA", relation: "contains" },
    { source: "symA", target: "fileB", relation: "references" },
  ],
});

describe("parseFolderGraph", () => {
  it("file-level collapses to one node per source_file with cross-file edges only", () => {
    const g = parseFolderGraph(raw, false);
    expect(g.nodes.size).toBe(2);
    expect(g.nodes.get("C:/x/a.py")?.label).toBe("a.py");
    expect(g.nodes.get("C:/x/a.py")?.community).toBe(1);
    expect(g.edges.has("C:/x/a.py->C:/x/b.py")).toBe(true);
    expect(g.edges.size).toBe(1);
  });
  it("symbol mode keeps all nodes and edges", () => {
    const g = parseFolderGraph(raw, true);
    expect(g.nodes.size).toBe(3);
    expect(g.edges.size).toBe(2);
  });
});

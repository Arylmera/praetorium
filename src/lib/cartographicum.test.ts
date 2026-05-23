import { describe, it, expect } from "vitest";
import { metaToGraph } from "./cartographicum";

const meta = { folders: [
  { folder: "Anamnesis", nodes: 438, hubs: [["chronica_index", "Chronica index MOC", 37]] as [string,string,number][] },
  { folder: "Armoury", nodes: 10, hubs: [] as [string,string,number][] },
] };

describe("metaToGraph", () => {
  it("creates one node per folder with weight", () => {
    const g = metaToGraph(meta);
    expect(g.nodes.get("folder:Anamnesis")).toMatchObject({ kind: "folder", label: "Anamnesis", weight: 438 });
    expect(g.nodes.get("folder:Armoury")?.weight).toBe(10);
  });
  it("adds the top hub as a child node + edge", () => {
    const g = metaToGraph(meta);
    expect(g.nodes.get("hub:Anamnesis:chronica_index")?.label).toBe("Chronica index MOC");
    expect(g.edges.has("folder:Anamnesis->hub:Anamnesis:chronica_index")).toBe(true);
  });
  it("handles a folder with no hubs", () => {
    const g = metaToGraph(meta);
    expect([...g.edges.values()].some((e) => e.source === "folder:Armoury")).toBe(false);
  });
});

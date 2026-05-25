import { describe, it, expect } from "vitest";
import { buildTree, flattenVisible } from "./fileTree";
import type { VaultFile } from "./types";

const f = (rel: string): VaultFile => ({ rel, name: rel.split("/").pop()!, dir: "" });

describe("buildTree", () => {
  it("nests files under their folder segments", () => {
    const root = buildTree([f("a/b/x.md"), f("a/y.md"), f("z.md")]);
    expect(root.files.map((x) => x.name)).toEqual(["z.md"]);
    const a = root.folders.find((x) => x.name === "a")!;
    expect(a.files.map((x) => x.name)).toEqual(["y.md"]);
    const b = a.folders.find((x) => x.name === "b")!;
    expect(b.files.map((x) => x.name)).toEqual(["x.md"]);
    expect(b.path).toBe("a/b");
  });

  it("counts all descendant files per folder", () => {
    const root = buildTree([f("a/b/x.md"), f("a/y.md")]);
    const a = root.folders.find((x) => x.name === "a")!;
    expect(a.count).toBe(2);
  });

  it("sorts folders before files, each alphabetically", () => {
    const root = buildTree([f("b.md"), f("a.md"), f("z/c.md")]);
    expect(root.folders.map((x) => x.name)).toEqual(["z"]);
    expect(root.files.map((x) => x.name)).toEqual(["a.md", "b.md"]);
  });

  it("normalizes backslash separators", () => {
    const root = buildTree([{ rel: "a\\b.md", name: "b.md", dir: "" }]);
    expect(root.folders[0].name).toBe("a");
  });
});

describe("flattenVisible", () => {
  it("shows only top level when nothing is open", () => {
    const root = buildTree([f("a/x.md"), f("z.md")]);
    const rows = flattenVisible(root, new Set());
    expect(rows.map((r) => r.id)).toEqual(["a", "z.md"]);
    expect(rows.find((r) => r.id === "a")!.depth).toBe(0);
  });

  it("expands an open folder's children with incremented depth", () => {
    const root = buildTree([f("a/x.md")]);
    const rows = flattenVisible(root, new Set(["a"]));
    expect(rows.map((r) => r.id)).toEqual(["a", "a/x.md"]);
    expect(rows.find((r) => r.id === "a/x.md")!.depth).toBe(1);
  });
});

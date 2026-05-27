import { describe, test, expect } from "vitest";
import { normalizePath, basename, dirname } from "./path";

describe("normalizePath", () => {
  test("rewrites Windows separators", () => {
    expect(normalizePath("C:\\Users\\x\\proj")).toBe("C:/Users/x/proj");
  });
  test("leaves POSIX paths untouched", () => {
    expect(normalizePath("/home/x/proj")).toBe("/home/x/proj");
  });
});

describe("basename", () => {
  test("returns the last unix segment", () => {
    expect(basename("/home/u/projects/praetorium")).toBe("praetorium");
  });
  test("ignores a trailing slash", () => {
    expect(basename("/home/u/projects/praetorium/")).toBe("praetorium");
  });
  test("handles Windows separators and a trailing one", () => {
    expect(basename("C:\\Users\\g\\praetorium\\")).toBe("praetorium");
  });
  test("returns '' for empty or separator-only input", () => {
    expect(basename("")).toBe("");
    expect(basename("/")).toBe("");
  });
});

describe("dirname", () => {
  test("returns the parent of a file path", () => {
    expect(dirname("/repo/src/a.ts")).toBe("/repo/src");
  });
  test("normalizes Windows separators", () => {
    expect(dirname("C:\\repo\\src\\a.ts")).toBe("C:/repo/src");
  });
  test("returns the whole path when there is no parent", () => {
    expect(dirname("a.ts")).toBe("a.ts");
    expect(dirname("/top")).toBe("/top");
  });
});

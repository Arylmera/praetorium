import { describe, it, expect } from "vitest";
import { groupByLocation, relativeTime } from "./sessionGroup";
import type { SessionMeta } from "./types";

const s = (id: string, location: string, mtimeMs: number): SessionMeta =>
  ({ id, location, mtimeMs, title: id, sizeBytes: 0, projectDir: location });

describe("groupByLocation", () => {
  it("groups sessions by location", () => {
    const g = groupByLocation([s("a", "C:/x", 1), s("b", "C:/y", 2), s("c", "C:/x", 3)]);
    const map = new Map(g);
    expect(map.get("C:/x")!.map((x) => x.id)).toEqual(["c", "a"]); // newest first within group
    expect(map.get("C:/y")!.map((x) => x.id)).toEqual(["b"]);
  });

  it("orders groups by their most-recent session", () => {
    const g = groupByLocation([s("a", "C:/x", 1), s("b", "C:/y", 5)]);
    expect(g.map(([loc]) => loc)).toEqual(["C:/y", "C:/x"]);
  });
});

describe("relativeTime", () => {
  it("formats recent times", () => {
    const now = 10_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

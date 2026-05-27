import { describe, it, expect } from "vitest";
import { buildAgentNames } from "./agentNaming";

describe("buildAgentNames", () => {
  it("uses the subagent type when unique", () => {
    const names = buildAgentNames(["r1"], (r) => (r === "r1" ? "Explore" : undefined));
    expect(names.get("r1")).toBe("Explore");
  });

  it("numbers duplicate types in first-seen order", () => {
    const typeOf = (r: string) => (r === "r1" || r === "r2" ? "Explore" : undefined);
    const names = buildAgentNames(["r1", "r2"], typeOf);
    expect(names.get("r1")).toBe("Explore 1");
    expect(names.get("r2")).toBe("Explore 2");
  });

  it("falls back to sequential generic names when no type", () => {
    const names = buildAgentNames(["r1", "r2"], () => undefined);
    expect(names.get("r1")).toBe("agent 1");
    expect(names.get("r2")).toBe("agent 2");
  });
});

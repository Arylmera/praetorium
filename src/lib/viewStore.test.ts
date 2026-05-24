import { describe, it, expect } from "vitest";
import { view, setView } from "./viewStore";

describe("viewStore", () => {
  it("setView updates the view signal", () => {
    setView("explorer");
    expect(view()).toBe("explorer");
    setView("console");
    expect(view()).toBe("console");
  });
});

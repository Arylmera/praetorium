import { describe, it, expect } from "vitest";
import { resolveWikilinks } from "./wikilinks";

const idx = new Map<string, string>([["terra", "Terra.md"], ["emperor", "Anamnesis/EMPEROR.md"]]);

describe("resolveWikilinks", () => {
  it("resolves a known link with data-rel", () => {
    const out = resolveWikilinks("see [[Terra]] now", idx);
    expect(out).toContain('data-rel="Terra.md"');
    expect(out).toContain(">Terra</a>");
  });
  it("uses the alias as label", () => {
    const out = resolveWikilinks("[[EMPEROR|the law]]", idx);
    expect(out).toContain('data-rel="Anamnesis/EMPEROR.md"');
    expect(out).toContain(">the law</a>");
  });
  it("renders unknown links as dim span", () => {
    const out = resolveWikilinks("[[Ghost]]", idx);
    expect(out).toContain("wikilink-unresolved");
    expect(out).not.toContain("<a");
  });
});

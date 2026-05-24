import { describe, it, expect, beforeEach, vi } from "vitest";

const KEY = "praetorium.vaultPath";

function makeLocalStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

describe("vaultStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  it("falls back to the default vault when unset", async () => {
    const m = await import("./vaultStore");
    expect(m.vaultPath()).toBe(m.DEFAULT_VAULT);
  });

  it("reads a previously persisted path on load", async () => {
    localStorage.setItem(KEY, "D:\\notes");
    const m = await import("./vaultStore");
    expect(m.vaultPath()).toBe("D:\\notes");
  });

  it("setVaultPath updates the signal and persists to localStorage (round-trip)", async () => {
    const m = await import("./vaultStore");
    m.setVaultPath("E:\\vault");
    expect(m.vaultPath()).toBe("E:\\vault");
    expect(localStorage.getItem(KEY)).toBe("E:\\vault");
  });
});

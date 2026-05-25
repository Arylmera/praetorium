import { createSignal } from "solid-js";

const KEY = "praetorium.vaultPath";

const [vaultPath, setSignal] = createSignal(localStorage.getItem(KEY) || "");
export { vaultPath };

/** Single source of truth for the vault root. Updates the signal and persists. */
export function setVaultPath(path: string) {
  localStorage.setItem(KEY, path);
  setSignal(path);
}

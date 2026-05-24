import { createSignal } from "solid-js";

const KEY = "praetorium.vaultPath";

/** Hardcoded fallback so first run keeps working with no regression. */
export const DEFAULT_VAULT = "C:\\Users\\guill\\Documents\\git\\Terra";

const [vaultPath, setSignal] = createSignal(localStorage.getItem(KEY) || DEFAULT_VAULT);
export { vaultPath };

/** Single source of truth for the vault root. Updates the signal and persists. */
export function setVaultPath(path: string) {
  localStorage.setItem(KEY, path);
  setSignal(path);
}

import { createSignal } from "solid-js";

const MOTION_KEY = "praetorium.reduceMotion";
const [reduceMotion, setReduceMotionSignal] = createSignal(localStorage.getItem(MOTION_KEY) === "1");
export { reduceMotion };
export function setReduceMotion(v: boolean) {
  localStorage.setItem(MOTION_KEY, v ? "1" : "0");
  setReduceMotionSignal(v);
}
export function applyReduceMotion() {
  document.documentElement.setAttribute("data-reduce-motion", reduceMotion() ? "1" : "0");
}

const GLASS_KEY = "praetorium.glass";
const [glass, setGlassSignal] = createSignal(localStorage.getItem(GLASS_KEY) === "1");
export { glass };
// Drive native window vibrancy (Mica/Acrylic on Windows, NSVisualEffect on
// macOS) so the OS blur sits behind the CSS .is-glass panels. No-op outside Tauri.
function syncNativeGlass(v: boolean) {
  if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return;
  import("@tauri-apps/api/core").then((m) => m.invoke("set_glass", { on: v })).catch(() => { /* not in a Tauri window */ });
}
export function setGlass(v: boolean) {
  localStorage.setItem(GLASS_KEY, v ? "1" : "0");
  setGlassSignal(v);
  syncNativeGlass(v);
}
export function applyGlass() {
  syncNativeGlass(glass());
}

// Panel opacity for glass mode (0–100%). Feeds the CSS `--glass-opacity`
// var via an inline style on the .td-root wrapper (see App.tsx).
const GLASS_OPACITY_KEY = "praetorium.glassOpacity";
const storedOpacity = Number(localStorage.getItem(GLASS_OPACITY_KEY));
const [glassOpacity, setGlassOpacitySignal] = createSignal(
  Number.isFinite(storedOpacity) && storedOpacity > 0 ? storedOpacity : 25);
export { glassOpacity };
export function setGlassOpacity(v: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(v)));
  localStorage.setItem(GLASS_OPACITY_KEY, String(clamped));
  setGlassOpacitySignal(clamped);
}

const LAYOUT_KEY = "praetorium.layout";
const [layoutName, setLayoutSignal] = createSignal<"radial" | "hierarchical">(
  (localStorage.getItem(LAYOUT_KEY) as "radial" | "hierarchical") || "hierarchical");
export { layoutName };
export function setLayout(v: "radial" | "hierarchical") {
  localStorage.setItem(LAYOUT_KEY, v);
  setLayoutSignal(v);
}

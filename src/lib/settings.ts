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
export function setGlass(v: boolean) {
  localStorage.setItem(GLASS_KEY, v ? "1" : "0");
  setGlassSignal(v);
}

const LAYOUT_KEY = "praetorium.layout";
const [layoutName, setLayoutSignal] = createSignal<"radial" | "hierarchical">(
  (localStorage.getItem(LAYOUT_KEY) as "radial" | "hierarchical") || "radial");
export { layoutName };
export function setLayout(v: "radial" | "hierarchical") {
  localStorage.setItem(LAYOUT_KEY, v);
  setLayoutSignal(v);
}

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

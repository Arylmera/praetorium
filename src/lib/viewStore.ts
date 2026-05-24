import { createSignal } from "solid-js";
import type { View } from "../components/ViewSwitcher";

/* Global view state, lifted out of App.tsx so the Command Palette (and any
   other non-descendant) can navigate without prop drilling. */
const [view, setView] = createSignal<View>("console");

export { view, setView };

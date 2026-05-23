import { createSignal, Show } from "solid-js";
import { Console } from "./components/Console";
import { Cockpit } from "./components/Cockpit";
import { ReaderPane } from "./components/ReaderPane";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { ViewSwitcher, type View } from "./components/ViewSwitcher";
import { reduceMotion, setReduceMotion, applyReduceMotion, layoutName, setLayout } from "./lib/settings";

function App() {
  const [view, setView] = createSignal<View>("console");
  applyReduceMotion();
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100vh" }}>
      <header style={{ display: "flex", "justify-content": "space-between", "align-items": "center",
        padding: "8px 14px", "border-bottom": "1px solid var(--border)" }}>
        <span style={{ color: "var(--accent)", "letter-spacing": "2px" }}>PRAETORIUM</span>
        <ViewSwitcher view={view} setView={setView} />
        <ThemeSwitcher />
        <select value={layoutName()} onChange={(e) => setLayout(e.currentTarget.value as "radial" | "hierarchical")}>
          <option value="radial">radial</option>
          <option value="hierarchical">hierarchical</option>
        </select>
        <label style={{ "font-size": "11px", color: "var(--fg)" }}>
          <input type="checkbox" checked={reduceMotion()}
            onChange={(e) => { setReduceMotion(e.currentTarget.checked); applyReduceMotion(); }} /> reduce motion
        </label>
      </header>
      <main style={{ flex: "1", "min-height": "0" }}>
        <Show when={view() === "console"}><Console /></Show>
        <Show when={view() === "cockpit"}><Cockpit /></Show>
        <Show when={view() === "reader"}><ReaderPane /></Show>
      </main>
    </div>
  );
}
export default App;

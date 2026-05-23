import { createSignal, Show } from "solid-js";
import { Console } from "./components/Console";
import { Cockpit } from "./components/Cockpit";
import { ReaderPane } from "./components/ReaderPane";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { ViewSwitcher, type View } from "./components/ViewSwitcher";

function App() {
  const [view, setView] = createSignal<View>("console");
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100vh" }}>
      <header style={{ display: "flex", "justify-content": "space-between", "align-items": "center",
        padding: "8px 14px", "border-bottom": "1px solid var(--border)" }}>
        <span style={{ color: "var(--accent)", "letter-spacing": "2px" }}>PRAETORIUM</span>
        <ViewSwitcher view={view} setView={setView} />
        <ThemeSwitcher />
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

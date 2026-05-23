import { Console } from "./components/Console";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { ReaderPane } from "./components/ReaderPane";

function App() {
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100vh" }}>
      <header style={{ display: "flex", "justify-content": "space-between", "align-items": "center",
        padding: "8px 14px", "border-bottom": "1px solid var(--border)" }}>
        <span style={{ color: "var(--accent)", "letter-spacing": "2px" }}>PRAETORIUM</span>
        <ThemeSwitcher />
      </header>
      <main style={{ flex: "1", "min-height": "0", display: "grid", "grid-template-columns": "1fr 1fr" }}>
        <Console />
        <ReaderPane />
      </main>
    </div>
  );
}
export default App;

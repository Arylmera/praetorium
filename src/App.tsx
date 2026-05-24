import { createSignal, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Console } from "./components/Console";
import { Cockpit } from "./components/Cockpit";
import { Explorer } from "./components/Explorer";
import { Settings } from "./components/Settings";
import { WindowControls } from "./components/WindowControls";
import { ViewSwitcher, type View } from "./components/ViewSwitcher";

const ROUTES: Record<View, () => any> = {
  console: Console,
  cockpit: Cockpit,
  explorer: Explorer,
  settings: Settings,
};
import { theme } from "./themes/theme";
import { applyReduceMotion, layoutName, setLayout, glass } from "./lib/settings";
import { applyWatch, refreshMetas } from "./lib/sessionStore";
import { watchSessions } from "./lib/sessions";

function App() {
  const [view, setView] = createSignal<View>("console");
  // Enforce frameless chrome at runtime — guarantees no native title bar even if
  // the embedded tauri.conf.json decorations flag is stale in an incremental build.
  onMount(() => {
    if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return;
    import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow().setDecorations(false))
      .catch(() => { /* not in a Tauri window */ });
  });
  applyReduceMotion();
  watchSessions(applyWatch);
  refreshMetas();
  setInterval(refreshMetas, 4000);
  return (
    <div class="td-root" classList={{ "is-glass": glass() }} data-theme={theme()}>
      {/* ===== TOPBAR ===== drag region for the frameless window */}
      <header class="pr-topbar" data-tauri-drag-region="">
        <div class="pr-prompt" data-tauri-drag-region="">
          <span class="pr-brand-dot" />
          <span class="pr-prompt-path">~/git/Terra</span>
          <span class="pr-prompt-ps1">$</span>
          <span class="pr-prompt-cmd">praetorium</span>
          <span class="pr-prompt-flag">--view=</span><span class="pr-prompt-val">{view()}</span>
          <span class="pr-prompt-flag">--layout=</span><span class="pr-prompt-val">{layoutName()}</span>
          <span class="pr-prompt-cursor">▍</span>
        </div>

        <ViewSwitcher view={view} setView={setView} />

        <div class="pr-topbar-actions">
          <span class="pr-brand-sub">v0.4-dev</span>
          <div class="pr-range" role="group" aria-label="Layout">
            <button class={layoutName() === "radial" ? "is-active" : ""} onClick={() => setLayout("radial")}>radial</button>
            <button class={layoutName() === "hierarchical" ? "is-active" : ""} onClick={() => setLayout("hierarchical")}>hier.</button>
          </div>
          <WindowControls />
        </div>
      </header>

      {/* ===== MAIN ===== keyed wrapper retriggers the route-enter transition per view */}
      <main style={{ flex: "1", "min-height": "0", display: "flex", "flex-direction": "column", padding: "16px 20px 0" }}>
        <Show when={view()} keyed>
          {(v) => <div class="pr-page-enter"><Dynamic component={ROUTES[v]} /></div>}
        </Show>
      </main>

      {/* ===== STATUS BAR — read-only system pings ===== */}
      <footer class="pr-statusbar">
        <span class="item ok">vault <span class="v">Terra</span></span>
        <span class="item">watch <span class="v">on</span></span>
        <span class="item layout" onClick={() => setView("settings")} style={{ cursor: "pointer" }}>layout <span class="v">{layoutName()}</span></span>
        <span class="item" onClick={() => setView("settings")} style={{ cursor: "pointer" }}>theme <span class="v">{theme()}</span></span>
        <span class="spacer" />
        <span class="item">glass <span class="v">{glass() ? "on" : "off"}</span></span>
        <span class="item">tauri <span class="v">2.0</span></span>
      </footer>
    </div>
  );
}

export default App;

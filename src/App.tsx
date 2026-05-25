import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Console } from "./components/Console";
import { Cockpit } from "./components/Cockpit";
import { Explorer } from "./components/Explorer";
import { Settings } from "./components/Settings";
import { WindowControls } from "./components/WindowControls";
import { AmbientCanvas } from "./components/AmbientCanvas";
import { SpecialChrome } from "./components/SpecialChrome";
import { CommandPalette } from "./components/CommandPalette";
import { ViewSwitcher, type View } from "./components/ViewSwitcher";
import { view, setView } from "./lib/viewStore";
import { vaultPath } from "./lib/vaultStore";

const ROUTES: Record<View, () => any> = {
  console: Console,
  cockpit: Cockpit,
  explorer: Explorer,
  settings: Settings,
};
import { theme, themedCopy } from "./themes/theme";
import { applyReduceMotion, layoutName, setLayout, glass } from "./lib/settings";
import { applyWatch, refreshMetas } from "./lib/sessionStore";
import { watchSessions } from "./lib/sessions";

function App() {
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  // Global Ctrl/Cmd+K toggles the command palette.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });
  // Enforce frameless chrome at runtime — guarantees no native title bar even if
  // the embedded tauri.conf.json decorations flag is stale in an incremental build.
  onMount(() => {
    if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return;
    import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow().setDecorations(false))
      .catch(() => { /* not in a Tauri window */ });
  });
  const vaultName = () => { const p = vaultPath().replace(/\\/g, "/").split("/").filter(Boolean).pop(); return p || "no vault"; };
  applyReduceMotion();
  watchSessions(applyWatch);
  refreshMetas();
  setInterval(refreshMetas, 4000);
  return (
    <div class="td-root" classList={{ "is-glass": glass() }} data-theme={theme()}>
      {/* Ambient layer for special themes — sits behind the chrome, idles otherwise */}
      <AmbientCanvas />

      {/* ===== TOPBAR ===== drag region for the frameless window */}
      <header class="pr-topbar" data-tauri-drag-region="">
        <div class="pr-prompt" data-tauri-drag-region="">
          <span class="pr-brand-dot" />
          <span class="pr-prompt-path">{themedCopy()?.path ?? vaultName()}</span>
          <span class="pr-prompt-ps1">{themedCopy()?.ps1 ?? "$"}</span>
          <span class="pr-prompt-cmd">{themedCopy()?.cmd ?? "praetorium"}</span>
          <span class="pr-prompt-flag">--view=</span><span class="pr-prompt-val">{view()}</span>
          <span class="pr-prompt-flag">--layout=</span><span class="pr-prompt-val">{layoutName()}</span>
          <span class="pr-prompt-cursor">▍</span>
        </div>

        <ViewSwitcher />

        <div class="pr-topbar-actions">
          <span class="pr-brand-sub">v0.4-dev</span>
          <div class="pr-range" role="group" aria-label="Layout">
            <button class={layoutName() === "radial" ? "is-active" : ""} onClick={() => setLayout("radial")}>radial</button>
            <button class={layoutName() === "hierarchical" ? "is-active" : ""} onClick={() => setLayout("hierarchical")}>hier.</button>
          </div>
          <WindowControls />
        </div>
      </header>

      {/* Per-theme banner strip (+ cockpit HUD) — special themes only */}
      <SpecialChrome />

      {/* ===== MAIN ===== keyed wrapper retriggers the route-enter transition per view */}
      <main style={{ flex: "1", "min-height": "0", display: "flex", "flex-direction": "column", padding: "16px 20px 0" }}>
        <Show when={view()} keyed>
          {(v) => <div class="pr-page-enter"><Dynamic component={ROUTES[v]} /></div>}
        </Show>
      </main>

      {/* ===== STATUS BAR — read-only system pings ===== */}
      <footer class="pr-statusbar">
        <span class="item ok">vault <span class="v">{vaultName()}</span></span>
        <span class="item">watch <span class="v">on</span></span>
        <span class="item layout" onClick={() => setView("settings")} style={{ cursor: "pointer" }}>layout <span class="v">{layoutName()}</span></span>
        <span class="item" onClick={() => setView("settings")} style={{ cursor: "pointer" }}>theme <span class="v">{theme()}</span></span>
        <span class="spacer" />
        <span class="item">glass <span class="v">{glass() ? "on" : "off"}</span></span>
        <span class="item">tauri <span class="v">2.0</span></span>
      </footer>

      <CommandPalette open={paletteOpen()} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;

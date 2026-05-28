import React, { useState, useEffect } from "react";
import { Console } from "./components/console.jsx";
import { Cockpit } from "./components/cockpit.jsx";
import { Explorer } from "./components/explorer.jsx";
import { Settings } from "./components/settings.jsx";
import { WindowControls } from "./components/window-controls.jsx";
import { AmbientCanvas } from "./components/ambient-canvas.jsx";
import { SpecialChrome } from "./components/special-chrome.jsx";
import { CommandPalette } from "./components/command-palette.jsx";
import { ViewSwitcher } from "./components/view-switcher.jsx";

import { viewStore, setView } from "./stores/view-store.js";
import { vaultPathStore } from "./stores/vault-store.js";
import { glassStore, glassOpacityStore, layoutNameStore, applyReduceMotion, applyGlass } from "./stores/settings.js";
import { themeStore, themedCopy } from "./themes/theme.js";
import { applyWatch, refreshMetas } from "./stores/session-store.js";
import { watchSessions } from "./lib/sessions.js";
import { useStore } from "./stores/use-store.js";

const ROUTES = {
  console: Console,
  cockpit: Cockpit,
  explorer: Explorer,
  settings: Settings,
};

/* __APP_VERSION__ is injected by esbuild --define at build time */
const BUILD_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.7.1";

function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [appVersion, setAppVersion] = useState(BUILD_VERSION);

  const view = useStore(viewStore);
  const glass = useStore(glassStore);
  const glassOpacity = useStore(glassOpacityStore);
  const layoutName = useStore(layoutNameStore);
  const theme = useStore(themeStore);
  const vaultPath = useStore(vaultPathStore);

  const vaultName = (() => {
    const p = vaultPath.replace(/\\/g, "/").split("/").filter(Boolean).pop();
    return p || "no vault";
  })();

  // Global Ctrl/Cmd+K toggles the command palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tauri-only: frameless chrome + version + native glass vibrancy.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return;
    import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow().setDecorations(false))
      .catch(() => { /* not in a Tauri window */ });
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => setAppVersion(v))
      .catch(() => { /* not in a Tauri window */ });
    // Sync native vibrancy with the persisted glass setting on launch.
    applyGlass();
  }, []);

  // Session watcher + periodic meta refresh.
  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    // watchSessions is async and doesn't return an unsubscribe; fire and forget.
    watchSessions((e) => applyWatch(e, { external: true })).catch(() => { /* not in Tauri */ });

    refreshMetas().catch(() => {});
    intervalId = setInterval(() => {
      if (!cancelled) refreshMetas().catch(() => {});
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  // Apply reduce-motion on mount.
  useEffect(() => {
    applyReduceMotion();
  }, []);

  const View = ROUTES[view] ?? Console;
  const tCopy = themedCopy();

  return (
    <div
      className={"pr-root" + (glass ? " is-glass" : "")}
      data-theme={theme}
      style={{ "--glass-opacity": `${glassOpacity}%` }}
    >
      {/* Ambient layer for special themes — sits behind the chrome, idles otherwise */}
      <AmbientCanvas />

      {/* ===== TOPBAR ===== drag region for the frameless window */}
      <header className="pr-topbar" data-tauri-drag-region="">
        <div className="pr-prompt">
          <span className="pr-brand-dot" />
          <span className="pr-prompt-path">{tCopy?.path ?? vaultName}</span>
          <span className="pr-prompt-ps1">{tCopy?.ps1 ?? "$"}</span>
          <span className="pr-prompt-cmd">{tCopy?.cmd ?? "praetorium"}</span>
          <span className="pr-prompt-flag">--view=</span><span className="pr-prompt-val">{view}</span>
          <span className="pr-prompt-flag">--layout=</span><span className="pr-prompt-val">{layoutName}</span>
          <span className="pr-prompt-cursor">▍</span>
        </div>

        <ViewSwitcher />

        <div className="pr-topbar-actions">
          <span className="pr-brand-sub">v{appVersion}</span>
          <WindowControls />
        </div>
      </header>

      <SpecialChrome />

      {/* ===== MAIN ===== keyed wrapper retriggers the route-enter transition per view */}
      <main style={{ flex: "1", minHeight: "0", display: "flex", flexDirection: "column", padding: "16px 20px 0" }}>
        <div key={view} className="pr-page-enter">
          <View />
        </div>
      </main>

      {/* ===== STATUS BAR — read-only system pings ===== */}
      <footer className="pr-statusbar">
        <span className="item ok">vault <span className="v">{vaultName}</span></span>
        <span className="item">watch <span className="v">on</span></span>
        <span className="item layout" onClick={() => setView("settings")} style={{ cursor: "pointer" }}>layout <span className="v">{layoutName}</span></span>
        <span className="item" onClick={() => setView("settings")} style={{ cursor: "pointer" }}>theme <span className="v">{theme}</span></span>
        <span className="spacer" />
        <span className="item">glass <span className="v">{glass ? "on" : "off"}</span></span>
        <span className="item">tauri <span className="v">2.0</span></span>
      </footer>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;

import { For, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { THEME_LIST, theme, setTheme, type ThemeGroup, type ThemeInfo } from "../themes/theme";
import { glass, setGlass, glassOpacity, setGlassOpacity, reduceMotion, setReduceMotion, applyReduceMotion } from "../lib/settings";
import { vaultPath, setVaultPath } from "../lib/vaultStore";
import { SettingRow, SettingSlider } from "./settings/atoms";

async function pickVault() {
  const result = await open({ directory: true, multiple: false });
  if (typeof result === "string") setVaultPath(result);
}

const lineColor = (group: ThemeGroup, strong: boolean) =>
  group === "light"
    ? `rgba(0,0,0,${strong ? 0.24 : 0.13})`
    : `rgba(255,255,255,${strong ? 0.22 : 0.11})`;

function ThemeChip(props: { info: ThemeInfo }) {
  const [bg, panel, accent] = props.info.swatches;
  return (
    <button class={`pr-theme-chip${theme() === props.info.id ? " is-active" : ""}`} onClick={() => setTheme(props.info.id)}>
      <span class="pr-theme-preview" style={{ background: `linear-gradient(180deg, ${panel} 0%, ${bg} 100%)` }}>
        <span class="line l1" style={{ background: lineColor(props.info.group, true) }} />
        <span class="line l2" style={{ background: lineColor(props.info.group, false) }} />
        <span class="dot" style={{ background: accent }} />
      </span>
      <span class="name">{props.info.label}</span>
    </button>
  );
}

function ThemeGrid(props: { group: ThemeGroup }) {
  return (
    <>
      <div class="pr-group-label">{props.group}</div>
      <div class="pr-theme-grid">
        <For each={THEME_LIST.filter((t) => t.group === props.group)}>{(info) => <ThemeChip info={info} />}</For>
      </div>
    </>
  );
}

export function Settings() {
  return (
    <div class="pr-settings">
      {/* VAULT */}
      <section class="pr-set-card">
        <div class="pr-card-head">
          <h2>VAULT</h2>
          <span class="pr-card-meta">notes source directory</span>
        </div>
        <div class="pr-set-body">
          <div class="pr-set-section">
            <div class="pr-set-section-head">
              <span class="h">ROOT</span>
              <span class="meta">vault path</span>
            </div>
            <SettingRow
              title="Root directory"
              desc={<span class="pr-setting-row-path" title={vaultPath()}>{vaultPath()}</span>}
              control={<button class="pr-vault-change" onClick={pickVault}>Change…</button>}
            />
          </div>
        </div>
      </section>

      {/* APPEARANCE */}
      <section class="pr-set-card">
        <div class="pr-card-head">
          <h2>APPEARANCE</h2>
          <span class="pr-card-meta">theme and window styling</span>
        </div>
        <div class="pr-set-body">
          <div class="pr-set-section">
            <div class="pr-set-section-head">
              <span class="h">THEME</span>
              <span class="meta">color scheme</span>
            </div>
            <ThemeGrid group="dark" />
            <ThemeGrid group="light" />
            <ThemeGrid group="special" />
          </div>

          <div class="pr-set-section">
            <div class="pr-set-section-head">
              <span class="h">WINDOW</span>
              <span class="meta">chrome &amp; motion</span>
            </div>
            <SettingRow
              title="Translucent window"
              desc="Show desktop wallpaper through the app with a frosted-glass blur. macOS / Windows 11."
              checked={glass()}
              onToggle={setGlass}
            />
            <Show when={glass()}>
              <SettingSlider
                label="Panel opacity"
                value={glassOpacity()}
                onInput={setGlassOpacity}
                legend={["more transparent", "more solid"]}
              />
            </Show>
            <SettingRow
              title="Reduce motion"
              desc="Disable scan-line sweep, pulses, and the blinking cursor."
              checked={reduceMotion()}
              onToggle={(v) => { setReduceMotion(v); applyReduceMotion(); }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

import { For } from "solid-js";
import { THEME_LIST, theme, setTheme, type ThemeGroup, type ThemeInfo } from "../themes/theme";
import { layoutName, setLayout, glass, setGlass, reduceMotion, setReduceMotion, applyReduceMotion } from "../lib/settings";

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
              <span class="meta">appearance</span>
            </div>
            <ThemeGrid group="dark" />
            <ThemeGrid group="light" />
            <ThemeGrid group="special" />
          </div>

          <div class="pr-set-section">
            <div class="pr-set-section-head"><span class="h">GRAPH LAYOUT</span></div>
            <div class="pr-seg">
              <button class={layoutName() === "radial" ? "is-active" : ""} onClick={() => setLayout("radial")}>radial</button>
              <button class={layoutName() === "hierarchical" ? "is-active" : ""} onClick={() => setLayout("hierarchical")}>hierarchical</button>
            </div>
          </div>

          <div class="pr-set-section">
            <div class="pr-set-section-head"><span class="h">WINDOW</span></div>
            <label class="pr-toggle-row">
              <input type="checkbox" checked={glass()} onChange={(e) => setGlass(e.currentTarget.checked)} />
              enable backdrop blur <span class="hint">· Tauri only</span>
            </label>
            <label class="pr-toggle-row">
              <input type="checkbox" checked={reduceMotion()}
                onChange={(e) => { setReduceMotion(e.currentTarget.checked); applyReduceMotion(); }} />
              reduce motion <span class="hint">· disable scan-line, pulses, blink</span>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

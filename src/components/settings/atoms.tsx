import { Show, type JSX } from "solid-js";

/** Pill toggle — the canonical on/off control for a SettingRow. */
export function ToggleSwitch(props: { checked: boolean; label?: string }) {
  return (
    <span class="pr-switch" classList={{ "is-on": props.checked }} role="switch" aria-checked={props.checked} aria-label={props.label}>
      <span class="pr-switch-thumb" />
    </span>
  );
}

/**
 * Canonical settings entry: a bordered row with a title, optional description,
 * and a control on the right. Pass `onToggle` for a toggle row (the whole row
 * is clickable and shows a pill switch); otherwise pass a `control` element
 * (button, etc.) for a static row.
 */
export function SettingRow(props: {
  title: string;
  desc?: JSX.Element;
  checked?: boolean;
  onToggle?: (v: boolean) => void;
  control?: JSX.Element;
}) {
  const interactive = () => props.onToggle !== undefined;
  const flip = () => props.onToggle?.(!props.checked);
  return (
    <div class="pr-setting-row" classList={{ "is-on": !!props.checked, "is-static": !interactive() }}
      role={interactive() ? "button" : undefined}
      tabindex={interactive() ? 0 : undefined}
      onClick={interactive() ? flip : undefined}
      onKeyDown={interactive() ? (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } } : undefined}>
      <div class="pr-setting-row-text">
        <div class="pr-setting-row-title">{props.title}</div>
        <Show when={props.desc}><div class="pr-setting-row-desc">{props.desc}</div></Show>
      </div>
      <Show when={interactive()} fallback={props.control}>
        <ToggleSwitch checked={!!props.checked} label={props.title} />
      </Show>
    </div>
  );
}

/** Labeled range slider with an optional left/right legend. Units default to %. */
export function SettingSlider(props: {
  label: string;
  value: number;
  onInput: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  legend?: [string, string];
}) {
  return (
    <div class="pr-setting-slider">
      <div class="pr-setting-slider-head">
        <span class="pr-setting-slider-label">{props.label}</span>
        <span class="pr-card-meta">{props.value}{props.unit ?? "%"}</span>
      </div>
      <input type="range" min={props.min ?? 0} max={props.max ?? 100} step="1" value={props.value}
        onInput={(e) => props.onInput(Number(e.currentTarget.value))} />
      <Show when={props.legend}>
        <div class="pr-setting-slider-legend"><span>{props.legend![0]}</span><span>{props.legend![1]}</span></div>
      </Show>
    </div>
  );
}

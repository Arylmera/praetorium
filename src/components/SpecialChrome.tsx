import { For, Match, Switch } from "solid-js";
import { theme } from "../themes/theme";

/* Per-theme ornament that the flat instrument finishes don't get: a banner strip
   under the topbar (in flow, between header and main) and — for cockpit — a fixed
   HUD readout bottom-right. Ported from the special-themes design handoff and
   adapted to Praetorium's vocabulary. Renders nothing for non-special themes. */

const BOOT_LOG = [
  "mounting vault /Terra",
  "watch daemon online",
  "claude bridge ready",
  "graph engine primed",
  "0 errors · 0 warnings",
];

export function SpecialChrome() {
  return (
    <Switch>
      <Match when={theme() === "terminal"}>
        <div class="a-banner-terminal" aria-hidden="true">
          {/* track items duplicated for a seamless -50% marquee loop */}
          <div class="track">
            <For each={[...BOOT_LOG, ...BOOT_LOG]}>{(line) => (
              <span><span class="ok">[ OK ]</span> {line}</span>
            )}</For>
          </div>
        </div>
      </Match>

      <Match when={theme() === "cockpit"}>
        <div class="a-banner-cockpit" aria-hidden="true">
          <span class="blip" />
          <span>link <b>stable</b></span><i class="sep" />
          <span>telemetry <b>nominal</b></span><i class="sep" />
          <span>bearing <b>274°</b></span><i class="sep" />
          <span>reserves <span class="amber">63%</span></span><i class="sep" />
          <span>eta <b>03:42 zulu</b></span>
        </div>
        <div class="a-hud" aria-hidden="true">
          <span>BRG <span class="val">274°</span></span>
          <span>ALT <span class="val">38 200</span></span>
          <span>SPD <span class="val">0.82M</span></span>
          <span>FUEL <span class="amb">63%</span></span>
          <div class="a-hud-tape">LINK <b>STABLE</b></div>
        </div>
      </Match>

      <Match when={theme() === "grimdark"}>
        <div class="a-banner-grimdark" aria-hidden="true">
          <span>by torch and oath</span><i class="sep" />
          <span><b>the watch holds</b></span><i class="sep" />
          <span>orbit 0331.M3</span><i class="sep" />
          <span>sector ix</span>
        </div>
      </Match>
    </Switch>
  );
}

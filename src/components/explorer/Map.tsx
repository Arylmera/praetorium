import { createResource, createMemo, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { metaToGraph } from "../../lib/cartographicum";
import { RadialForceLayout } from "../../lib/layout";
import type { PositionedNode } from "../../lib/layout";
import { emptyGraph } from "../../lib/graph";

const VAULT = "C:\\Users\\guill\\Documents\\git\\Terra";
const W = 900, H = 640;
const layout = new RadialForceLayout();

function buildPosMap(nodes: PositionedNode[]): Map<string, PositionedNode> {
  return new Map(nodes.map((p) => [p.id, p]));
}

export function MapView() {
  const [meta] = createResource(async () => {
    try { return JSON.parse(await invoke<string>("read_cartographicum", { vaultPath: VAULT })); }
    catch { return null; }
  });
  const view = createMemo(() => {
    const g = meta() ? metaToGraph(meta()) : emptyGraph();
    const positioned = layout.layout(g, W, H);
    const pos = buildPosMap(positioned);
    // Auto-fit the viewBox to the actual node bounds (+ padding, extra on the
    // right for labels) so the graph always scales to fit the pane.
    let vb = `0 0 ${W} ${H}`;
    if (positioned.length) {
      const xs = positioned.map((p) => p.x), ys = positioned.map((p) => p.y);
      const pad = 50, labelPad = 240;
      const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
      const maxX = Math.max(...xs) + labelPad, maxY = Math.max(...ys) + pad;
      vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
    }
    return { g, pos, vb };
  });
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <Show when={meta()} fallback={<div style={{ padding: "14px", color: "var(--fg)" }}>No Cartographicum meta.json found.</div>}>
        <svg width="100%" height="100%" viewBox={view().vb} preserveAspectRatio="xMidYMid meet">
          <For each={[...view().g.edges.values()]}>{(e) => {
            const a = view().pos.get(e.source); const b = view().pos.get(e.target);
            return a && b ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border)" stroke-width="1.5" /> : null;
          }}</For>
          <For each={[...view().g.nodes.values()]}>{(n) => {
            const p = view().pos.get(n.id); if (!p) return null;
            const r = n.kind === "folder" ? Math.min(26, 8 + Math.sqrt(n.weight ?? 1)) : 6;
            return (<g>
              <circle cx={p.x} cy={p.y} r={r} fill="var(--panel)" stroke="var(--accent)" stroke-width="2" />
              <text x={p.x + r + 4} y={p.y + 4} fill="var(--fg)" style={{ "font-size": "11px" }}>{n.label}</text>
            </g>);
          }}</For>
        </svg>
      </Show>
    </div>
  );
}

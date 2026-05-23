import { createMemo, For } from "solid-js";
import { graph } from "../lib/runStore";
import { RadialForceLayout, HierarchicalLayout, type LayoutStrategy } from "../lib/layout";
import { layoutName } from "../lib/settings";

const W = 900, H = 640;
const strategies: Record<string, LayoutStrategy> = {
  radial: new RadialForceLayout(),
  hierarchical: new HierarchicalLayout(),
};

const nodeColor = (kind: string, status: string) =>
  status === "failed" ? "tomato"
  : kind === "folder" ? "var(--accent-dim)"
  : "var(--accent)";

export function Cockpit() {
  const positioned = createMemo(() => {
    const g = graph();
    const layout = strategies[layoutName()] ?? strategies.radial;
    const pos = new Map(layout.layout(g, W, H).map((p) => [p.id, p]));
    return { g, pos };
  });
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <For each={[...positioned().g.edges.values()]}>{(e) => {
          const a = positioned().pos.get(e.source); const b = positioned().pos.get(e.target);
          return a && b ? <line class="cockpit-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border)" stroke-width="1.5" /> : null;
        }}</For>
        <For each={positioned().g.activity.slice(-12)}>{(ping) => {
          const p = positioned().pos.get(ping.folderId); if (!p) return null;
          return <circle class="cockpit-ring" cx={p.x} cy={p.y} r="8" />;
        }}</For>
        <For each={[...positioned().g.nodes.values()]}>{(n) => {
          const p = positioned().pos.get(n.id); if (!p) return null;
          const r = n.kind === "master" ? 14 : n.kind === "agent" ? 10 : 7;
          return (
            <g>
              <circle class="cockpit-node" cx={p.x} cy={p.y} r={r} fill="var(--panel)" stroke={nodeColor(n.kind, n.status)} stroke-width="2" />
              <text x={p.x + r + 4} y={p.y + 4} fill="var(--fg)" style={{ "font-size": "11px" }}>{n.label}</text>
            </g>
          );
        }}</For>
      </svg>
    </div>
  );
}

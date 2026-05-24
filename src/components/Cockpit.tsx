import { createMemo, For, untrack } from "solid-js";
import { graph } from "../lib/sessionStore";
import { RadialForceLayout, HierarchicalLayout, type LayoutStrategy } from "../lib/layout";
import { layoutName } from "../lib/settings";

const W = 900, H = 640;
const strategies: Record<string, LayoutStrategy> = {
  radial: new RadialForceLayout(),
  hierarchical: new HierarchicalLayout(),
};

const hue = (sid?: string) => sid ? (Array.from(sid).reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360 : 0;
const nodeStroke = (n: { kind: string; status: string; session?: string }) =>
  n.status === "failed" ? "tomato"
  : n.kind === "folder" ? "var(--accent-dim)"
  : n.session ? `hsl(${hue(n.session)},70%,60%)` : "var(--accent)";

export function Cockpit() {
  // Topology key: changes only when nodes/edges change, NOT on activity pings.
  const topoKey = createMemo(() => {
    const g = graph();
    return `${[...g.nodes.keys()].join(",")}|${[...g.edges.keys()].join(",")}`;
  });
  // Recompute the (expensive) layout only when topology or the chosen layout changes;
  // read the graph untracked so per-event activity pings don't re-run the simulation.
  const positions = createMemo(() => {
    topoKey();
    const layout = strategies[layoutName()] ?? strategies.radial;
    return new Map(untrack(graph).nodes.size ? layout.layout(untrack(graph), W, H).map((p) => [p.id, p] as const) : []);
  });
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <For each={[...graph().edges.values()]}>{(e) => {
          const a = positions().get(e.source); const b = positions().get(e.target);
          return a && b ? <line class="cockpit-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border)" stroke-width="1.5" /> : null;
        }}</For>
        <For each={graph().activity.slice(-12)}>{(ping) => {
          const p = positions().get(ping.folderId); if (!p) return null;
          return <circle class="cockpit-ring" cx={p.x} cy={p.y} r="8" />;
        }}</For>
        <For each={[...graph().nodes.values()]}>{(n) => {
          const p = positions().get(n.id); if (!p) return null;
          const r = n.kind === "master" ? 14 : n.kind === "agent" ? 10 : 7;
          return (
            <g>
              <circle class="cockpit-node" cx={p.x} cy={p.y} r={r} fill="var(--panel)" stroke={nodeStroke(n)} stroke-width="2" />
              <text x={p.x + r + 4} y={p.y + 4} fill="var(--fg)" style={{ "font-size": "11px" }}>{n.label}</text>
            </g>
          );
        }}</For>
      </svg>
    </div>
  );
}

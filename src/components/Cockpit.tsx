import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import { graph, metas, sessions } from "../lib/sessionStore";
import { RadialForceLayout, HierarchicalLayout, type LayoutStrategy } from "../lib/layout";
import { layoutName } from "../lib/settings";
import type { GraphState, GraphNode } from "../lib/types";

const W = 1400, H = 980;
const strategies: Record<string, LayoutStrategy> = {
  radial: new RadialForceLayout(),
  hierarchical: new HierarchicalLayout(),
};

const hue = (sid?: string) => sid ? (Array.from(sid).reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360 : 0;
const nodeStroke = (n: { kind: string; status: string; session?: string }) =>
  n.status === "failed" ? "tomato"
  : n.kind === "folder" ? "var(--accent-dim)"
  : n.session ? `hsl(${hue(n.session)},70%,60%)` : "var(--accent)";
const truncate = (s: string, n = 24) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
/** Session title: prefer the indexed meta title, else the first user prompt we've
 *  streamed for this session, else a short id — never the project (avoids "Terra" dupes). */
const sessionTitle = (sid: string): string => {
  const m = metas().get(sid)?.title;
  if (m && m !== sid) return m;
  const first = sessions().get(sid)?.lines.find((l) => l.role === "user")?.text;
  return first ?? sid.slice(0, 6);
};
const folderBase = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
const nodeLabel = (n: { kind: string; session?: string; label: string; weight?: number }) => {
  if (n.kind === "master" && n.session) {
    const count = (n.weight ?? 1) > 1 ? ` ×${n.weight}` : "";
    return truncate(sessionTitle(n.session)) + count;
  }
  return truncate(n.kind === "folder" ? folderBase(n.label) : n.label);
};
/** Full, untruncated label for the hover tooltip. */
const fullLabel = (n: { kind: string; session?: string; label: string; weight?: number }) =>
  n.kind === "master" && n.session
    ? sessionTitle(n.session) + ((n.weight ?? 1) > 1 ? ` ×${n.weight}` : "")
    : n.label;

/** A session is visible while it's in the live index (active within ~10 min) — the
 *  local run is always shown. Archived (older) sessions are pruned from the graph. */
const visibleSession = (sid?: string) => !sid || sid === "local" || metas().has(sid);

/** Drop nodes belonging to archived sessions, then any folder/project left with no edges. */
function pruneArchived(g: GraphState): GraphState {
  const kept = new Map<string, GraphNode>();
  for (const n of g.nodes.values()) {
    if (n.kind === "folder" || n.kind === "project") kept.set(n.id, n);
    else if (visibleSession(n.session)) kept.set(n.id, n);
  }
  const edges = new Map<string, { id: string; source: string; target: string }>();
  const deg = new Map<string, number>();
  for (const e of g.edges.values()) {
    if (kept.has(e.source) && kept.has(e.target)) {
      edges.set(e.id, e);
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
  }
  const nodes = new Map<string, GraphNode>();
  for (const n of kept.values()) {
    if ((n.kind === "folder" || n.kind === "project") && !deg.get(n.id)) continue; // orphaned
    nodes.set(n.id, n);
  }
  return { nodes, edges, activity: g.activity };
}

/** Collapse same-title sessions (same triggering prompt, within a project) into one
 *  grouped master node with a ×count. Their subagents/folders re-link to the group. */
function collapseByTitle(g: GraphState): GraphState {
  const remap = new Map<string, string>();
  const nodes = new Map<string, GraphNode>();
  const count = new Map<string, number>();
  for (const n of g.nodes.values()) {
    if (n.kind === "master" && n.session) {
      // Normalize the title (trim + 60-char prefix) so the same prompt always groups,
      // regardless of whether the title came from the 80-char meta or the full transcript.
      const gid = `grp:${n.label}:${sessionTitle(n.session).trim().slice(0, 60)}`; // n.label = project
      remap.set(n.id, gid);
      count.set(gid, (count.get(gid) ?? 0) + 1);
      if (!nodes.has(gid)) nodes.set(gid, { id: gid, kind: "master", label: n.label, status: "running", session: n.session });
    } else if (!nodes.has(n.id)) {
      nodes.set(n.id, n);
    }
  }
  for (const [gid, c] of count) { const node = nodes.get(gid); if (node) nodes.set(gid, { ...node, weight: c }); }
  const edges = new Map<string, { id: string; source: string; target: string }>();
  for (const e of g.edges.values()) {
    const s = remap.get(e.source) ?? e.source;
    const t = remap.get(e.target) ?? e.target;
    if (s === t) continue;
    const id = `${s}->${t}`;
    if (!edges.has(id)) edges.set(id, { id, source: s, target: t });
  }
  return { nodes, edges, activity: g.activity };
}

export function Cockpit() {
  // Collapse same-title sessions into grouped nodes before layout/render.
  const displayGraph = createMemo(() => collapseByTitle(pruneArchived(graph())));
  // Topology key: changes only when nodes/edges change, NOT on activity pings.
  const topoKey = createMemo(() => {
    const g = displayGraph();
    return `${[...g.nodes.keys()].join(",")}|${[...g.edges.keys()].join(",")}`;
  });
  // Recompute the (expensive) layout only when topology or the chosen layout changes.
  const positions = createMemo(() => {
    topoKey();
    const layout = strategies[layoutName()] ?? strategies.radial;
    const g = untrack(displayGraph);
    return new Map(g.nodes.size ? layout.layout(g, W, H).map((p) => [p.id, p] as const) : []);
  });
  // Auto-fit bounds of the current positions (+ label padding), then user zoom/pan on top.
  const bounds = createMemo(() => {
    const pts = [...positions().values()];
    if (!pts.length) return { bx: 0, by: 0, bw: W, bh: H };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pad = 60, labelPad = 200;
    const bx = Math.min(...xs) - pad, by = Math.min(...ys) - pad;
    return { bx, by, bw: Math.max(...xs) + labelPad - bx, bh: Math.max(...ys) + pad - by };
  });
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [hover, setHover] = createSignal<{ x: number; y: number; text: string } | null>(null);
  let svgEl: SVGSVGElement | undefined;
  const viewBox = createMemo(() => {
    const b = bounds();
    const w = b.bw / zoom(), h = b.bh / zoom();
    const cx = b.bx + b.bw / 2 + pan().x, cy = b.by + b.bh / 2 + pan().y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  });
  function onWheel(e: WheelEvent) { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; setZoom((z) => Math.min(8, Math.max(0.4, z * f))); }
  let drag = false, lx = 0, ly = 0;
  function onDown(e: PointerEvent) { drag = true; lx = e.clientX; ly = e.clientY; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }
  function onMove(e: PointerEvent) {
    if (!drag || !svgEl) return;
    const r = svgEl.getBoundingClientRect();
    const scale = (bounds().bw / zoom()) / r.width;
    setPan((p) => ({ x: p.x - (e.clientX - lx) * scale, y: p.y - (e.clientY - ly) * scale }));
    lx = e.clientX; ly = e.clientY;
  }
  function onUp() { drag = false; }
  function reset() { setZoom(1); setPan({ x: 0, y: 0 }); }
  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: "10px", left: "12px", "z-index": "2", "max-width": "340px",
        background: "var(--panel)", border: "1px solid var(--border)", "border-radius": "6px", padding: "8px 10px",
        "font-size": "11px", color: "var(--fg)", opacity: "0.92" }}>
        <div style={{ color: "var(--accent)", "font-weight": "700", "margin-bottom": "3px" }}>Cockpit — live agent graph</div>
        <div><b>project</b> → its <b>sessions</b> (colour per session) → <b>subagents</b>, each linked to the <b>folders</b> it touches. Folders touched by multiple sessions are shared. Pulses = live file activity.</div>
        <div style={{ "margin-top": "4px", color: "var(--accent-dim)" }}>Scroll to zoom · drag to pan · <span style={{ cursor: "pointer", "text-decoration": "underline" }} onClick={reset}>reset</span></div>
      </div>
      <svg ref={svgEl} width="100%" height="100%" viewBox={viewBox()} preserveAspectRatio="xMidYMid meet"
        style={{ cursor: "grab", "touch-action": "none" }}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        <For each={[...displayGraph().edges.values()]}>{(e) => {
          // Accessors so endpoints re-track positions() on layout change (no remount needed).
          const a = () => positions().get(e.source);
          const b = () => positions().get(e.target);
          return (
            <Show when={a() && b()}>
              <line class="cockpit-edge" x1={a()!.x} y1={a()!.y} x2={b()!.x} y2={b()!.y} stroke="var(--border)" stroke-width="1.5" />
            </Show>
          );
        }}</For>
        <For each={displayGraph().activity.slice(-12)}>{(ping) => {
          const p = () => positions().get(ping.folderId);
          return <Show when={p()}><circle class="cockpit-ring" cx={p()!.x} cy={p()!.y} r="8" /></Show>;
        }}</For>
        <For each={[...displayGraph().nodes.values()]}>{(n) => {
          const p = () => positions().get(n.id);
          const r = (n.kind === "master" || n.kind === "project") ? 14 : n.kind === "agent" ? 10 : 7;
          return (
            <Show when={p()}>
              <g style={{ cursor: "pointer" }}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, text: fullLabel(n) })}
                onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, text: fullLabel(n) })}
                onMouseLeave={() => setHover(null)}>
                <circle class="cockpit-node" cx={p()!.x} cy={p()!.y} r={r} fill="var(--panel)" stroke={nodeStroke(n)} stroke-width="2" />
                <text x={p()!.x + r + 4} y={p()!.y + 4} fill="var(--fg)" style={{ "font-size": "11px" }}>{nodeLabel(n)}</text>
              </g>
            </Show>
          );
        }}</For>
      </svg>
      <Show when={hover()}>
        <div style={{ position: "fixed", left: `${hover()!.x + 14}px`, top: `${hover()!.y + 14}px`, "z-index": "10",
          "max-width": "420px", background: "var(--panel)", border: "1px solid var(--accent)", "border-radius": "5px",
          padding: "6px 9px", "font-size": "12px", color: "var(--fg)", "white-space": "pre-wrap",
          "pointer-events": "none", "box-shadow": "0 4px 14px rgba(0,0,0,.5)" }}>
          {hover()!.text}
        </div>
      </Show>
    </div>
  );
}

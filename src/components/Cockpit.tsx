import { createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { graph, insights, metas, sessions } from "../lib/sessionStore";
import { RadialForceLayout, HierarchicalLayout, type LayoutStrategy } from "../lib/layout";
import { layoutName, setLayout } from "../lib/settings";
import {
  buildAggregates, buildDetail, buildNodeLive, collapseFinishedAgents, CATEGORY_COLOR, IDLE_MS, toolCategory,
  type NodeLive,
} from "../lib/cockpitView";
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
const visibleSession = (sid?: string) => !sid || sid === "local" || sid.startsWith("local-") || metas().has(sid);

/** Keep only what a live session anchors. Visible master/agent nodes are roots;
 *  a folder survives when a kept session points at it (shared folders stay shared),
 *  and a project survives when it still owns a kept child — so repo→worktree chains
 *  collapse cleanly and empty repo/worktree hubs (archived-only) are dropped. */
function pruneArchived(g: GraphState): GraphState {
  const outT = new Map<string, string[]>(); // source -> targets
  const inS = new Map<string, string[]>();   // target -> sources
  for (const e of g.edges.values()) {
    if (!g.nodes.has(e.source) || !g.nodes.has(e.target)) continue;
    (outT.get(e.source) ?? outT.set(e.source, []).get(e.source)!).push(e.target);
    (inS.get(e.target) ?? inS.set(e.target, []).get(e.target)!).push(e.source);
  }
  const keep = new Set<string>();
  for (const n of g.nodes.values())
    if ((n.kind === "master" || n.kind === "agent") && visibleSession(n.session)) keep.add(n.id);
  // Fixpoint: folders need a kept source; projects need a kept target (repo→worktree→master).
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of g.nodes.values()) {
      if (keep.has(n.id)) continue;
      const ok = n.kind === "folder" ? (inS.get(n.id) ?? []).some((s) => keep.has(s))
        : n.kind === "project" ? (outT.get(n.id) ?? []).some((t) => keep.has(t))
        : false;
      if (ok) { keep.add(n.id); changed = true; }
    }
  }
  const nodes = new Map<string, GraphNode>();
  for (const [id, n] of g.nodes) if (keep.has(id)) nodes.set(id, n);
  const edges = new Map<string, { id: string; source: string; target: string }>();
  for (const [id, e] of g.edges) if (nodes.has(e.source) && nodes.has(e.target)) edges.set(id, e);
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

const TOOL_GLYPH: Record<string, string> = {
  read: "▤", edit: "⊞", bash: "$", web: "◍", search: "⌕", other: "•",
};

export function Cockpit() {
  // Coarse clock so idle/heat/sparkline recompute on a timer, not on event volume.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));

  // Prune archived → collapse same-title sessions → fold finished subagents into
  // a per-master "done" count (keeps the live graph focused on active work).
  const displayGraph = createMemo(() => collapseFinishedAgents(collapseByTitle(pruneArchived(graph()))));

  // Live join (per-node liveness + machine aggregates + selected-node detail).
  const nodeLive = createMemo(() => buildNodeLive(insights(), now()));
  const liveOf = (n: GraphNode): NodeLive | undefined =>
    n.kind === "master" && n.session ? nodeLive().get(`${n.session}:master`) : nodeLive().get(n.id);
  const aggregates = createMemo(() => buildAggregates(displayGraph(), nodeLive(), insights(), now()));

  // Topology key: changes only when nodes/edges change, NOT on activity pings.
  const topoKey = createMemo(() => {
    const g = displayGraph();
    return `${[...g.nodes.keys()].join(",")}|${[...g.edges.keys()].join(",")}`;
  });
  // Recompute the (expensive) layout only when topology or the chosen layout changes.
  const positions = createMemo(() => {
    topoKey();
    const layout = strategies[layoutName()] ?? strategies.hierarchical;
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
  const [selected, setSelected] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [projFilter, setProjFilter] = createSignal("all");
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [legendOpen, setLegendOpen] = createSignal(false);
  let svgEl: SVGSVGElement | undefined;
  const viewBox = createMemo(() => {
    const b = bounds();
    const w = b.bw / zoom(), h = b.bh / zoom();
    const cx = b.bx + b.bw / 2 + pan().x, cy = b.by + b.bh / 2 + pan().y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  });
  function onWheel(e: WheelEvent) { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; setZoom((z) => Math.min(8, Math.max(0.4, z * f))); }
  let drag = false, moved = false, captured = false, lx = 0, ly = 0;
  // NB: capture is deferred until the pointer actually moves past the drag
  // threshold — capturing on pointerdown would steal the click from nodes.
  function onDown(e: PointerEvent) { drag = true; moved = false; captured = false; lx = e.clientX; ly = e.clientY; }
  function onMove(e: PointerEvent) {
    if (!drag || !svgEl) return;
    if (!moved) {
      if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) <= 3) return;
      moved = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      captured = true;
      lx = e.clientX; ly = e.clientY; // reset origin so the pan doesn't jump
      return;
    }
    const r = svgEl.getBoundingClientRect();
    const scale = (bounds().bw / zoom()) / r.width;
    setPan((p) => ({ x: p.x - (e.clientX - lx) * scale, y: p.y - (e.clientY - ly) * scale }));
    lx = e.clientX; ly = e.clientY;
  }
  function onUp(e: PointerEvent) { drag = false; if (captured) { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); captured = false; } }
  function reset() { setZoom(1); setPan({ x: 0, y: 0 }); }

  // Distinct projects for the filter dropdown.
  const projects = createMemo(() => {
    const set = new Set<string>();
    for (const n of displayGraph().nodes.values()) if (n.kind === "project" || n.kind === "master") set.add(n.label);
    return [...set].sort();
  });
  const nodeProject = (n: GraphNode): string | undefined =>
    n.kind === "project" || n.kind === "master" ? n.label
    : n.session ? metas().get(n.session)?.project : undefined;
  /** True when a node is filtered OUT (rendered dimmed). Search + project + status. */
  const isDimmed = (n: GraphNode): boolean => {
    const q = query().trim().toLowerCase();
    if (q) {
      const hay = `${n.label} ${n.kind === "master" && n.session ? sessionTitle(n.session) : ""}`.toLowerCase();
      if (!hay.includes(q)) return true;
    }
    const pf = projFilter();
    if (pf !== "all" && n.kind !== "folder" && nodeProject(n) !== pf) return true;
    const sf = statusFilter();
    if (sf !== "all" && (n.kind === "master" || n.kind === "agent")) {
      const live = liveOf(n);
      const idle = n.status === "running" && (live?.idleMs === undefined || live.idleMs > IDLE_MS);
      if (sf === "running" && !(n.status === "running" && !idle)) return true;
      if (sf === "failed" && n.status !== "failed") return true;
      if (sf === "idle" && !idle) return true;
    }
    return false;
  };

  const detail = createMemo(() => {
    const id = selected();
    return id ? buildDetail(displayGraph(), id, insights(), metas(), now()) : null;
  });

  const fmtDur = (ms?: number) => ms === undefined ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const fmtIdle = (ms?: number) => ms === undefined ? "—" : ms < 1000 ? "now" : `${Math.floor(ms / 1000)}s`;

  return (
    <div class="pr-cockpit">
      <svg ref={svgEl} width="100%" height="100%" viewBox={viewBox()} preserveAspectRatio="xMidYMid meet"
        style={{ cursor: "grab", "touch-action": "none" }}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        onClick={() => { if (!moved) setSelected(null); }}>
        <For each={[...displayGraph().edges.values()]}>{(e) => {
          // Accessors so endpoints re-track positions() on layout change (no remount needed).
          const a = () => positions().get(e.source);
          const b = () => positions().get(e.target);
          const dim = () => {
            const s = displayGraph().nodes.get(e.source), t = displayGraph().nodes.get(e.target);
            return (s && isDimmed(s)) || (t && isDimmed(t));
          };
          return (
            <Show when={a() && b()}>
              <line class="cockpit-edge" classList={{ "is-dimmed": !!dim() }}
                x1={a()!.x} y1={a()!.y} x2={b()!.x} y2={b()!.y} stroke="var(--border)" stroke-width="1.5" />
            </Show>
          );
        }}</For>
        <For each={displayGraph().activity.slice(-12)}>{(ping) => {
          const p = () => positions().get(ping.folderId);
          const color = CATEGORY_COLOR[toolCategory(ping.tool ?? "")];
          return <Show when={p()}><circle class="cockpit-ring" cx={p()!.x} cy={p()!.y} r="8" stroke={color} /></Show>;
        }}</For>
        <For each={[...displayGraph().nodes.values()]}>{(n) => {
          const p = () => positions().get(n.id);
          const baseR = (n.kind === "master" || n.kind === "project") ? 14 : n.kind === "agent" ? 10 : 7;
          const live = () => liveOf(n);
          const rate = () => live()?.recentRate ?? 0;
          const r = () => baseR + (n.kind === "agent" || n.kind === "master" ? rate() * 3 : 0);
          const isRunning = () => n.status === "running" && (n.kind === "agent" || n.kind === "master");
          const idle = () => isRunning() && (live()?.idleMs === undefined || live()!.idleMs! > IDLE_MS);
          const ringColor = () => n.status === "failed" ? "var(--bad)" : n.status === "complete" ? "var(--good)" : "var(--accent)";
          const glow = () => {
            const t = rate();
            return (n.kind === "agent" || n.kind === "master") && t > 0
              ? `drop-shadow(0 0 ${4 + t * 14}px ${nodeStroke(n)})` : "none";
          };
          return (
            <Show when={p()}>
              <g classList={{ "is-dimmed": isDimmed(n), "is-idle": idle(), "is-selected": selected() === n.id }}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, text: fullLabel(n) })}
                onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, text: fullLabel(n) })}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => { e.stopPropagation(); if (!moved) setSelected(n.id); }}>
                <Show when={n.kind === "agent" || n.kind === "master"}>
                  <circle class="cockpit-status-ring" classList={{ "is-running": n.status === "running" }}
                    cx={p()!.x} cy={p()!.y} r={r() + 4} fill="none" stroke={ringColor()} stroke-width="1.5" />
                </Show>
                <circle class="cockpit-node" cx={p()!.x} cy={p()!.y} r={r()} fill="var(--panel)"
                  stroke={nodeStroke(n)} stroke-width="2" style={{ filter: glow() }} />
                <text class="pr-node-label" x={p()!.x + r() + 4} y={p()!.y + 4}>{nodeLabel(n)}</text>
                <Show when={idle() && live()?.idleMs !== undefined}>
                  <text class="pr-node-idle" x={p()!.x + r() + 4} y={p()!.y + 16}>idle {fmtIdle(live()!.idleMs)}</text>
                </Show>
                <Show when={n.kind === "master" && (n.done ?? 0) > 0}>
                  <text class="pr-node-done" classList={{ "is-fail": (n.doneFailed ?? 0) > 0 }} x={p()!.x + r() + 4} y={p()!.y + 16}>
                    +{n.done} done{(n.doneFailed ?? 0) > 0 ? ` · ${n.doneFailed} ✗` : ""}
                  </text>
                </Show>
              </g>
            </Show>
          );
        }}</For>
      </svg>

      {/* layout toggle pinned top-right */}
      <div class="pr-cockpit-layout pr-seg">
        <button class={layoutName() === "radial" ? "is-active" : ""} onClick={() => setLayout("radial")}>radial</button>
        <button class={layoutName() === "hierarchical" ? "is-active" : ""} onClick={() => setLayout("hierarchical")}>hier</button>
      </div>

      {/* mini legend pinned top-left, expandable to a full popover */}
      <div class="pr-legend">
        <For each={[["read","read"],["edit","edit"],["bash","bash"],["web","web"],["search","grep"],["other","other"]] as const}>{([cat,lbl]) => (
          <span class="pr-legend-swatch"><i style={{ background: CATEGORY_COLOR[cat] }} />{lbl}</span>
        )}</For>
        <button class="pr-legend-more" onClick={() => setLegendOpen((v) => !v)}>?</button>
      </div>
      <Show when={legendOpen()}>
        <div class="pr-info-card pr-legend-card">
          <h3>LIVE AGENT GRAPH</h3>
          <p>Each <b>project</b> spawns <b>sessions</b> (one per master) which dispatch <b>subagents</b> linked to the <b>folders</b> they touch. Pulses = file activity, colored by tool. A node's <b>glow</b> tracks recent activity; a faded node with <b>idle Ns</b> is running but quiet. The ring is green on success, red on failure.</p>
          <div class="pr-info-meta">scroll = zoom · drag = pan · <a onClick={reset}>reset view</a></div>
        </div>
      </Show>

      {/* slide-in detail panel (single-click a node) */}
      <Show when={detail()}>{(d) => (
        <div class="pr-cockpit-detail">
          <button class="pr-detail-x" onClick={() => setSelected(null)}>×</button>
          <div class="pr-detail-head">
            <span class="pr-detail-title">{selected()!.startsWith("proj:") || d().kind === "folder" ? truncate(folderBase(d().label), 40) : d().sessionId ? sessionTitle(d().sessionId!) : d().label}</span>
            <span class="pr-detail-state" classList={{ "is-fail": d().state === "failed" }}>{d().state}</span>
          </div>
          <div class="pr-detail-sub">{d().project ?? d().kind}</div>
          <div class="pr-detail-metrics">
            <span>⏱ {fmtDur(d().durationMs)}</span>
            <span classList={{ "is-fail": d().fails > 0 }}>✗ {d().fails}</span>
            <span>⚡ {d().calls}</span>
            <span class="muted">idle {fmtIdle(d().idleMs)}</span>
          </div>
          <Show when={d().recentCalls.length}>
            <div class="pr-detail-label">recent calls</div>
            <For each={[...d().recentCalls].reverse()}>{(c) => (
              <div class="pr-detail-call" classList={{ "is-fail": c.status === "error" }}>
                <span class="pr-call-glyph">{TOOL_GLYPH[c.tool]}</span>
                <span class="pr-call-name">{c.name}{c.target ? ` ${folderBase(c.target)}` : ""}</span>
                <span class="pr-call-meta">{c.status === "error" ? "✗" : c.status === "ok" ? "✓" : "⟳"} {fmtDur(c.durMs)}</span>
              </div>
            )}</For>
          </Show>
          <Show when={d().subagents.length || (d().subagentsDone ?? 0) > 0}>
            <div class="pr-detail-label">
              subagents ({d().subagents.length} active{(d().subagentsDone ?? 0) > 0 ? ` · +${d().subagentsDone} done` : ""})
            </div>
            <div class="pr-detail-chips">
              <For each={d().subagents}>{(a) => <span class="pr-chip is-running" classList={{ "is-fail": a.status === "failed" }}>{a.label}</span>}</For>
              <For each={d().doneSubagents ?? []}>{(a) => <span class="pr-chip is-done" classList={{ "is-fail": a.status === "failed", "is-ok": a.status === "complete" }}>{a.status === "failed" ? "✗" : "✓"} {a.label}</span>}</For>
            </div>
          </Show>
          <Show when={d().folders.length}>
            <div class="pr-detail-label">folders touched ({d().folders.length})</div>
            <div class="pr-detail-chips">
              <For each={d().folders}>{(f) => <span class="pr-chip">{folderBase(f)}</span>}</For>
            </div>
          </Show>
        </div>
      )}</Show>

      {/* persistent bottom bar: counts (left) · activity + search + filters + layout (right) */}
      <div class="pr-cockpit-bar">
        <div class="pr-bar-group">
          <span class="pr-bar-stat"><b>{aggregates().agents}</b> agents</span>
          <span class="pr-bar-sep" />
          <span class="pr-bar-stat"><b>{aggregates().sessions}</b> sessions</span>
          <span class="pr-bar-stat is-fail"><b>{aggregates().fails}</b> fail</span>
          <span class="pr-bar-stat muted"><b>{aggregates().idle}</b> idle</span>
          <span class="pr-bar-stat"><b>{aggregates().folders}</b> folders</span>
        </div>
        <div class="pr-bar-group pr-bar-right">
          <span class="pr-bar-label">activity</span>
          <svg class="pr-spark" viewBox="0 0 120 24" preserveAspectRatio="none">
            <line class="pr-spark-base" x1="0" y1="23.5" x2="120" y2="23.5" />
            {(() => {
              const data = aggregates().callsPerSec;
              const max = Math.max(1, ...data);
              const bw = 120 / data.length;
              return <For each={data}>{(v, i) => (
                <rect x={i() * bw + 0.15} y={24 - Math.max(v ? 1.5 : 0, (v / max) * 23)} width={Math.max(0.6, bw - 0.3)} height={Math.max(v ? 1.5 : 0, (v / max) * 23)} fill="var(--good)" opacity="0.85" />
              )}</For>;
            })()}
          </svg>
          <span class="pr-bar-sep" />
          <input class="pr-bar-search" placeholder="search" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
          <select class="pr-bar-select" value={projFilter()} onChange={(e) => setProjFilter(e.currentTarget.value)}>
            <option value="all">all projects</option>
            <For each={projects()}>{(p) => <option value={p}>{truncate(p, 22)}</option>}</For>
          </select>
          <select class="pr-bar-select" value={statusFilter()} onChange={(e) => setStatusFilter(e.currentTarget.value)}>
            <option value="all">any status</option>
            <option value="running">running</option>
            <option value="failed">failed</option>
            <option value="idle">idle</option>
          </select>
        </div>
      </div>

      <Show when={hover()}>
        <div class="pr-tooltip" style={{ left: `${hover()!.x + 14}px`, top: `${hover()!.y + 14}px` }}>
          {hover()!.text}
        </div>
      </Show>
    </div>
  );
}

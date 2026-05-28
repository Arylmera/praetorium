import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useStore } from "../stores/use-store.js";
import { graphStore, insightsStore, metasStore, sessionsStore } from "../stores/session-store.js";
import { layoutNameStore, setLayout } from "../stores/settings.js";
import { RadialForceLayout, HierarchicalLayout } from "../lib/layout.js";
import {
  buildAggregates, buildDetail, buildNodeLive, collapseFinishedAgents, CATEGORY_COLOR, IDLE_MS, toolCategory,
} from "../lib/cockpitView.js";

const W = 1400, H = 980;
const strategies = {
  radial: new RadialForceLayout(),
  hierarchical: new HierarchicalLayout(),
};

const hue = (sid) => sid ? (Array.from(sid).reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360 : 0;
const nodeStroke = (n) =>
  n.status === "failed" ? "tomato"
  : n.kind === "folder" ? "var(--accent-dim)"
  : n.session ? `hsl(${hue(n.session)},70%,60%)` : "var(--accent)";
const truncate = (s, n = 24) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const folderBase = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

const TOOL_GLYPH = {
  read: "▤", edit: "⊞", bash: "$", web: "◍", search: "⌕", other: "•",
};

/** Keep only what a live session anchors. */
function pruneArchived(g, metas) {
  const outT = new Map();
  const inS = new Map();
  for (const e of g.edges.values()) {
    if (!g.nodes.has(e.source) || !g.nodes.has(e.target)) continue;
    (outT.get(e.source) ?? outT.set(e.source, []).get(e.source)).push(e.target);
    (inS.get(e.target) ?? inS.set(e.target, []).get(e.target)).push(e.source);
  }
  const visibleSession = (sid) => !sid || sid === "local" || sid.startsWith("local-") || metas.has(sid);
  const keep = new Set();
  for (const n of g.nodes.values())
    if ((n.kind === "master" || n.kind === "agent") && visibleSession(n.session)) keep.add(n.id);
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
  const nodes = new Map();
  for (const [id, n] of g.nodes) if (keep.has(id)) nodes.set(id, n);
  const edges = new Map();
  for (const [id, e] of g.edges) if (nodes.has(e.source) && nodes.has(e.target)) edges.set(id, e);
  return { nodes, edges, activity: g.activity };
}

/** Collapse same-title sessions into grouped master node with ×count. */
function collapseByTitle(g, metas, sessions) {
  const sessionTitle = (sid) => {
    const m = metas.get(sid)?.title;
    if (m && m !== sid) return m;
    const first = sessions.get(sid)?.lines.find((l) => l.role === "user")?.text;
    return first ?? sid.slice(0, 6);
  };
  const remap = new Map();
  const nodes = new Map();
  const count = new Map();
  for (const n of g.nodes.values()) {
    if (n.kind === "master" && n.session) {
      const title = sessionTitle(n.session);
      const proj = metas.get(n.session)?.project ?? "";
      const key = `${proj}::${title}`;
      const existing = [...nodes.values()].find(
        (x) => x.kind === "master" && x.session && sessionTitle(x.session) === title
          && (metas.get(x.session)?.project ?? "") === proj
      );
      if (existing) {
        remap.set(n.id, existing.id);
        count.set(existing.id, (count.get(existing.id) ?? 1) + 1);
        continue;
      }
    }
    nodes.set(n.id, n);
  }
  if (remap.size === 0) return g;
  for (const [id, c] of count) {
    const n = nodes.get(id);
    if (n) nodes.set(id, { ...n, weight: c });
  }
  const edges = new Map();
  for (const [id, e] of g.edges) {
    const s = remap.get(e.source) ?? e.source;
    const t = remap.get(e.target) ?? e.target;
    if (!nodes.has(s) || !nodes.has(t) || s === t) continue;
    edges.set(id, { id, source: s, target: t });
  }
  return { nodes, edges, activity: g.activity };
}

export function Cockpit() {
  const graph = useStore(graphStore);
  const insights = useStore(insightsStore);
  const metas = useStore(metasStore);
  const sessions = useStore(sessionsStore);
  const layoutName = useStore(layoutNameStore);

  // Coarse 1-second clock for idle/heat/sparkline recomputation.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [projFilter, setProjFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [legendOpen, setLegendOpen] = useState(false);
  const svgEl = useRef(null);

  // Helper: session title for display.
  const sessionTitle = useCallback((sid) => {
    const m = metas.get(sid)?.title;
    if (m && m !== sid) return m;
    const first = sessions.get(sid)?.lines.find((l) => l.role === "user")?.text;
    return first ?? sid.slice(0, 6);
  }, [metas, sessions]);

  // Prune archived → collapse same-title sessions → fold finished subagents.
  const displayGraph = useMemo(
    () => collapseFinishedAgents(collapseByTitle(pruneArchived(graph, metas), metas, sessions)),
    [graph, metas, sessions]
  );

  // Live per-node liveness + machine aggregates.
  const nodeLive = useMemo(() => buildNodeLive(insights, now), [insights, now]);
  const liveOf = useCallback((n) =>
    n.kind === "master" && n.session ? nodeLive.get(`${n.session}:master`) : nodeLive.get(n.id),
    [nodeLive]
  );
  const aggregates = useMemo(
    () => buildAggregates(displayGraph, nodeLive, insights, now),
    [displayGraph, nodeLive, insights, now]
  );

  // Topology key: only changes when nodes/edges change, not on activity pings.
  const topoKey = useMemo(() => {
    return `${[...displayGraph.nodes.keys()].join(",")}|${[...displayGraph.edges.keys()].join(",")}`;
  }, [displayGraph]);

  // Recompute layout only when topology or chosen layout changes.
  const positions = useMemo(() => {
    const layout = strategies[layoutName] ?? strategies.hierarchical;
    return new Map(displayGraph.nodes.size ? layout.layout(displayGraph, W, H).map((p) => [p.id, p]) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoKey, layoutName]);

  // Auto-fit bounds (+ label padding).
  const bounds = useMemo(() => {
    const pts = [...positions.values()];
    if (!pts.length) return { bx: 0, by: 0, bw: W, bh: H };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pad = 60, labelPad = 200;
    const bx = Math.min(...xs) - pad, by = Math.min(...ys) - pad;
    return { bx, by, bw: Math.max(...xs) + labelPad - bx, bh: Math.max(...ys) + pad - by };
  }, [positions]);

  const viewBox = useMemo(() => {
    const b = bounds;
    const w = b.bw / zoom, h = b.bh / zoom;
    const cx = b.bx + b.bw / 2 + pan.x, cy = b.by + b.bh / 2 + pan.y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [bounds, zoom, pan]);

  // Pointer / wheel handlers (pan + zoom).
  const drag = useRef(false);
  const moved = useRef(false);
  const captured = useRef(false);
  const lx = useRef(0), ly = useRef(0);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    setZoom((z) => Math.min(8, Math.max(0.4, z * f)));
  }, []);

  const onDown = useCallback((e) => {
    drag.current = true; moved.current = false; captured.current = false;
    lx.current = e.clientX; ly.current = e.clientY;
  }, []);

  const onMove = useCallback((e) => {
    if (!drag.current || !svgEl.current) return;
    if (!moved.current) {
      if (Math.abs(e.clientX - lx.current) + Math.abs(e.clientY - ly.current) <= 3) return;
      moved.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      captured.current = true;
      lx.current = e.clientX; ly.current = e.clientY;
      return;
    }
    const r = svgEl.current.getBoundingClientRect();
    const scale = (bounds.bw / zoom) / r.width;
    setPan((p) => ({ x: p.x - (e.clientX - lx.current) * scale, y: p.y - (e.clientY - ly.current) * scale }));
    lx.current = e.clientX; ly.current = e.clientY;
  }, [bounds, zoom]);

  const onUp = useCallback((e) => {
    drag.current = false;
    if (captured.current) { e.currentTarget.releasePointerCapture?.(e.pointerId); captured.current = false; }
  }, []);

  const reset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // Distinct projects for filter dropdown.
  const projects = useMemo(() => {
    const set = new Set();
    for (const n of displayGraph.nodes.values()) if (n.kind === "project" || n.kind === "master") set.add(n.label);
    return [...set].sort();
  }, [displayGraph]);

  const nodeProject = useCallback((n) =>
    n.kind === "project" || n.kind === "master" ? n.label
    : n.session ? metas.get(n.session)?.project : undefined,
    [metas]
  );

  const isDimmed = useCallback((n) => {
    const q = query.trim().toLowerCase();
    if (q) {
      const hay = `${n.label} ${n.kind === "master" && n.session ? sessionTitle(n.session) : ""}`.toLowerCase();
      if (!hay.includes(q)) return true;
    }
    if (projFilter !== "all" && n.kind !== "folder" && nodeProject(n) !== projFilter) return true;
    if (statusFilter !== "all" && (n.kind === "master" || n.kind === "agent")) {
      const live = liveOf(n);
      const idle = n.status === "running" && (live?.idleMs === undefined || live.idleMs > IDLE_MS);
      if (statusFilter === "running" && !(n.status === "running" && !idle)) return true;
      if (statusFilter === "failed" && n.status !== "failed") return true;
      if (statusFilter === "idle" && !idle) return true;
    }
    return false;
  }, [query, projFilter, statusFilter, nodeProject, liveOf, sessionTitle]);

  const detail = useMemo(() => {
    return selected ? buildDetail(displayGraph, selected, insights, metas, now) : null;
  }, [selected, displayGraph, insights, metas, now]);

  const fmtDur = (ms) => ms === undefined ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const fmtIdle = (ms) => ms === undefined ? "—" : ms < 1000 ? "now" : `${Math.floor(ms / 1000)}s`;

  const nodeLabel = useCallback((n) => {
    if (n.kind === "master" && n.session) {
      const count = (n.weight ?? 1) > 1 ? ` \xD7${n.weight}` : "";
      return truncate(sessionTitle(n.session)) + count;
    }
    return truncate(n.kind === "folder" ? folderBase(n.label) : n.label);
  }, [sessionTitle]);

  const fullLabel = useCallback((n) =>
    n.kind === "master" && n.session
      ? sessionTitle(n.session) + ((n.weight ?? 1) > 1 ? ` \xD7${n.weight}` : "")
      : n.label,
    [sessionTitle]
  );

  return (
    <div className="pr-cockpit">
      <svg ref={svgEl} width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
        style={{ cursor: "grab", touchAction: "none" }}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        onClick={() => { if (!moved.current) setSelected(null); }}>
        {[...displayGraph.edges.values()].map((e) => {
          const a = positions.get(e.source);
          const b = positions.get(e.target);
          if (!a || !b) return null;
          const sn = displayGraph.nodes.get(e.source), tn = displayGraph.nodes.get(e.target);
          const dim = (sn && isDimmed(sn)) || (tn && isDimmed(tn));
          return (
            <line key={e.id} className={["cockpit-edge", dim && "is-dimmed"].filter(Boolean).join(" ")}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border)" strokeWidth="1.5" />
          );
        })}
        {displayGraph.activity.slice(-12).map((ping, i) => {
          const p = positions.get(ping.folderId);
          const color = CATEGORY_COLOR[toolCategory(ping.tool ?? "")];
          if (!p) return null;
          return <circle key={`ping-${i}`} className="cockpit-ring" cx={p.x} cy={p.y} r="8" stroke={color} />;
        })}
        {[...displayGraph.nodes.values()].map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const baseR = (n.kind === "master" || n.kind === "project") ? 14 : n.kind === "agent" ? 10 : 7;
          const live = liveOf(n);
          const rate = live?.recentRate ?? 0;
          const r = baseR + (n.kind === "agent" || n.kind === "master" ? rate * 3 : 0);
          const isRunning = n.status === "running" && (n.kind === "agent" || n.kind === "master");
          const idle = isRunning && (live?.idleMs === undefined || live.idleMs > IDLE_MS);
          const ringColor = n.status === "failed" ? "var(--bad)" : n.status === "complete" ? "var(--good)" : "var(--accent)";
          const glow = (n.kind === "agent" || n.kind === "master") && rate > 0
            ? `drop-shadow(0 0 ${4 + rate * 14}px ${nodeStroke(n)})` : "none";
          const dimmed = isDimmed(n);
          return (
            <g key={n.id}
              className={["", dimmed && "is-dimmed", idle && "is-idle", selected === n.id && "is-selected"].filter(Boolean).join(" ")}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, text: fullLabel(n) })}
              onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, text: fullLabel(n) })}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => { e.stopPropagation(); if (!moved.current) setSelected(n.id); }}>
              {(n.kind === "agent" || n.kind === "master") && (
                <circle className={["cockpit-status-ring", n.status === "running" && "is-running"].filter(Boolean).join(" ")}
                  cx={p.x} cy={p.y} r={r + 4} fill="none" stroke={ringColor} strokeWidth="1.5" />
              )}
              <circle className="cockpit-node" cx={p.x} cy={p.y} r={r} fill="var(--panel)"
                stroke={nodeStroke(n)} strokeWidth="2" style={{ filter: glow }} />
              <text className="pr-node-label" x={p.x + r + 4} y={p.y + 4}>{nodeLabel(n)}</text>
              {idle && live?.idleMs !== undefined && (
                <text className="pr-node-idle" x={p.x + r + 4} y={p.y + 16}>idle {fmtIdle(live.idleMs)}</text>
              )}
              {n.kind === "master" && (n.done ?? 0) > 0 && (
                <text className={["pr-node-done", (n.doneFailed ?? 0) > 0 && "is-fail"].filter(Boolean).join(" ")}
                  x={p.x + r + 4} y={p.y + 16}>
                  +{n.done} done{(n.doneFailed ?? 0) > 0 ? ` \xB7 ${n.doneFailed} ✗` : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* layout toggle pinned top-right */}
      <div className="pr-cockpit-layout pr-seg">
        <button className={layoutName === "radial" ? "is-active" : ""} onClick={() => setLayout("radial")}>radial</button>
        <button className={layoutName === "hierarchical" ? "is-active" : ""} onClick={() => setLayout("hierarchical")}>hier</button>
      </div>

      {/* mini legend pinned top-left, expandable */}
      <div className="pr-legend">
        {[["read","read"],["edit","edit"],["bash","bash"],["web","web"],["search","grep"],["other","other"]].map(([cat,lbl]) => (
          <span key={cat} className="pr-legend-swatch"><i style={{ background: CATEGORY_COLOR[cat] }} />{lbl}</span>
        ))}
        <button className="pr-legend-more" onClick={() => setLegendOpen((v) => !v)}>?</button>
      </div>
      {legendOpen && (
        <div className="pr-info-card pr-legend-card">
          <h3>LIVE AGENT GRAPH</h3>
          <p>Each <b>project</b> spawns <b>sessions</b> (one per master) which dispatch <b>subagents</b> linked to the <b>folders</b> they touch. Pulses = file activity, colored by tool. A node&apos;s <b>glow</b> tracks recent activity; a faded node with <b>idle Ns</b> is running but quiet. The ring is green on success, red on failure.</p>
          <div className="pr-info-meta">scroll = zoom &middot; drag = pan &middot; <a onClick={reset}>reset view</a></div>
        </div>
      )}

      {/* slide-in detail panel (single-click a node) */}
      {detail && (
        <div className="pr-cockpit-detail">
          <button className="pr-detail-x" onClick={() => setSelected(null)}>&times;</button>
          <div className="pr-detail-head">
            <span className="pr-detail-title">
              {selected?.startsWith("proj:") || detail.kind === "folder"
                ? truncate(folderBase(detail.label), 40)
                : detail.sessionId ? sessionTitle(detail.sessionId) : detail.label}
            </span>
            <span className={["pr-detail-state", detail.state === "failed" && "is-fail"].filter(Boolean).join(" ")}>{detail.state}</span>
          </div>
          <div className="pr-detail-sub">{detail.project ?? detail.kind}</div>
          <div className="pr-detail-metrics">
            <span>&#x23F1; {fmtDur(detail.durationMs)}</span>
            <span className={detail.fails > 0 ? "is-fail" : ""}>&times; {detail.fails}</span>
            <span>&#x26A1; {detail.calls}</span>
            <span className="muted">idle {fmtIdle(detail.idleMs)}</span>
          </div>
          {detail.recentCalls.length > 0 && (
            <>
              <div className="pr-detail-label">recent calls</div>
              {[...detail.recentCalls].reverse().map((c, i) => (
                <div key={i} className={["pr-detail-call", c.status === "error" && "is-fail"].filter(Boolean).join(" ")}>
                  <span className="pr-call-glyph">{TOOL_GLYPH[c.tool]}</span>
                  <span className="pr-call-name">{c.name}{c.target ? ` ${folderBase(c.target)}` : ""}</span>
                  <span className="pr-call-meta">{c.status === "error" ? "✗" : c.status === "ok" ? "✓" : "⟳"} {fmtDur(c.durMs)}</span>
                </div>
              ))}
            </>
          )}
          {(detail.subagents.length > 0 || (detail.subagentsDone ?? 0) > 0) && (
            <>
              <div className="pr-detail-label">
                subagents ({detail.subagents.length} active{(detail.subagentsDone ?? 0) > 0 ? ` \xB7 +${detail.subagentsDone} done` : ""})
              </div>
              <div className="pr-detail-chips">
                {detail.subagents.map((a, i) => (
                  <span key={i} className={["pr-chip is-running", a.status === "failed" && "is-fail"].filter(Boolean).join(" ")}>{a.label}</span>
                ))}
                {(detail.doneSubagents ?? []).map((a, i) => (
                  <span key={`done-${i}`} className={["pr-chip is-done", a.status === "failed" && "is-fail", a.status === "complete" && "is-ok"].filter(Boolean).join(" ")}>
                    {a.status === "failed" ? "✗" : "✓"} {a.label}
                  </span>
                ))}
              </div>
            </>
          )}
          {detail.folders.length > 0 && (
            <>
              <div className="pr-detail-label">folders touched ({detail.folders.length})</div>
              <div className="pr-detail-chips">
                {detail.folders.map((f, i) => (
                  <span key={i} className="pr-chip">{folderBase(f)}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* persistent bottom bar */}
      <div className="pr-cockpit-bar">
        <div className="pr-bar-group">
          <span className="pr-bar-stat"><b>{aggregates.agents}</b> agents</span>
          <span className="pr-bar-sep" />
          <span className="pr-bar-stat"><b>{aggregates.sessions}</b> sessions</span>
          <span className="pr-bar-stat is-fail"><b>{aggregates.fails}</b> fail</span>
          <span className="pr-bar-stat muted"><b>{aggregates.idle}</b> idle</span>
          <span className="pr-bar-stat"><b>{aggregates.folders}</b> folders</span>
        </div>
        <div className="pr-bar-group pr-bar-right">
          <span className="pr-bar-label">activity</span>
          <svg className="pr-spark" viewBox="0 0 120 24" preserveAspectRatio="none">
            <line className="pr-spark-base" x1="0" y1="23.5" x2="120" y2="23.5" />
            {(() => {
              const data = aggregates.callsPerSec;
              const max = Math.max(1, ...data);
              const bw = 120 / data.length;
              return data.map((v, i) => (
                <rect key={i} x={i * bw + 0.15} y={24 - Math.max(v ? 1.5 : 0, (v / max) * 23)}
                  width={Math.max(0.6, bw - 0.3)} height={Math.max(v ? 1.5 : 0, (v / max) * 23)}
                  fill="var(--good)" opacity="0.85" />
              ));
            })()}
          </svg>
          <span className="pr-bar-sep" />
          <input className="pr-bar-search" placeholder="search" value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onChange={(e) => setQuery(e.currentTarget.value)} />
          <select className="pr-bar-select" value={projFilter} onChange={(e) => setProjFilter(e.currentTarget.value)}>
            <option value="all">all projects</option>
            {projects.map((p) => <option key={p} value={p}>{truncate(p, 22)}</option>)}
          </select>
          <select className="pr-bar-select" value={statusFilter} onChange={(e) => setStatusFilter(e.currentTarget.value)}>
            <option value="all">any status</option>
            <option value="running">running</option>
            <option value="failed">failed</option>
            <option value="idle">idle</option>
          </select>
        </div>
      </div>

      {hover && (
        <div className="pr-tooltip" style={{ left: `${hover.x + 14}px`, top: `${hover.y + 14}px` }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

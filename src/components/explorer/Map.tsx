import { createResource, createMemo, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { metaToGraph } from "../../lib/cartographicum";
import { parseFolderGraph } from "../../lib/folderGraph";
import { RadialForceLayout } from "../../lib/layout";
import type { PositionedNode } from "../../lib/layout";
import { emptyGraph } from "../../lib/graph";
import type { GraphState } from "../../lib/types";

const VAULT = "C:\\Users\\guill\\Documents\\git\\Terra";
const W = 1200, H = 860;
const layout = new RadialForceLayout();

const posMap = (nodes: PositionedNode[]) => new Map(nodes.map((p) => [p.id, p]));
const communityColor = (c?: number) => (c == null ? "var(--accent)" : `hsl(${(c * 57) % 360},65%,62%)`);
const folderColor = (f?: string) => (!f ? "var(--accent)" : `hsl(${(Array.from(f).reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360},65%,62%)`);

/** Merge every folder's file-level (or symbol) graph into one, tagging each node with its folder. */
async function loadAll(folders: string[], showSymbols: boolean): Promise<GraphState> {
  const nodes = new Map(), edges = new Map();
  await Promise.all(folders.map(async (folder) => {
    try {
      const raw = await invoke<string>("read_folder_graph", { folderPath: `${VAULT}\\${folder}` });
      const g = parseFolderGraph(raw, showSymbols);
      for (const n of g.nodes.values()) nodes.set(n.id, { ...n, session: folder });
      for (const e of g.edges.values()) edges.set(e.id, e);
    } catch { /* folder has no graph.json — skip */ }
  }));
  return { nodes, edges, activity: [] };
}

export function MapView() {
  const [meta] = createResource(async () => {
    try { return JSON.parse(await invoke<string>("read_cartographicum", { vaultPath: VAULT })); }
    catch { return null; }
  });
  const folderNames = () => (meta()?.folders ?? []).map((f: any) => f.folder as string);

  const [view, setView] = createSignal<"full" | "rollup">("full"); // default: show everything
  const [drill, setDrill] = createSignal<{ path: string; name: string } | null>(null);
  const [showSymbols, setShowSymbols] = createSignal(false);

  // Full merged graph of all folders.
  const fullKey = createMemo(() => (view() === "full" && meta() ? `${folderNames().join(",")}|${showSymbols() ? 1 : 0}` : null));
  const [fullData] = createResource(fullKey, async (key) => {
    const sym = key.endsWith("|1");
    return loadAll(folderNames(), sym);
  });

  // Single-folder drill graph (rollup mode).
  const drillKey = createMemo(() => (drill() ? `${drill()!.path}|${showSymbols() ? 1 : 0}` : null));
  const [drillData] = createResource(drillKey, async (key) => {
    const i = key.lastIndexOf("|"); const path = key.slice(0, i); const sym = key.endsWith("|1");
    try { return parseFolderGraph(await invoke<string>("read_folder_graph", { folderPath: path }), sym); }
    catch { return emptyGraph(); }
  });

  const activeGraph = createMemo<GraphState>(() => {
    if (view() === "full") return fullData() ?? emptyGraph();
    if (drill()) return drillData() ?? emptyGraph();
    return meta() ? metaToGraph(meta()) : emptyGraph();
  });

  const base = createMemo(() => {
    const g = activeGraph();
    const positioned = layout.layout(g, W, H);
    const pos = posMap(positioned);
    let bx = 0, by = 0, bw = W, bh = H;
    if (positioned.length) {
      const xs = positioned.map((p) => p.x), ys = positioned.map((p) => p.y);
      const pad = 60, labelPad = 160;
      bx = Math.min(...xs) - pad; by = Math.min(...ys) - pad;
      bw = Math.max(...xs) + labelPad - bx; bh = Math.max(...ys) + pad - by;
    }
    return { g, pos, bx, by, bw, bh };
  });

  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [hover, setHover] = createSignal<{ x: number; y: number; title: string; sub: string } | null>(null);
  let svgEl: SVGSVGElement | undefined;
  function reset() { setZoom(1); setPan({ x: 0, y: 0 }); }

  const isDrill = () => view() === "rollup" && !!drill();
  const isOverview = () => view() === "rollup" && !drill();
  const strokeFor = (n: any) => view() === "full" ? folderColor(n.session) : isDrill() ? communityColor(n.community) : "var(--accent)";
  const subFor = (n: any) => {
    if (view() === "full") return `${n.session ?? ""}${n.kind === "folder" ? `\n${n.id}` : ""}`;
    if (isDrill()) return n.kind === "folder" ? n.id : "";
    return n.kind === "folder" ? `${VAULT}\\${n.label}` : n.id?.startsWith?.("hub:") ? n.id.split(":").slice(2).join(":") : "";
  };
  function nodeClick(n: any) {
    if (moved) return; // it was a drag, not a click
    if (isOverview() && n.kind === "folder") { setDrill({ path: `${VAULT}\\${n.label}`, name: n.label }); reset(); }
  }

  const viewBox = createMemo(() => {
    const b = base();
    const w = b.bw / zoom(), h = b.bh / zoom();
    const cx = b.bx + b.bw / 2 + pan().x, cy = b.by + b.bh / 2 + pan().y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  });
  function onWheel(e: WheelEvent) { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; setZoom((z) => Math.min(8, Math.max(0.3, z * f))); }
  // Pan via drag, but only AFTER the pointer actually moves — so a plain click still
  // reaches the node (no pointer-capture stealing the click).
  let down = false, moved = false, lx = 0, ly = 0;
  function onDown(e: PointerEvent) { down = true; moved = false; lx = e.clientX; ly = e.clientY; }
  function onMove(e: PointerEvent) {
    if (!down || !svgEl) return;
    if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3) moved = true;
    const r = svgEl.getBoundingClientRect();
    const scale = (base().bw / zoom()) / r.width;
    setPan((p) => ({ x: p.x - (e.clientX - lx) * scale, y: p.y - (e.clientY - ly) * scale }));
    lx = e.clientX; ly = e.clientY;
  }
  function onUp() { down = false; }

  const loading = () => (view() === "full" ? fullData.loading : drillData.loading);

  return (
    <div class="pr-map-wrap">
      <Show when={meta()} fallback={<div style={{ padding: "14px", color: "var(--gull)" }}>No Cartographicum meta.json found.</div>}>
        <div class="pr-info-card pr-map-info">
          <h3>CARTOGRAPHICUM</h3>
          <div class="pr-map-toggle">
            <button class={view() === "full" ? "is-active" : ""} onClick={() => { setView("full"); reset(); }}>FULL VAULT</button>
            <button class={view() === "rollup" ? "is-active" : ""} onClick={() => { setView("rollup"); setDrill(null); reset(); }}>FOLDERS</button>
          </div>
          <Show when={view() === "full"}>
            <p>Every folder's files merged into one graph, coloured by <b>folder</b>; links are cross-file references.</p>
          </Show>
          <Show when={isOverview()}>
            <p>Each <b>folder</b> sized by note count, linked to its top <b>hub</b>. Click a folder to drill in.</p>
          </Show>
          <Show when={isDrill()}>
            <p><b>{drill()!.name}</b> — files coloured by <b>community</b>. <a style={{ cursor: "pointer", "text-decoration": "underline", color: "var(--accent)" }} onClick={() => { setDrill(null); reset(); }}>back</a></p>
          </Show>
          <label class="pr-check">
            <input type="checkbox" checked={showSymbols()} onChange={(e) => { setShowSymbols(e.currentTarget.checked); reset(); }} /> show symbols <span style={{ color: "var(--gull-2)" }}>· heavier</span>
          </label>
          <div class="pr-info-meta" style={{ "margin-top": "8px" }}>scroll = zoom · drag = pan · <a onClick={reset}>reset</a></div>
        </div>
        <svg ref={svgEl} width="100%" height="100%" viewBox={viewBox()} preserveAspectRatio="xMidYMid meet"
          style={{ cursor: "grab", "touch-action": "none" }}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <For each={[...base().g.edges.values()]}>{(e) => {
            const a = () => base().pos.get(e.source); const b = () => base().pos.get(e.target);
            return <Show when={a() && b()}><line x1={a()!.x} y1={a()!.y} x2={b()!.x} y2={b()!.y} stroke="var(--border)" stroke-width="1" opacity="0.7" /></Show>;
          }}</For>
          <For each={[...base().g.nodes.values()]}>{(n) => {
            const p = () => base().pos.get(n.id);
            const r = isOverview() && n.kind === "folder" ? Math.min(30, 10 + Math.sqrt((n as any).weight ?? 1)) : n.kind === "folder" ? 7 : 5;
            return (
              <Show when={p()}>
                <g style={{ cursor: isOverview() && n.kind === "folder" ? "pointer" : "default" }}
                  onClick={() => nodeClick(n)}
                  onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, title: n.label, sub: subFor(n) })}
                  onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, title: n.label, sub: subFor(n) })}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx={p()!.x} cy={p()!.y} r={r} fill="var(--panel)" stroke={strokeFor(n)} stroke-width="2" />
                  <Show when={isOverview() || isDrill() ? true : r >= 7}>
                    <text x={p()!.x + r + 4} y={p()!.y + 4} fill="var(--fg)" style={{ "font-size": view() === "full" ? "10px" : "13px" }}>{n.label}</text>
                  </Show>
                </g>
              </Show>
            );
          }}</For>
        </svg>
        <Show when={loading()}>
          <div style={{ position: "absolute", bottom: "12px", left: "12px", color: "var(--gull-2)", "font-size": "11px", "font-family": "var(--font-mono)" }}>building graph…</div>
        </Show>
        <Show when={hover()}>
          <div class="pr-tooltip" style={{ left: `${hover()!.x + 14}px`, top: `${hover()!.y + 14}px` }}>
            {hover()!.title}
            <Show when={hover()!.sub}><span class="sub">{hover()!.sub}</span></Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

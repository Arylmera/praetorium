import { createResource, createMemo, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { metaToGraph } from "../../lib/cartographicum";
import { parseFolderGraph } from "../../lib/folderGraph";
import { RadialForceLayout } from "../../lib/layout";
import type { PositionedNode } from "../../lib/layout";
import { emptyGraph } from "../../lib/graph";

const VAULT = "C:\\Users\\guill\\Documents\\git\\Terra";
const W = 1200, H = 860;
const layout = new RadialForceLayout();

function buildPosMap(nodes: PositionedNode[]): Map<string, PositionedNode> {
  return new Map(nodes.map((p) => [p.id, p]));
}
const communityColor = (c?: number) => (c == null ? "var(--accent)" : `hsl(${(c * 57) % 360},65%,62%)`);

export function MapView() {
  const [meta] = createResource(async () => {
    try { return JSON.parse(await invoke<string>("read_cartographicum", { vaultPath: VAULT })); }
    catch { return null; }
  });

  // Drill-down: null = vault overview; else a folder's own Cartographicum graph.
  const [drill, setDrill] = createSignal<{ path: string; name: string } | null>(null);
  const [showSymbols, setShowSymbols] = createSignal(false);
  const folderKey = createMemo(() => (drill() ? `${drill()!.path}|${showSymbols() ? "1" : "0"}` : null));
  const [folderData] = createResource(folderKey, async (key) => {
    const i = key.lastIndexOf("|");
    const path = key.slice(0, i), sym = key.slice(i + 1) === "1";
    try { return parseFolderGraph(await invoke<string>("read_folder_graph", { folderPath: path }), sym); }
    catch { return emptyGraph(); }
  });

  const activeGraph = createMemo(() =>
    drill() ? (folderData() ?? emptyGraph()) : (meta() ? metaToGraph(meta()) : emptyGraph()));

  // Auto-fit base bounds, then user zoom/pan layered on top.
  const base = createMemo(() => {
    const g = activeGraph();
    const positioned = layout.layout(g, W, H);
    const pos = buildPosMap(positioned);
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

  const subFor = (n: { kind: string; id: string; label: string }) => {
    if (drill()) return n.kind === "folder" ? n.id : ""; // file-level node id IS the absolute path
    return n.kind === "folder" ? `${VAULT}\\${n.label}` : n.id.startsWith("hub:") ? n.id.split(":").slice(2).join(":") : "";
  };
  function openFolder(n: { kind: string; label: string }) {
    if (drill() || n.kind !== "folder") return; // only drill from the overview's folder nodes
    setDrill({ path: `${VAULT}\\${n.label}`, name: n.label });
    reset();
  }
  function back() { setDrill(null); reset(); }

  const viewBox = createMemo(() => {
    const b = base();
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
    const scale = (base().bw / zoom()) / r.width;
    setPan((p) => ({ x: p.x - (e.clientX - lx) * scale, y: p.y - (e.clientY - ly) * scale }));
    lx = e.clientX; ly = e.clientY;
  }
  function onUp() { drag = false; }

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      <Show when={meta()} fallback={<div style={{ padding: "14px", color: "var(--fg)" }}>No Cartographicum meta.json found.</div>}>
        <div style={{ position: "absolute", top: "10px", left: "12px", "z-index": "2", "max-width": "340px",
          background: "var(--panel)", border: "1px solid var(--border)", "border-radius": "6px", padding: "8px 10px",
          "font-size": "11px", color: "var(--fg)", opacity: "0.93" }}>
          <div style={{ color: "var(--accent)", "font-weight": "700", "margin-bottom": "3px" }}>
            <span style={{ cursor: drill() ? "pointer" : "default", "text-decoration": drill() ? "underline" : "none" }} onClick={back}>Cartographicum</span>
            <Show when={drill()}><span> ▸ {drill()!.name}</span></Show>
          </div>
          <Show when={!drill()} fallback={
            <div>Folder graph — files coloured by <b>community</b>; links are cross-file references.
              <label style={{ display: "block", "margin-top": "4px" }}>
                <input type="checkbox" checked={showSymbols()} onChange={(e) => { setShowSymbols(e.currentTarget.checked); reset(); }} /> show symbols (functions/headings)
              </label>
            </div>
          }>
            <div>Each <b>folder</b> is a node sized by note count, linked to its top <b>hub</b>. <b>Click a folder</b> to open its graph. Source: <code>meta.json</code>.</div>
          </Show>
          <div style={{ "margin-top": "4px", color: "var(--accent-dim)" }}>
            Scroll to zoom · drag to pan · <span style={{ cursor: "pointer", "text-decoration": "underline" }} onClick={reset}>reset</span>
            <Show when={drill()}> · <span style={{ cursor: "pointer", "text-decoration": "underline" }} onClick={back}>back</span></Show>
          </div>
        </div>
        <svg ref={svgEl} width="100%" height="100%" viewBox={viewBox()} preserveAspectRatio="xMidYMid meet"
          style={{ cursor: "grab", "touch-action": "none" }}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <For each={[...base().g.edges.values()]}>{(e) => {
            const a = () => base().pos.get(e.source); const b = () => base().pos.get(e.target);
            return <Show when={a() && b()}><line x1={a()!.x} y1={a()!.y} x2={b()!.x} y2={b()!.y} stroke="var(--border)" stroke-width="1.5" /></Show>;
          }}</For>
          <For each={[...base().g.nodes.values()]}>{(n) => {
            const p = () => base().pos.get(n.id);
            const r = !drill() && n.kind === "folder" ? Math.min(30, 10 + Math.sqrt(n.weight ?? 1))
              : n.kind === "folder" ? 8 : 6;
            const stroke = drill() ? communityColor(n.community) : "var(--accent)";
            return (
              <Show when={p()}>
                <g style={{ cursor: !drill() && n.kind === "folder" ? "pointer" : "default" }}
                  onClick={() => openFolder(n)}
                  onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, title: n.label, sub: subFor(n) })}
                  onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, title: n.label, sub: subFor(n) })}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx={p()!.x} cy={p()!.y} r={r} fill="var(--panel)" stroke={stroke} stroke-width="2" />
                  <text x={p()!.x + r + 5} y={p()!.y + 4} fill="var(--fg)" style={{ "font-size": drill() ? "11px" : "13px" }}>{n.label}</text>
                </g>
              </Show>
            );
          }}</For>
        </svg>
        <Show when={folderData.loading}>
          <div style={{ position: "absolute", bottom: "12px", left: "12px", color: "var(--accent-dim)", "font-size": "11px" }}>loading folder graph…</div>
        </Show>
        <Show when={hover()}>
          <div style={{ position: "fixed", left: `${hover()!.x + 14}px`, top: `${hover()!.y + 14}px`, "z-index": "10",
            "max-width": "420px", background: "var(--panel)", border: "1px solid var(--accent)", "border-radius": "5px",
            padding: "6px 9px", "font-size": "12px", color: "var(--fg)", "white-space": "pre-wrap",
            "pointer-events": "none", "box-shadow": "0 4px 14px rgba(0,0,0,.5)" }}>
            <div>{hover()!.title}</div>
            <Show when={hover()!.sub}>
              <div style={{ "font-size": "11px", color: "var(--accent-dim)", "margin-top": "2px" }}>{hover()!.sub}</div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

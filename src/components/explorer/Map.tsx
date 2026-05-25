import { createResource, createMemo, createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { RadialForceLayout } from "../../lib/layout";
import type { PositionedNode } from "../../lib/layout";
import { vaultPath } from "../../lib/vaultStore";
import { linksToGraph } from "../../lib/linksGraph";
import { openNote } from "../../lib/explorerStore";
import type { GraphState, NoteLinks } from "../../lib/types";

const W = 1200, H = 860;
const layout = new RadialForceLayout();

const posMap = (nodes: PositionedNode[]) => new Map(nodes.map((p) => [p.id, p]));
const folderColor = (f?: string) =>
  (!f ? "var(--accent)" : `hsl(${(Array.from(f).reduce((a, c) => a + c.charCodeAt(0), 0) * 47) % 360},65%,62%)`);

export function MapView() {
  const [linkNotes] = createResource(vaultPath, async (vp) => {
    if (!vp) return [] as NoteLinks[];
    try { return await invoke<NoteLinks[]>("vault_links", { vaultPath: vp }); }
    catch { return [] as NoteLinks[]; }
  });
  const graph = createMemo<GraphState>(() => linksToGraph(linkNotes() ?? []));

  // adjacency for hover highlight
  const neighbors = createMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => { (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b); };
    for (const e of graph().edges.values()) { add(e.source, e.target); add(e.target, e.source); }
    return m;
  });

  const base = createMemo(() => {
    const g = graph();
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
  const [hover, setHover] = createSignal<{ x: number; y: number; id: string; title: string } | null>(null);
  let svgEl: SVGSVGElement | undefined;
  function reset() { setZoom(1); setPan({ x: 0, y: 0 }); }

  const radiusOf = (w?: number) => Math.min(26, 5 + Math.sqrt(w ?? 0) * 3);
  const dimmed = (id: string) => {
    const h = hover(); if (!h) return false;
    return id !== h.id && !(neighbors().get(h.id)?.has(id));
  };

  const viewBox = createMemo(() => {
    const b = base();
    const w = b.bw / zoom(), h = b.bh / zoom();
    const cx = b.bx + b.bw / 2 + pan().x, cy = b.by + b.bh / 2 + pan().y;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  });
  function onWheel(e: WheelEvent) { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; setZoom((z) => Math.min(8, Math.max(0.3, z * f))); }
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
  function nodeClick(id: string) { if (!moved) openNote(id); }

  return (
    <div class="pr-map-wrap">
      <div class="pr-info-card pr-map-info">
        <h3>CARTOGRAPHICUM</h3>
        <p>Every note linked by <b><code>[[wikilinks]]</code></b>, parsed live — coloured by <b>folder</b>, sized by <b>link count</b>. Works on any vault.</p>
        <div class="pr-info-meta" style={{ "margin-top": "8px" }}>scroll = zoom · drag = pan · click a node to open · <a onClick={reset}>reset</a></div>
      </div>
      <Show when={(linkNotes() ?? []).length} fallback={<div style={{ padding: "14px", color: "var(--gull)" }}>No linked notes in this vault.</div>}>
        <svg ref={svgEl} width="100%" height="100%" viewBox={viewBox()} preserveAspectRatio="xMidYMid meet"
          style={{ cursor: "grab", "touch-action": "none" }}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <For each={[...base().g.edges.values()]}>{(e) => {
            const a = () => base().pos.get(e.source); const b = () => base().pos.get(e.target);
            const dim = () => dimmed(e.source) && dimmed(e.target);
            return <Show when={a() && b()}><line x1={a()!.x} y1={a()!.y} x2={b()!.x} y2={b()!.y} stroke="var(--border)" stroke-width="1" opacity={dim() ? 0.1 : 0.7} /></Show>;
          }}</For>
          <For each={[...base().g.nodes.values()]}>{(n) => {
            const p = () => base().pos.get(n.id);
            const r = radiusOf((n as any).weight);
            return (
              <Show when={p()}>
                <g style={{ cursor: "pointer", opacity: dimmed(n.id) ? 0.15 : 1 }}
                  onClick={() => nodeClick(n.id)}
                  onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, id: n.id, title: n.label })}
                  onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, id: n.id, title: n.label })}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx={p()!.x} cy={p()!.y} r={r} fill="var(--panel)" stroke={folderColor(n.session)} stroke-width="2" />
                  <Show when={r >= 7 || hover()?.id === n.id}>
                    <text x={p()!.x + r + 4} y={p()!.y + 4} fill="var(--fg)" style={{ "font-size": "11px" }}>{n.label}</text>
                  </Show>
                </g>
              </Show>
            );
          }}</For>
        </svg>
      </Show>
      <Show when={linkNotes.loading}>
        <div style={{ position: "absolute", bottom: "12px", left: "12px", color: "var(--gull-2)", "font-size": "11px", "font-family": "var(--font-mono)" }}>building graph…</div>
      </Show>
      <Show when={hover()}>
        <div class="pr-tooltip" style={{ left: `${hover()!.x + 14}px`, top: `${hover()!.y + 14}px` }}>
          {hover()!.title}
          <span class="sub">{hover()!.id}</span>
        </div>
      </Show>
    </div>
  );
}

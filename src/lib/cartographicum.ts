import type { GraphState, GraphNode, GraphEdge } from "./types";

interface MetaFolder { folder: string; nodes: number; hubs: [string, string, number][] }
interface Meta { folders: MetaFolder[] }

/** Map the Cartographicum meta summary to a GraphState the P2 renderer can draw:
 *  one node per folder (weight = node count) + the folder's top hub as a child. Pure. */
export function metaToGraph(meta: Meta): GraphState {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const f of meta.folders ?? []) {
    const fid = `folder:${f.folder}`;
    nodes.set(fid, { id: fid, kind: "folder", label: f.folder, status: "complete", weight: f.nodes });
    const topHub = (f.hubs ?? [])[0];
    if (topHub) {
      const hid = `hub:${f.folder}:${topHub[0]}`;
      nodes.set(hid, { id: hid, kind: "agent", label: topHub[1], status: "complete", weight: topHub[2] });
      const eid = `${fid}->${hid}`;
      edges.set(eid, { id: eid, source: fid, target: hid });
    }
  }
  return { nodes, edges, activity: [] };
}

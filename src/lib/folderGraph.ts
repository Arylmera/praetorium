import type { GraphState, GraphNode, GraphEdge } from "./types";

const basename = (sf: string): string =>
  sf.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || sf;

export function parseFolderGraph(raw: string, showSymbols: boolean): GraphState {
  const data = JSON.parse(raw);
  const jsonNodes: any[] = data.nodes ?? [];
  const jsonEdges: any[] = data.links ?? data.edges ?? [];

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  // Build nodeId → json node map for edge resolution
  const nodeMap = new Map<string, any>();
  for (const n of jsonNodes) nodeMap.set(n.id, n);

  if (showSymbols) {
    // One GraphNode per json node
    for (const n of jsonNodes) {
      const node: GraphNode = {
        id: n.id,
        kind: n.source_location === "L1" ? "folder" : "agent",
        label: n.norm_label || n.label || n.id,
        status: "complete",
        community: n.community,
      };
      nodes.set(node.id, node);
    }
    // One GraphEdge per json link, dedupe, skip self-loops and unknown endpoints
    for (const link of jsonEdges) {
      const source: string = link.source;
      const target: string = link.target;
      if (source === target) continue;
      if (!nodes.has(source) || !nodes.has(target)) continue;
      const id = `${source}->${target}`;
      if (!edges.has(id)) {
        edges.set(id, { id, source, target });
      }
    }
  } else {
    // File-level collapse: one node per source_file
    for (const n of jsonNodes) {
      const fileId: string = n.source_file;
      if (!nodes.has(fileId)) {
        // Use community of the L1 node for this file if present, else first seen
        const community: number | undefined =
          n.source_location === "L1" ? n.community : n.community;
        nodes.set(fileId, {
          id: fileId,
          kind: "folder",
          label: basename(n.source_file),
          status: "complete",
          community,
        });
      } else if (n.source_location === "L1") {
        // Upgrade community to L1's value
        const existing = nodes.get(fileId)!;
        nodes.set(fileId, { ...existing, community: n.community });
      }
    }
    // Cross-file edges only
    for (const link of jsonEdges) {
      const fs: string | undefined = nodeMap.get(link.source)?.source_file;
      const ft: string | undefined = nodeMap.get(link.target)?.source_file;
      if (!fs || !ft || fs === ft) continue;
      const id = `${fs}->${ft}`;
      if (!edges.has(id)) {
        edges.set(id, { id, source: fs, target: ft });
      }
    }
  }

  return { nodes, edges, activity: [] };
}

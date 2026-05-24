import { forceSimulation, forceManyBody, forceLink, forceCenter, type SimulationNodeDatum } from "d3-force";
import { stratify, tree } from "d3-hierarchy";
import type { GraphState } from "./types";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}
export interface LayoutStrategy {
  readonly name: string;
  layout(state: GraphState, width: number, height: number): PositionedNode[];
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

export class RadialForceLayout implements LayoutStrategy {
  readonly name = "radial";
  layout(state: GraphState, width: number, height: number): PositionedNode[] {
    const nodes: SimNode[] = [...state.nodes.keys()].map((id) => ({ id }));
    const links = [...state.edges.values()].map((e) => ({ source: e.source, target: e.target }));
    const sim = forceSimulation(nodes)
      .force("charge", forceManyBody().strength(-220))
      .force("link", forceLink(links).id((d: any) => d.id).distance(70))
      .force("center", forceCenter(width / 2, height / 2))
      .stop();
    // Run a fixed number of ticks for a deterministic-enough static layout.
    for (let i = 0; i < 200; i++) sim.tick();
    return nodes.map((n) => ({ id: n.id, x: n.x ?? width / 2, y: n.y ?? height / 2 }));
  }
}

const HROOT = "__hroot__";

export class HierarchicalLayout implements LayoutStrategy {
  readonly name = "hierarchical";
  layout(state: GraphState, width: number, height: number): PositionedNode[] {
    if (state.nodes.size === 0) return [];
    // Parent of each node = source of its first incoming edge; any node with no
    // incoming edge (project roots, the local run, etc.) attaches to a synthetic
    // super-root so stratify always sees exactly ONE root (multi-session safe).
    const edges = [...state.edges.values()];
    const rows = [{ id: HROOT, parentId: null as string | null }];
    for (const id of state.nodes.keys()) {
      const incoming = edges.find((e) => e.target === id);
      const parentId = incoming && state.nodes.has(incoming.source) ? incoming.source : HROOT;
      rows.push({ id, parentId });
    }
    let root;
    try {
      root = stratify<{ id: string; parentId: string | null }>()
        .id((d) => d.id).parentId((d) => d.parentId)(rows);
    } catch {
      // Cycle or duplicate parent edge — fall back to flat under the root.
      const flat = rows.map((r) => (r.id === HROOT ? r : { id: r.id, parentId: HROOT }));
      root = stratify<{ id: string; parentId: string | null }>()
        .id((d) => d.id).parentId((d) => d.parentId)(flat);
    }
    tree<{ id: string; parentId: string | null }>().size([height - 40, width - 140])(root);
    return root.descendants()
      .filter((d: any) => d.data.id !== HROOT)
      .map((d: any) => ({ id: d.data.id, x: d.y + 70, y: d.x + 20 }));
  }
}

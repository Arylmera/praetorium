import { forceSimulation, forceManyBody, forceLink, forceCenter, type SimulationNodeDatum } from "d3-force";
import { stratify, tree } from "d3-hierarchy";
import type { GraphState } from "./types";
import { MASTER_ID } from "./graph";

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

export class HierarchicalLayout implements LayoutStrategy {
  readonly name = "hierarchical";
  layout(state: GraphState, width: number, height: number): PositionedNode[] {
    // Build a parent map from edges (first incoming edge wins; master has no parent).
    const parent = new Map<string, string | "">();
    parent.set(MASTER_ID, "");
    for (const id of state.nodes.keys()) if (id !== MASTER_ID && !parent.has(id)) {
      const incoming = [...state.edges.values()].find((e) => e.target === id);
      parent.set(id, incoming ? incoming.source : MASTER_ID);
    }
    const rows = [...parent.entries()].map(([id, p]) => ({ id, parentId: p === "" ? null : p }));
    const root = stratify<{ id: string; parentId: string | null }>()
      .id((d) => d.id).parentId((d) => d.parentId)(rows);
    tree<{ id: string; parentId: string | null }>().size([height - 40, width - 80])(root);
    return root.descendants().map((d: any) => ({ id: d.data.id, x: d.y + 40, y: d.x + 20 }));
  }
}

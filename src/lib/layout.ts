import { forceSimulation, forceManyBody, forceLink, forceCenter, type SimulationNodeDatum } from "d3-force";
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

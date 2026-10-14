import { gridLayoutChunk, type GridEdge, type GridNode } from "@core/layout/grid";

/** Un lot de départs du placement automatique (override O-30), hors du fil de l'interface. */
self.onmessage = (event: MessageEvent<{ nodes: GridNode[]; edges: GridEdge[]; chunk: number }>) => {
  const { nodes, edges, chunk } = event.data;
  self.postMessage(gridLayoutChunk(nodes, edges, chunk));
};

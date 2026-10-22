import { bendsOf, diagramNodes, type Id, type ModelDocument, type Point, setBends } from "@core/index";
import type { PointerEvent } from "react";
import { connectPlaced } from "@/app/associationPlacement";
import { addAssociation, addEntity, addInheritance, removeBend } from "@/app/commands";
import { revealSection } from "@/app/dock/actions";
import type { ActiveBend } from "@/app/document/documentView";
import type { DocumentHandle } from "@/app/document/handle";
import { beginMove, type MoveSession } from "@/app/moveCommands";
import type { StatusMessage, Tool } from "@/app/uiStore";
import { hitId } from "./CanvasSurface";
import { INHERITANCE_SIZE, type NodeLayout, snap } from "./geometry";

export type Gesture =
  /** Déplacement en cours (une transaction, les cassures suivent). */
  | { type: "move"; start: Point; move: MoveSession }
  | { type: "bend"; linkId: Id; index: number; created: boolean }
  | { type: "marquee"; start: Point; current: Point; base: Id[] }
  /** `pending` : premier clic fait, en attente du second. */
  | { type: "link"; fromId: Id; start: Point; current: Point; pending: boolean };

/** Ce que les gestes du MCD lisent et modifient (reconstruit à chaque rendu du canevas). */
export interface McdContext {
  docHandle: DocumentHandle;
  doc: ModelDocument;
  tool: Tool;
  setTool: (tool: Tool) => void;
  notify: (status: StatusMessage | null) => void;
  selection: Id[];
  selected: Set<Id>;
  select: (ids: Id[]) => void;
  toggleSelected: (id: Id) => void;
  activeBend: ActiveBend | null;
  setActiveBend: (bend: ActiveBend | null) => void;
  gesture: Gesture | null;
  setGesture: (gesture: Gesture | null) => void;
  grid: number | null;
  layouts: Map<Id, NodeLayout>;
}

export function connect(c: McdContext, fromId: Id, toId: Id | null) {
  const { doc, layouts } = c;
  c.setGesture(null);
  const a = layouts.get(fromId);
  const b = toId ? layouts.get(toId) : undefined;
  if (!(a && b && toId)) {
    return;
  }
  const isEntity = doc.entities.some((e) => e.id === fromId);
  if (fromId === toId && !isEntity) {
    return;
  }
  const result = connectPlaced(c.docHandle, fromId, toId);
  if (!result) {
    return;
  }
  if ("error" in result) {
    c.notify({ kind: "error", text: result.error });
  } else {
    c.select([result.created]);
  }
}

export function onPointerDown(c: McdContext, e: PointerEvent<SVGSVGElement>, point: Point): boolean {
  const hit = hitId(e);
  return (
    handleDown(c, e, hit, point) || createDown(c, hit, point) || linkDown(c, hit, point) || selectDown(c, e, hit, point)
  );
}

/** Bouton × d'une cassure, pastille d'erreur, poignées d'un lien sélectionné. */
function handleDown(c: McdContext, e: PointerEvent<SVGSVGElement>, hit: Id | null, point: Point): boolean {
  const { docHandle, activeBend } = c;
  const target = e.target as Element;
  if (target.closest("[data-bend-delete]") && activeBend) {
    removeBend(docHandle, activeBend.linkId, activeBend.index);
    return true;
  }
  if (target.closest("[data-badge]") && hit) {
    c.select([hit]);
    revealSection("issues");
    return true;
  }
  const handle = target.closest<SVGElement>("[data-handle]");
  if (!(handle && hit && c.tool === "select")) {
    return false;
  }
  const index = Number(handle.dataset.index);
  if (handle.dataset.handle === "bend" && e.detail >= 2) {
    removeBend(docHandle, hit, index);
    return true;
  }
  c.setActiveBend({ linkId: hit, index });
  docHandle.store.getState().begin();
  const created = handle.dataset.handle === "mid";
  if (created) {
    docHandle.store.getState().preview((d) => {
      const bends = [...bendsOf(d.layout, hit)];
      bends.splice(index, 0, { x: snap(point.x, c.grid), y: snap(point.y, c.grid) });
      setBends(d.layout, hit, bends);
    });
  }
  c.setGesture({ type: "bend", linkId: hit, index, created });
  return true;
}

/** Outils Entité, Association, Héritage : création au clic dans le vide. */
function createDown(c: McdContext, hit: Id | null, point: Point): boolean {
  const { tool, grid, docHandle } = c;
  if (!(tool === "entity" || tool === "association" || tool === "inheritance")) {
    return false;
  }
  if (hit) {
    return true;
  }
  const position = { x: snap(point.x, grid), y: snap(point.y, grid) };
  if (tool === "inheritance") {
    // Le triangle est centré sur le clic.
    const at = {
      x: snap(point.x - INHERITANCE_SIZE.width / 2, grid),
      y: snap(point.y - INHERITANCE_SIZE.height / 2, grid),
    };
    c.select([addInheritance(docHandle, at)]);
  } else {
    c.select([tool === "entity" ? addEntity(docHandle, position) : addAssociation(docHandle, position)]);
  }
  c.setTool("select");
  return true;
}

/** Outil Lien : premier objet, puis second clic (ou relâcher après un glisser). */
function linkDown(c: McdContext, hit: Id | null, point: Point): boolean {
  if (c.tool !== "link") {
    return false;
  }
  const { gesture, layouts } = c;
  if (gesture?.type === "link" && gesture.pending) {
    if (hit && layouts.has(hit)) {
      connect(c, gesture.fromId, hit);
    } else {
      c.setGesture(null);
    }
  } else if (hit && layouts.has(hit)) {
    c.setGesture({ type: "link", fromId: hit, start: point, current: point, pending: false });
  }
  return true;
}

/** Sélection : rectangle dans le vide, Maj + clic, ou début d'un déplacement. */
function selectDown(c: McdContext, e: PointerEvent<SVGSVGElement>, hit: Id | null, point: Point): boolean {
  const { selection, selected } = c;
  if (!hit) {
    const base = e.shiftKey ? selection : [];
    if (!e.shiftKey) {
      c.select([]);
    }
    c.setGesture({ type: "marquee", start: point, current: point, base });
    return true;
  }
  if (e.shiftKey) {
    c.toggleSelected(hit);
    return true;
  }
  const ids = selected.has(hit) ? selection : [hit];
  if (!selected.has(hit)) {
    c.select(ids);
  }
  startMove(c, ids, point);
  return true;
}

/** Déplacement des objets du schéma parmi `ids`. */
function startMove(c: McdContext, ids: Id[], point: Point) {
  const movable = diagramNodes(c.doc)
    .filter((n) => ids.includes(n.id))
    .map((n) => n.id);
  const move = beginMove(c.docHandle, movable, c.grid);
  if (move) {
    c.setGesture({ type: "move", start: point, move });
  }
}

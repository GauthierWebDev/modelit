import {
  bendsOf,
  diagramLinks,
  type Id,
  linkSourceId,
  type ModelDocument,
  type Point,
  positionOf,
  setBends,
} from "@core/index";
import type { MouseEvent, PointerEvent } from "react";
import { addEntity, connectNodes } from "@/app/commands";
import { revealSection } from "@/app/dock/actions";
import type { DocumentHandle } from "@/app/document/handle";
import type { StatusMessage, Tool } from "@/app/uiStore";
import { hitId, hitIdAt } from "./CanvasSurface";
import { logicalRenameTarget, placeNewAssociation } from "./canvasRules";
import { intersects, normalizeRect, snap } from "./geometry";
import type { RenameTarget } from "./InlineRename";
import type { LogicalViewMode, TableLayout } from "./logicalGeometry";
import { openCanvasMenu } from "./objectActions";

/** Déplacement des tables sélectionnées : positions et cassures (traits entre deux d'entre elles) d'origine. */
export interface TableDrag {
  start: Point;
  origins: Map<Id, Point>;
  bends: Map<Id, Point[]>;
}

/** Rectangle de sélection en cours (O-57) ; `base` : sélection conservée (Maj). */
export interface Marquee {
  start: Point;
  current: Point;
  base: Id[];
}

/** Lien en cours (O-54) ; `pending` : premier clic fait, en attente du second. */
export interface PendingLink {
  fromId: Id;
  start: Point;
  current: Point;
  pending: boolean;
}

/** Ce que les gestes des vues MLD / MPD lisent et modifient (reconstruit à chaque rendu). */
export interface LogicalContext {
  docHandle: DocumentHandle;
  doc: ModelDocument;
  mode: LogicalViewMode;
  tool: Tool;
  setTool: (tool: Tool) => void;
  notify: (status: StatusMessage | null) => void;
  selection: Id[];
  selected: Set<Id>;
  select: (ids: Id[]) => void;
  toggleSelected: (id: Id) => void;
  grid: number | null;
  layouts: TableLayout[];
  tableOf: (id: Id | null) => TableLayout | undefined;
  drag: { current: TableDrag | null };
  marquee: Marquee | null;
  setMarquee: (marquee: Marquee | null) => void;
  link: PendingLink | null;
  setLink: (link: PendingLink | null) => void;
  readOnly: boolean;
  setRenaming: (target: RenameTarget | null) => void;
}

function connect(c: LogicalContext, fromId: Id, toId: Id | null) {
  const { doc, grid } = c;
  c.setLink(null);
  const a = c.tableOf(fromId);
  const b = c.tableOf(toId);
  if (!(a && b && toId)) {
    return;
  }
  // L'association (invisible ici) se place comme depuis le MCD (O-60).
  const result = connectNodes(c.docHandle, fromId, toId, placeNewAssociation(doc, fromId, toId, grid));
  if (!result) {
    return;
  }
  if ("error" in result) {
    c.notify({ kind: "error", text: result.error });
  } else {
    c.select([result.created]);
  }
}

export function onPointerDown(c: LogicalContext, e: PointerEvent<SVGSVGElement>, point: Point): boolean {
  const hit = hitId(e);
  const table = c.tableOf(hit)?.sourceId ?? null;
  if (c.tool === "entity") {
    if (!hit) {
      c.select([addEntity(c.docHandle, { x: snap(point.x, c.grid), y: snap(point.y, c.grid) })]);
      c.setTool("select");
    }
    return true;
  }
  if (c.tool === "link") {
    linkDown(c, table, point);
    return true;
  }
  // Vide : rectangle de sélection ; avec Maj, ajouté à la sélection (O-57, comme dans le MCD).
  if (!hit) {
    const base = e.shiftKey ? c.selection : [];
    if (!e.shiftKey) {
      c.select([]);
    }
    c.setMarquee({ start: point, current: point, base });
    return true;
  }
  return selectDown(c, e, hit, point);
}

function linkDown(c: LogicalContext, table: Id | null, point: Point) {
  const { link } = c;
  if (link?.pending) {
    if (table) {
      connect(c, link.fromId, table);
    } else {
      c.setLink(null);
    }
  } else if (table) {
    c.setLink({ fromId: table, start: point, current: point, pending: false });
  }
}

function selectDown(c: LogicalContext, e: PointerEvent<SVGSVGElement>, hit: Id | null, point: Point): boolean {
  const { selection, selected } = c;
  // Maj + clic : ajoute ou retire de la sélection (O-57, comme dans le MCD).
  if (hit && e.shiftKey) {
    c.toggleSelected(hit);
    return true;
  }
  const ids = hit && selected.has(hit) ? selection : hit ? [hit] : [];
  if (!(hit && selected.has(hit))) {
    c.select(ids);
  }
  if (hit && (e.target as Element).closest("[data-badge]")) {
    revealSection("issues");
    return true;
  }
  if (!hit) {
    return false;
  }
  if (!c.tableOf(hit)) {
    return true; // trait entre tables : sélection seule
  }
  startDrag(c, ids, point);
  return true;
}

function startDrag(c: LogicalContext, ids: Id[], point: Point) {
  const { doc } = c;
  const moved = new Set(ids.filter((id) => c.tableOf(id)));
  const origins = new Map([...moved].map((id) => [id, positionOf(doc.layout, id)]));
  const bends = new Map<Id, Point[]>();
  for (const l of diagramLinks(doc)) {
    if (moved.has(linkSourceId(l)) && moved.has(l.entityId)) {
      bends.set(l.id, bendsOf(doc.layout, l.id));
    }
  }
  c.docHandle.store.getState().begin();
  c.drag.current = { start: point, origins, bends };
}

export function onPointerMove(c: LogicalContext, point: Point) {
  const { link, marquee, grid } = c;
  if (link) {
    c.setLink({ ...link, current: point });
  }
  if (marquee) {
    const rect = normalizeRect(marquee.start, point);
    const inside = c.layouts.filter((l) => intersects(rect, l)).map((l) => l.sourceId);
    c.select([...new Set([...marquee.base, ...inside])]);
    c.setMarquee({ ...marquee, current: point });
    return;
  }
  const d = c.drag.current;
  if (!d) {
    return;
  }
  const dx = point.x - d.start.x;
  const dy = point.y - d.start.y;
  c.docHandle.store.getState().preview((draft) => {
    for (const [id, o] of d.origins) {
      draft.layout.positions[id] = { x: snap(o.x + dx, grid), y: snap(o.y + dy, grid) };
    }
    for (const [id, points] of d.bends) {
      setBends(
        draft.layout,
        id,
        points.map((b) => ({ x: snap(b.x + dx, grid), y: snap(b.y + dy, grid) })),
      );
    }
  });
}

export function onPointerUp(c: LogicalContext, e: PointerEvent<SVGSVGElement>, point: Point) {
  const { link } = c;
  if (link && !link.pending) {
    // Glisser : relier à la table sous le pointeur ; simple clic : attendre le second clic.
    const dragged = Math.hypot(point.x - link.start.x, point.y - link.start.y) > 4;
    if (dragged) {
      connect(c, link.fromId, c.tableOf(hitIdAt(e))?.sourceId ?? null);
    } else {
      c.setLink({ ...link, pending: true });
    }
  }
  if (c.drag.current) {
    c.docHandle.store
      .getState()
      .commit(c.drag.current.origins.size > 1 ? "history.moveSelection" : "history.moveTable");
  }
  c.drag.current = null;
  c.setMarquee(null);
}

export function onContextMenu(c: LogicalContext, e: MouseEvent<SVGSVGElement>) {
  // Outil de création : abandon et retour à la sélection (override O-16) ; sinon, menu (O-53).
  if (c.tool === "select") {
    return openCanvasMenu(c.docHandle, e, hitIdAt(e));
  }
  e.preventDefault();
  c.setLink(null);
  c.setTool("select");
}

export function onPointerCancel(c: LogicalContext) {
  if (c.drag.current) {
    c.docHandle.store.getState().cancel();
  }
  c.drag.current = null;
  c.setMarquee(null);
}

export function onDoubleClick(c: LogicalContext, point: Point) {
  if (c.tool !== "select" || c.readOnly) {
    return;
  }
  const target = logicalRenameTarget(c.layouts, c.mode, point);
  if (!target) {
    return;
  }
  c.select([target.sourceId]);
  c.setRenaming(target);
}

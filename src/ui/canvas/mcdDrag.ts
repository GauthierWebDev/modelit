import { type Point, setBends } from "@core/index";
import type { MouseEvent, PointerEvent } from "react";
import { removeBend } from "@/app/commands";
import { hitIdAt } from "./CanvasSurface";
import { intersects, normalizeRect, snap } from "./geometry";
import { connect, type Gesture, type McdContext } from "./mcdGestures";
import { openCanvasMenu } from "./objectActions";

const DRAG_THRESHOLD = 4;

export function onPointerMove(c: McdContext, point: Point) {
  const { gesture, docHandle, grid } = c;
  if (!gesture) {
    return;
  }
  switch (gesture.type) {
    case "move":
      previewMove(c, gesture, point);
      break;
    case "bend": {
      docHandle.store.getState().preview((d) => {
        const bends = d.layout.bends[gesture.linkId];
        if (bends?.[gesture.index]) {
          bends[gesture.index] = { x: snap(point.x, grid), y: snap(point.y, grid) };
        }
      });
      break;
    }
    case "marquee": {
      const rect = normalizeRect(gesture.start, point);
      const inside = [...c.layouts].filter(([, l]) => intersects(rect, l)).map(([id]) => id);
      c.select([...new Set([...gesture.base, ...inside])]);
      c.setGesture({ ...gesture, current: point });
      break;
    }
    case "link":
      c.setGesture({ ...gesture, current: point });
      break;
  }
}

function previewMove(c: McdContext, gesture: Extract<Gesture, { type: "move" }>, point: Point) {
  const { grid } = c;
  const dx = point.x - gesture.start.x;
  const dy = point.y - gesture.start.y;
  // Seule la géométrie change (`layout`) : MLD et SQL ne sont pas recalculés (J-01, phase 3).
  c.docHandle.store.getState().preview((d) => {
    for (const [id, origin] of gesture.origins) {
      d.layout.positions[id] = { x: snap(origin.x + dx, grid), y: snap(origin.y + dy, grid) };
    }
    // Les cassures d'un lien suivent quand ses deux extrémités sont déplacées ensemble.
    for (const [id, bends] of gesture.bendOrigins) {
      setBends(
        d.layout,
        id,
        bends.map((b) => ({ x: snap(b.x + dx, grid), y: snap(b.y + dy, grid) })),
      );
    }
  });
}

export function onPointerUp(c: McdContext, e: PointerEvent<SVGSVGElement>, point: Point) {
  const { gesture, docHandle } = c;
  if (!gesture) {
    return;
  }
  if (gesture.type === "move") {
    docHandle.store.getState().commit(gesture.origins.size > 1 ? "history.moveSelection" : "history.move");
  } else if (gesture.type === "bend") {
    docHandle.store.getState().commit(gesture.created ? "history.createBend" : "history.moveBend");
  } else if (gesture.type === "link") {
    if (gesture.pending) {
      return;
    }
    const dragged = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > DRAG_THRESHOLD;
    // Simple clic : on attend le second clic. Glisser : on relie à l'objet sous le pointeur.
    if (!dragged) {
      return c.setGesture({ ...gesture, pending: true });
    }
    return connect(c, gesture.fromId, hitIdAt(e));
  }
  c.setGesture(null);
}

export function onPointerCancel(c: McdContext) {
  if (c.gesture?.type === "move" || c.gesture?.type === "bend") {
    c.docHandle.store.getState().cancel();
  }
  c.setGesture(null);
}

export function onContextMenu(c: McdContext, e: MouseEvent<SVGSVGElement>) {
  // Outil de création : abandon et retour à la sélection (override O-16).
  if (c.tool !== "select") {
    e.preventDefault();
    c.setGesture(null);
    c.setTool("select");
    return;
  }
  // Clic droit sur une cassure : la supprimer.
  // Repéré au pointeur : le canevas peut avoir capturé le pointeur (cible = le canevas).
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const handle = under?.closest<SVGElement>("[data-handle=bend]");
  const linkId = hitIdAt(e);
  if (!(handle && linkId)) {
    return openCanvasMenu(c.docHandle, e, linkId);
  }
  e.preventDefault();
  removeBend(c.docHandle, linkId, Number(handle.dataset.index));
}

import type { Point } from "@core/index";
import type { MouseEvent, PointerEvent } from "react";
import { removeBend } from "@/app/commands";
import { hitIdAt } from "./CanvasSurface";
import { snap } from "./geometry";
import { connect, type Gesture, type McdContext } from "./mcdGestures";
import { openCanvasMenu } from "./objectActions";
import { isDrag, marqueeSelection } from "./sharedGestures";

export function onPointerMove(c: McdContext, point: Point) {
  const { gesture, docHandle, grid } = c;
  if (!gesture) {
    return;
  }
  switch (gesture.type) {
    case "move":
      previewMove(gesture, point);
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
      c.select(marqueeSelection(gesture.start, point, c.layouts, gesture.base));
      c.setGesture({ ...gesture, current: point });
      break;
    }
    case "link":
      c.setGesture({ ...gesture, current: point });
      break;
  }
}

function previewMove(gesture: Extract<Gesture, { type: "move" }>, point: Point) {
  gesture.move.update({ x: point.x - gesture.start.x, y: point.y - gesture.start.y });
}

export function onPointerUp(c: McdContext, e: PointerEvent<SVGSVGElement>, point: Point) {
  const { gesture, docHandle } = c;
  if (!gesture) {
    return;
  }
  if (gesture.type === "move") {
    gesture.move.commit(gesture.move.count > 1 ? "history.moveSelection" : "history.move");
  } else if (gesture.type === "bend") {
    docHandle.store.getState().commit(gesture.created ? "history.createBend" : "history.moveBend");
  } else if (gesture.type === "link") {
    if (gesture.pending) {
      return;
    }
    const dragged = isDrag(gesture.start, point);
    // Simple clic : on attend le second clic. Glisser : on relie à l'objet sous le pointeur.
    if (!dragged) {
      return c.setGesture({ ...gesture, pending: true });
    }
    return connect(c, gesture.fromId, hitIdAt(e));
  }
  c.setGesture(null);
}

export function onPointerCancel(c: McdContext) {
  if (c.gesture?.type === "move") {
    c.gesture.move.cancel();
  } else if (c.gesture?.type === "bend") {
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

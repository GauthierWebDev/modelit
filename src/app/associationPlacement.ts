import { associationPlacement, type Id, type ModelDocument, type Point } from "@core/index";
import { current } from "./commandSupport";
import { diagramSizer } from "./diagramSizer";
import type { DocumentHandle } from "./document/handle";
import { type ConnectResult, connectNodes } from "./linkCommands";

/**
 * Place de l'association créée en reliant `fromId` à `toId`, depuis n'importe quelle vue (O-60) : boîtes de
 * la vue la plus large (MPD), aucun objet existant déplacé. Entre autre chose que deux entités (patte, lien
 * d'héritage), `connectNodes` ne crée pas d'association : pas de placement (audit A-01, U-2).
 */
export function placeNewAssociation(
  doc: ModelDocument,
  fromId: Id,
  toId: Id,
  grid: number | null,
): { associationPosition: Point; reflexiveBends?: Point[] } {
  const isEntity = (id: Id) => doc.entities.some((e) => e.id === id);
  if (!(isEntity(fromId) && isEntity(toId))) {
    return { associationPosition: { x: 0, y: 0 } };
  }
  const sizer = diagramSizer();
  return associationPlacement(
    fromId,
    toId,
    { mcd: sizer.mcdBoxes(doc), placement: sizer.placementBoxes(doc) },
    sizer.associationSize(doc, fromId, toId),
    grid,
  );
}

/** Relie deux objets (outil Lien) ; une association créée est placée sans chevauchement (O-60). */
export function connectPlaced(doc: DocumentHandle, fromId: Id, toId: Id): ConnectResult {
  const model = current(doc);
  const grid = model.settings.grid.enabled ? model.settings.grid.size : null;
  return connectNodes(doc, fromId, toId, placeNewAssociation(model, fromId, toId, grid));
}

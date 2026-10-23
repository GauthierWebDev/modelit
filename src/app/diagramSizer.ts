import type { AssociationSize, Id, ModelDocument, Rect } from "@core/index";
import { unplugged } from "./unplugged";

/**
 * Port des tailles des boîtes du schéma : elles dépendent de la mesure du texte et des options
 * d'affichage, connues de l'interface (`ui/canvas`, qui l'implémente) ; le domaine les reçoit comme des
 * données. Branché au démarrage (`src/bootstrap.ts`) ; les tests branchent l'implémentation de l'interface.
 */
export interface DiagramSizer {
  /** Boîte de chaque objet dans le MCD. */
  mcdBoxes: (doc: ModelDocument) => Map<Id, Rect>;
  /** Plus grande boîte de chaque objet : celle du MCD, ou celle de sa table du MPD (O-60, comme O-09). */
  placementBoxes: (doc: ModelDocument) => Map<Id, Rect>;
  /** Association créée entre `fromId` et `toId` : sa taille dans le MCD et la place qu'elle réserve. */
  associationSize: (doc: ModelDocument, fromId: Id, toId: Id) => AssociationSize;
}

let current: DiagramSizer = unplugged<DiagramSizer>("DiagramSizer");

export function setDiagramSizer(adapter: DiagramSizer) {
  current = adapter;
}

export const diagramSizer = (): DiagramSizer => current;

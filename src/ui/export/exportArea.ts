import { type Id, type LogicalModel, type ModelDocument, toLogicalModel } from "@core/index";
import { canvasMetrics } from "@/app/canvasMetrics";
import type { ViewMode, Viewport } from "@/app/document/documentView";
import type { DocumentHandle } from "@/app/document/handle";
import type { ExportPreferences } from "@/app/preferencesStore";
import type { Rect } from "@/ui/canvas/geometry";
import type { AreaSpec } from "./exportImage";

/** Zone exportée (override O-63). */
export type ExportArea = ExportPreferences["area"];

export const EXPORT_AREAS: ExportArea[] = ["viewport", "selection", "all"];

/**
 * Partie du schéma visible dans le canevas, en coordonnées du modèle (l'écran affiche `modèle × zoom + (x, y)`) ;
 * `pixels` : taille du canevas à l'écran, celle de l'image à 96 dpi.
 */
export function visibleArea(
  viewport: Viewport,
  canvas: { width: number; height: number },
): { rect: Rect; pixels: { width: number; height: number } } {
  const width = Math.max(1, Math.round(canvas.width));
  const height = Math.max(1, Math.round(canvas.height));
  return {
    rect: {
      x: -viewport.x / viewport.zoom,
      y: -viewport.y / viewport.zoom,
      width: width / viewport.zoom,
      height: height / viewport.zoom,
    },
    pixels: { width, height },
  };
}

/**
 * Éléments du canevas (`data-id`) gardés pour l'export de la sélection : les objets sélectionnés et les liens dont
 * les deux extrémités le sont. MCD : entités, associations, héritages, pattes et liens d'héritage ; MLD / MPD : tables
 * et traits des clés étrangères (identifiés par leur patte ou leur lien d'héritage).
 */
export function selectionIds(doc: ModelDocument, view: ViewMode, selection: readonly Id[]): Set<Id> {
  const selected = new Set(selection);
  return view === "mcd" ? mcdIds(doc, selected) : logicalIds(toLogicalModel(doc), selected);
}

function mcdIds(doc: ModelDocument, selected: Set<Id>): Set<Id> {
  const kept = new Set<Id>(
    [...doc.entities, ...doc.associations, ...doc.inheritances].map((n) => n.id).filter((id) => selected.has(id)),
  );
  for (const link of doc.links) {
    if (kept.has(link.associationId) && kept.has(link.entityId)) {
      kept.add(link.id);
    }
  }
  for (const link of doc.inheritanceLinks) {
    if (kept.has(link.inheritanceId) && kept.has(link.entityId)) {
      kept.add(link.id);
    }
  }
  return kept;
}

function logicalIds(model: LogicalModel, selected: Set<Id>): Set<Id> {
  const sourceOf = new Map(model.tables.map((t) => [t.name, t.source.id]));
  const kept = new Set<Id>(model.tables.map((t) => t.source.id).filter((id) => selected.has(id)));
  for (const table of model.tables) {
    for (const fk of table.foreignKeys) {
      const target = sourceOf.get(fk.referencedTable);
      if (kept.has(table.source.id) && target !== undefined && kept.has(target)) {
        kept.add(fk.relationId);
      }
    }
  }
  return kept;
}

/** Zone demandée ; « Sélection » sans sélection revient à la zone affichée (option désactivée). */
export const effectiveArea = (area: ExportArea, selection: readonly string[]): ExportArea =>
  area === "selection" && selection.length === 0 ? "viewport" : area;

export function areaSpec(doc: DocumentHandle, view: ViewMode, area: ExportArea): AreaSpec {
  switch (area) {
    case "viewport":
      return { kind: "viewport", ...visibleArea(doc.view.getState().viewport, canvasMetrics().canvasSize()) };
    case "selection":
      return { kind: "selection", ids: selectionIds(doc.store.getState().doc, view, doc.view.getState().selection) };
    case "all":
      return { kind: "all" };
  }
}

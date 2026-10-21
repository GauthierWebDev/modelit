import type { Id } from "@core/index";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIssuesByTarget, useLogicalModel } from "@/app/derived";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import type { DocumentHandle } from "@/app/document/handle";
import { useUiStore } from "@/app/uiStore";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { CanvasSurface } from "./CanvasSurface";
import { InlineRename, type RenameTarget } from "./InlineRename";
import { type LogicalViewMode, referenceGeometries, tableLayouts } from "./logicalGeometry";
import {
  type LogicalContext,
  type Marquee,
  onContextMenu,
  onDoubleClick,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  type PendingLink,
  type TableDrag,
} from "./logicalGestures";
import { type LogicalView, logicalOverlays, logicalShapes } from "./logicalLayers";

/**
 * Vues MLD et MPD (override O-01). Leur contenu est dérivé du MCD et leur disposition
 * est celle du MCD : déplacer une table déplace l'entité ou l'association d'origine.
 * Cliquer sur une table sélectionne l'objet du MCD d'origine (édité dans l'inspecteur).
 * Glisser dans le vide trace un rectangle de sélection (Maj : ajout), comme dans le MCD (O-57) ;
 * la vue se déplace à la molette, au pavé tactile ou au bouton du milieu.
 *
 * Outils Entité et Lien (override O-54) : créer une entité, relier deux tables (association
 * 0,n / 0,n, d'où une table de correspondance) ou une table de correspondance à une table
 * d'entité (nouvelle patte), comme dans le MCD.
 *
 * Double-clic sur le titre d'une table ou une colonne (override O-56) : renommage sur place, traduit
 * dans le MCD (nom logique, ou nom de la clé étrangère).
 *
 * Traits entre tables (override O-25) : sans flèche par défaut ; libellé facultatif (nom de la
 * clé étrangère, ou texte libre saisi sur la patte / le lien d'héritage). Cliquer sur un trait
 * sélectionne la patte ou le lien d'héritage d'origine.
 */
export function LogicalCanvas({ mode }: { mode: LogicalViewMode }) {
  const { c, view, renaming, stopRenaming } = useLogicalCanvas(mode);
  const { tool, grid, layouts } = c;
  return (
    <>
      <CanvasSurface
        grid={grid}
        className={tool === "select" ? "" : "cursor-crosshair"}
        onPointerDown={(e, point) => onPointerDown(c, e, point)}
        onPointerMove={(_, point) => onPointerMove(c, point)}
        onPointerUp={(e, point) => onPointerUp(c, e, point)}
        onContextMenu={(e) => onContextMenu(c, e)}
        onPointerCancel={() => onPointerCancel(c)}
        onDoubleClick={(_, point) => onDoubleClick(c, point)}
      >
        {logicalShapes(view)}
        {logicalOverlays(view)}
      </CanvasSurface>
      {renaming ? (
        <InlineRename
          key={JSON.stringify(renaming)}
          target={renaming}
          layouts={layouts}
          mode={mode}
          onClose={stopRenaming}
        />
      ) : null}
    </>
  );
}

/** État des vues MLD / MPD : hooks dans l'ordre d'origine, contexte des gestes et du dessin. */
function useLogicalCanvas(mode: LogicalViewMode) {
  const data = useLogicalData(mode);
  const gestures = useLogicalGestures(data.docHandle);
  const { doc, layouts } = data;
  const tableOf = (id: Id | null) => (id ? layouts.find((l) => l.sourceId === id) : undefined);

  const { relationArrows: arrows, relationLabels: labelMode } = doc.settings.display;
  const labels = useMemo(
    () => new Map([...doc.links, ...doc.inheritanceLinks].map((l) => [l.id, l.relationLabel?.trim() ?? ""])),
    [doc.links, doc.inheritanceLinks],
  );
  const c: LogicalContext = { ...data, ...gestures, mode, tableOf };
  const view: LogicalView = {
    mode,
    layouts,
    references: data.references,
    selected: data.selected,
    issues: data.issues,
    link: gestures.link,
    marquee: gestures.marquee,
    tableOf,
    arrows,
    labelMode,
    labels,
  };
  return { c, view, renaming: gestures.renaming, stopRenaming: gestures.stopRenaming };
}

/** Document, MLD dérivé, sélection, problèmes et géométrie des tables (hooks dans l'ordre d'origine). */
function useLogicalData(mode: LogicalViewMode) {
  const docHandle = useDocumentHandle();
  const doc = useDocument((s) => s.doc);
  const logical = useLogicalModel();
  const selection = useDocumentView((s) => s.selection);
  const select = useDocumentView((s) => s.select);
  const issues = useIssuesByTarget();

  const layouts = useMemo(() => tableLayouts(logical, doc, mode), [logical, doc, mode]);
  const references = useMemo(() => referenceGeometries(layouts), [layouts]);
  const selected = new Set(selection);
  const grid = doc.settings.grid.enabled ? doc.settings.grid.size : null;
  return { docHandle, doc, selection, select, issues, layouts, references, selected, grid };
}

/** État des gestes : déplacement, rectangle, outil, lien en cours, renommage (hooks dans l'ordre d'origine). */
function useLogicalGestures(docHandle: DocumentHandle) {
  /** Déplacement des tables sélectionnées : positions et cassures (traits entre deux d'entre elles) d'origine. */
  const drag = useRef<TableDrag | null>(null);
  const toggleSelected = useDocumentView((s) => s.toggleSelected);
  /** Rectangle de sélection en cours (O-57) ; `base` : sélection conservée (Maj). */
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const notify = useUiStore((s) => s.notify);
  /** Lien en cours (O-54) ; `pending` : premier clic fait, en attente du second. */
  const [link, setLink] = useState<PendingLink | null>(null);
  useEffect(() => {
    if (tool !== "link") {
      setLink(null);
    }
  }, [tool]);
  const readOnly = useSessionReadOnly(docHandle);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const stopRenaming = useCallback(() => setRenaming(null), []);
  return {
    drag,
    toggleSelected,
    marquee,
    setMarquee,
    tool,
    setTool,
    notify,
    link,
    setLink,
    readOnly,
    renaming,
    setRenaming,
    stopRenaming,
  };
}

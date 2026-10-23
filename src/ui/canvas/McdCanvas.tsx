import type { Id } from "@core/index";
import { useCallback, useEffect, useState } from "react";
import { renameAttribute, renameNode } from "@/app/commands";
import { useIssuesByTarget } from "@/app/derived";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { CanvasSurface } from "./CanvasSurface";
import { mcdRenameTarget } from "./canvasRules";
import { type NodeLayout, PAD_X, ROW_HEIGHT, TITLE_HEIGHT } from "./geometry";
import { InlineEditor } from "./InlineRename";
import { onContextMenu, onPointerCancel, onPointerMove, onPointerUp } from "./mcdDrag";
import { type Gesture, type McdContext, onPointerDown } from "./mcdGestures";
import { mcdOverlays, mcdShapes } from "./mcdLayers";
import { useMcdModel } from "./mcdModel";

/**
 * Zone graphique du MCD.
 *  - Sélection : clic, Maj+clic, rectangle de sélection, glisser pour déplacer.
 *  - Entité / Association / Héritage : clic dans le vide pour créer, puis retour à la sélection.
 *  - Clic droit avec un outil de création (dont Lien) : abandon de la création en cours et
 *    retour à l'outil Sélection (override O-16).
 *  - Lien (overrides O-02, O-08) : glisser, ou cliquer sur un objet puis sur un autre.
 *    Entité → autre entité crée l'association entre les deux ; entité → elle-même crée une
 *    association réflexive ; association ↔ entité crée une patte (une seule par couple) ;
 *    héritage ↔ entité crée un lien d'héritage (override O-18).
 *    Clic dans le vide ou Échap : abandon.
 *  - Cassures (override O-10) : sur un lien sélectionné, glisser un milieu de segment crée
 *    une cassure, glisser une cassure la déplace. Une cassure cliquée est sélectionnée :
 *    Suppr, son bouton ×, un clic droit ou un double-clic la suppriment (elle seule).
 *  - Pastille d'erreur (override O-15) : survol = problèmes de l'objet ; clic = onglet Problèmes.
 */

export function McdCanvas() {
  const { c, doc, model, issues, readOnly, renaming, setRenaming, stopRenaming } = useMcdCanvas();
  const { tool, gesture, activeBend, grid, layouts, select } = c;
  return (
    <>
      <CanvasSurface
        grid={grid}
        remoteBoxes={layouts}
        className={tool === "select" ? "" : "cursor-crosshair"}
        onDoubleClick={(_, point) => {
          if (tool !== "select" || readOnly) {
            return;
          }
          const target = mcdRenameTarget(doc, layouts, point);
          if (!target) {
            return;
          }
          select([target.nodeId]);
          setRenaming(target);
        }}
        onPointerDown={(e, point) => onPointerDown(c, e, point)}
        onPointerMove={(_, point) => onPointerMove(c, point)}
        onPointerUp={(e, point) => onPointerUp(c, e, point)}
        onPointerCancel={() => onPointerCancel(c)}
        onContextMenu={(e) => onContextMenu(c, e)}
      >
        {mcdShapes(doc, model, gesture, issues)}
        {mcdOverlays(doc, model, gesture, activeBend)}
      </CanvasSurface>
      {renaming ? (
        <McdRename
          key={`${renaming.nodeId}:${renaming.attributeId}`}
          target={renaming}
          layouts={layouts}
          onClose={stopRenaming}
        />
      ) : null}
    </>
  );
}

/** État du canevas MCD : hooks dans l'ordre d'origine, contexte des gestes reconstruit à chaque rendu. */
function useMcdCanvas() {
  const docHandle = useDocumentHandle();
  const doc = useDocument((s) => s.doc);
  const { tool, setTool, notify } = useUiStore();
  const { selection, select, toggleSelected, activeBend, setActiveBend } = useDocumentView((s) => s);
  const issues = useIssuesByTarget();
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const readOnly = useSessionReadOnly(docHandle);
  /** Renommage sur place (override O-58) : nom de l'objet (`attributeId` nul) ou d'une rubrique. */
  const [renaming, setRenaming] = useState<{ nodeId: Id; attributeId: Id | null } | null>(null);
  const stopRenaming = useCallback(() => setRenaming(null), []);
  const model = useMcdModel(doc, selection);
  const { layouts, selected } = model;
  const grid = doc.settings.grid.enabled ? doc.settings.grid.size : null;

  // Changer d'outil (ex. Échap) abandonne un lien en cours.
  // biome-ignore lint/correctness/useExhaustiveDependencies: abandonner le lien en cours quand l'outil change
  useEffect(() => setGesture((g) => (g?.type === "link" ? null : g)), [tool]);

  const c: McdContext = {
    docHandle,
    doc,
    tool,
    setTool,
    notify,
    selection,
    selected,
    select,
    toggleSelected,
    activeBend,
    setActiveBend,
    gesture,
    setGesture,
    grid,
    layouts,
  };
  return { c, doc, model, issues, readOnly, renaming, setRenaming, stopRenaming };
}

/** Champ de renommage d'un nom d'entité / association ou d'une rubrique (override O-58). */
function McdRename({
  target,
  layouts,
  onClose,
}: {
  target: { nodeId: Id; attributeId: Id | null };
  layouts: Map<Id, NodeLayout>;
  onClose: () => void;
}) {
  const docHandle = useDocumentHandle();
  const node = useDocument((s) => [...s.doc.entities, ...s.doc.associations].find((n) => n.id === target.nodeId));
  const l = layouts.get(target.nodeId);
  const row = target.attributeId ? l?.rows.find((r) => r.attribute.id === target.attributeId) : undefined;
  const missing = !(node && l) || (target.attributeId !== null && !row);
  useEffect(() => {
    if (missing) {
      onClose();
    }
  }, [missing, onClose]);
  if (missing) {
    return null;
  }
  const box = row
    ? { x: l.x + PAD_X - 3, y: l.y + row.y, width: l.width - PAD_X - 2 + 3, height: ROW_HEIGHT }
    : { x: l.x + 2, y: l.y + 2, width: l.width - 4, height: TITLE_HEIGHT - 4 };
  return (
    <InlineEditor
      box={box}
      value={row ? row.attribute.name : node.name}
      title={!row}
      onClose={onClose}
      commit={(value) => {
        if (!row) {
          return renameNode(docHandle, node.id, value);
        }
        const error = renameAttribute(docHandle, node.id, row.attribute.id, value);
        if (!error) {
          useUiStore.getState().showAttribute(row.attribute.id);
        }
        return error;
      }}
    />
  );
}

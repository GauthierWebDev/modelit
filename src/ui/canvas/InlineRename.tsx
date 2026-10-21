import { displayedSqlType, type Id, type LogicalColumn, sameDialect, targetOf } from "@core/index";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { renameLogical, setColumnSqlType } from "@/app/commands";
import { useLogicalModel } from "@/app/derived";
import { useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { FONT_FAMILY, FONT_SIZE, PAD_X, ROW_HEIGHT, TITLE_HEIGHT, TITLE_WEIGHT } from "./geometry";
import type { LogicalViewMode, TableLayout } from "./logicalGeometry";

/**
 * Ce qu'on renomme dans le MLD / MPD (override O-56) : le titre d'une table (`column` nul) ou une
 * colonne, désignée par sa rubrique ou par sa patte d'origine, stables d'un rendu à l'autre (le nom,
 * lui, change avec la saisie).
 */
export interface RenameTarget {
  sourceId: Id;
  column: { attributeId: Id } | { linkId: Id; originId: Id } | null;
  /** MPD : type SQL de la colonne plutôt que son nom (O-59). */
  part?: "type";
}

/** Cible d'une colonne, si elle se renomme (rubrique, ou clé étrangère issue d'une patte). */
export function columnTarget(sourceId: Id, column: LogicalColumn): RenameTarget | null {
  if (column.origin) {
    return { sourceId, column: { linkId: column.origin.linkId, originId: column.origin.attributeId } };
  }
  if (column.attributeId) {
    return { sourceId, column: { attributeId: column.attributeId } };
  }
  return null;
}

const matches = (target: NonNullable<RenameTarget["column"]>, column: LogicalColumn) =>
  "attributeId" in target
    ? column.attributeId === target.attributeId
    : column.origin?.linkId === target.linkId && column.origin.attributeId === target.originId;

/** Zone du champ, en coordonnées du modèle. */
export interface EditorBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Champ de renommage posé sur le schéma, au-dessus du canevas : il suit le zoom et le défilement.
 * Entrée ou la perte du focus valident ; Échap annule. `commit` renvoie le message d'un nom refusé,
 * affiché dans la barre d'état ; avec Entrée, le champ reste alors ouvert pour corriger.
 */
export function InlineEditor({
  box,
  value,
  placeholder,
  title,
  commit,
  onClose,
}: {
  box: EditorBox;
  value: string;
  placeholder?: string;
  /** Titre : gras et centré. */
  title: boolean;
  commit: (value: string) => string | null;
  onClose: () => void;
}) {
  const viewport = useDocumentView((s) => s.viewport);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const accept = (): boolean => {
    const error = commit(input.current!.value);
    if (error) {
      useUiStore.getState().notify({ kind: "error", text: error });
    }
    return !error;
  };
  const close = () => {
    done.current = true;
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Les raccourcis du schéma (Suppr, Échap, flèches…) ne s'appliquent pas pendant la saisie.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      if (accept()) {
        close();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <input
      ref={input}
      defaultValue={value}
      placeholder={placeholder}
      spellCheck={false}
      aria-label={value}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (done.current) {
          return;
        }
        accept();
        close();
      }}
      style={{
        left: box.x * viewport.zoom + viewport.x,
        top: box.y * viewport.zoom + viewport.y,
        width: Math.max(box.width, 60) * viewport.zoom,
        height: box.height * viewport.zoom,
        fontSize: FONT_SIZE * viewport.zoom,
        fontFamily: FONT_FAMILY,
        fontWeight: title ? TITLE_WEIGHT : undefined,
        textAlign: title ? "center" : undefined,
      }}
      className="absolute z-10 rounded-sm border border-blue-500 bg-white px-[3px] text-neutral-900 outline-none dark:bg-neutral-800 dark:text-neutral-100"
    />
  );
}

/** Renommage d'un titre de table ou d'une colonne du MLD / MPD (override O-56). */
export function InlineRename({
  target,
  layouts,
  mode,
  onClose,
}: {
  target: RenameTarget;
  layouts: TableLayout[];
  mode: LogicalViewMode;
  onClose: () => void;
}) {
  const doc = useDocumentHandle();
  const logical = useLogicalModel();
  const layout = layouts.find((l) => l.sourceId === target.sourceId);
  const row = target.column && layout?.rows.find((r) => matches(target.column!, r.column));
  const missing = !layout || (target.column !== null && !row);
  useEffect(() => {
    if (missing) {
      onClose();
    }
  }, [missing, onClose]);
  if (missing) {
    return null;
  }

  if (target.part === "type" && row?.column.attributeId) {
    const { attributeId } = row.column;
    const { settings } = doc.store.getState().doc;
    return (
      <InlineEditor
        box={{
          x: layout.x + layout.typeX - 3,
          y: layout.y + row.y,
          width: layout.constraintsX - layout.typeX - 2,
          height: ROW_HEIGHT,
        }}
        value={
          row.column.sourceType && sameDialect(row.column.sourceType.dialect, settings.dbms)
            ? row.column.sourceType.sql
            : ""
        }
        placeholder={displayedSqlType({ type: row.column.type }, targetOf(settings)) ?? undefined}
        title={false}
        onClose={onClose}
        commit={(value) => {
          const error = setColumnSqlType(doc, layout.sourceId, attributeId, value);
          if (!error) {
            useUiStore.getState().showAttribute(attributeId);
          }
          return error;
        }}
      />
    );
  }

  // Ligne : du début du nom jusqu'au type (MPD) ou au bord de la table ; titre : toute la largeur.
  const left = row ? PAD_X + row.indent - 3 : 2;
  const box = row
    ? {
        x: layout.x + left,
        y: layout.y + row.y,
        width: (mode === "mpd" ? layout.typeX - 4 : layout.width - 2) - left,
        height: ROW_HEIGHT,
      }
    : { x: layout.x + left, y: layout.y + 2, width: layout.width - 4, height: TITLE_HEIGHT - 4 };
  return (
    <InlineEditor
      box={box}
      value={row ? row.column.name : layout.table.name}
      placeholder={row?.column.origin?.defaultName}
      title={!row}
      onClose={onClose}
      commit={(value) => {
        const error = renameLogical(doc, logical, layout.table, row?.column ?? null, value);
        if (!error && row?.column.attributeId) {
          useUiStore.getState().showAttribute(row.column.attributeId);
        }
        return error;
      }}
    />
  );
}

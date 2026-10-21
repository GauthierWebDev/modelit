import {
  displayedSqlType,
  type Id,
  type LogicalColumn,
  type LogicalForeignKey,
  type LogicalModel,
  type LogicalTable,
  type ModelDocument,
  type Point,
  targetOf,
  uniqueColumnNames,
} from "@core/index";
import {
  BOLD_WEIGHT,
  center,
  clipToRect,
  PAD_X,
  type Rect,
  ROW_HEIGHT,
  type TextStyle,
  TITLE_HEIGHT,
  TITLE_WEIGHT,
  textWidth,
} from "./geometry";

/**
 * Mise en page des vues MLD et MPD (override O-01).
 *
 * Disposition commune aux trois vues (override O-01) : une table a pour coin haut-gauche
 * la position de l'entité ou de l'association dont elle est issue.
 * Notation Merise : clé primaire en gras soulignée, colonne unique en gras, clé étrangère
 * préfixée par `#`, en italique et en couleur (les marques se cumulent),
 * flèche de la table qui porte la clé étrangère vers la table référencée.
 * Clé primaire composée (override O-14) : colonnes de la clé en tête, en retrait,
 * réunies par un trait vertical sur la tranche gauche.
 */

export type LogicalViewMode = "mld" | "mpd";

export interface TableRow {
  column: LogicalColumn;
  primaryKey: boolean;
  /** Colonne unique à elle seule (UNIQUE, ou contrainte d'unicité sur cette seule colonne entière). */
  unique: boolean;
  /** Texte affiché pour le nom : `#` devant une clé étrangère. */
  label: string;
  /** MPD : type SQL du SGBD cible. */
  type: string | null;
  /** MPD : contraintes de colonne (NOT NULL, UNIQUE, complément). */
  constraints: string | null;
  /** Décalage du nom : colonnes d'une clé primaire composée. */
  indent: number;
  y: number;
}

export interface TableLayout extends Rect {
  table: LogicalTable;
  /** Objet du MCD d'origine : c'est lui qui est sélectionné et édité. */
  sourceId: Id;
  rows: TableRow[];
  /** Abscisses (relatives) des colonnes type et contraintes, en MPD. */
  typeX: number;
  constraintsX: number;
  /** Clé primaire composée : étendue verticale (relative) du trait sur la tranche. */
  compositeKey: { top: number; bottom: number } | null;
}

/** Retrait des colonnes d'une clé primaire composée et position du trait sur la tranche. */
export const KEY_INDENT = 10;
export const KEY_BAR_X = 6;

const COLUMN_GAP = 18;
const MIN_WIDTH = 120;

/** Colonnes de la clé primaire d'abord (dans l'ordre de la clé), puis les autres. */
function orderedColumns(table: LogicalTable): LogicalColumn[] {
  const key = table.primaryKey.flatMap((name) => table.columns.filter((c) => c.name === name).slice(0, 1));
  return [...key, ...table.columns.filter((c) => !key.includes(c))];
}

/** Style du nom d'une colonne : gras (clé primaire, unique), italique (clé étrangère). */
export function columnStyle(row: Pick<TableRow, "column" | "primaryKey" | "unique">): TextStyle {
  return { weight: row.primaryKey || row.unique ? BOLD_WEIGHT : 400, italic: row.column.foreign };
}

function rowsOf(table: LogicalTable, mode: LogicalViewMode, doc: ModelDocument): Omit<TableRow, "y">[] {
  const target = targetOf(doc.settings);
  const composite = table.primaryKey.length > 1;
  const uniqueColumns = uniqueColumnNames(table);
  return orderedColumns(table).map((column) => {
    const primaryKey = table.primaryKey.includes(column.name);
    const unique = uniqueColumns.has(column.name);
    const indent = composite && primaryKey ? KEY_INDENT : 0;
    const label = `${column.foreign ? "#" : ""}${column.name}`;
    if (mode === "mld") {
      return { column, primaryKey, unique, label, indent, type: null, constraints: null };
    }
    const constraints = [
      // Une colonne de clé primaire est NOT NULL de fait : le MPD le montre.
      column.notNull || primaryKey ? "NOT NULL" : null,
      column.unique ? "UNIQUE" : null,
      column.complement?.trim() || null,
    ].filter(Boolean);
    return {
      column,
      primaryKey,
      unique,
      label,
      indent,
      type: displayedSqlType(column, target),
      constraints: constraints.length ? constraints.join(" ") : null,
    };
  });
}

export function tableLayouts(model: LogicalModel, doc: ModelDocument, mode: LogicalViewMode): TableLayout[] {
  const positions = doc.layout.positions;
  return model.tables.map((table) => {
    const raw = rowsOf(table, mode, doc);
    const nameWidth = Math.max(0, ...raw.map((r) => r.indent + textWidth(r.label, columnStyle(r))));
    const typeWidth = Math.max(0, ...raw.map((r) => (r.type ? textWidth(r.type) : 0)));
    const constraintsWidth = Math.max(0, ...raw.map((r) => (r.constraints ? textWidth(r.constraints) : 0)));
    const typeX = PAD_X + nameWidth + COLUMN_GAP;
    const constraintsX = typeX + (typeWidth ? typeWidth + COLUMN_GAP : 0);
    const contentWidth = mode === "mpd" ? constraintsX + constraintsWidth + PAD_X : nameWidth + 2 * PAD_X;
    const width = Math.ceil(
      Math.max(MIN_WIDTH, contentWidth, textWidth(table.name, { weight: TITLE_WEIGHT }) + 2 * PAD_X),
    );
    const rows = raw.map((r, i) => ({ ...r, y: TITLE_HEIGHT + 4 + i * ROW_HEIGHT }));
    const height = TITLE_HEIGHT + 4 + Math.max(1, rows.length) * ROW_HEIGHT + 6;
    const position = positions[table.source.id] ?? { x: 0, y: 0 };
    const keyRows = rows.filter((r) => r.primaryKey);
    const compositeKey =
      table.primaryKey.length > 1 && keyRows.length > 1
        ? { top: keyRows[0]!.y + 2, bottom: keyRows.at(-1)!.y + ROW_HEIGHT - 2 }
        : null;
    return { ...position, width, height, table, sourceId: table.source.id, rows, typeX, constraintsX, compositeKey };
  });
}

export interface ReferenceGeometry {
  key: string;
  /** Table qui porte la clé étrangère. */
  sourceId: Id;
  /** Patte ou lien d'héritage d'où vient la clé : sélectionnable, porte le texte libre (O-25). */
  relationId: Id;
  fk: LogicalForeignKey;
  /** Tracé SVG du trait (table qui porte la clé → table référencée). */
  path: string;
  /** Point d'ancrage du libellé (milieu du trait, ou haut de la boucle). */
  label: Point;
}

/** Traits des clés étrangères ; plusieurs traits entre deux mêmes tables sont décalés. */
export function referenceGeometries(layouts: TableLayout[]): ReferenceGeometry[] {
  const byName = new Map(layouts.map((l) => [l.table.name, l]));
  const counts = new Map<string, number>();
  const result: ReferenceGeometry[] = [];
  for (const from of layouts) {
    from.table.foreignKeys.forEach((fk, i) => {
      const to = byName.get(fk.referencedTable);
      if (!to) {
        return;
      }
      const key = `${from.table.name}->${to.table.name}`;
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      const base = { key: `${key}#${i}`, sourceId: from.sourceId, relationId: fk.relationId, fk };
      if (to === from) {
        // Auto-référence : boucle du côté droit vers le bord supérieur.
        const x = from.x + from.width;
        const y = from.y + TITLE_HEIGHT + index * 10;
        const top = from.y - 20 - index * 10;
        const left = x - 30 - index * 10;
        const right = x + 28 + index * 10;
        result.push({
          ...base,
          path: `M${x},${y} H${right} V${top} H${left} V${from.y}`,
          label: { x: (left + right) / 2, y: top },
        });
        return;
      }
      const offset = index * 14;
      const cf = center(from);
      const ct = center(to);
      const len = Math.hypot(ct.x - cf.x, ct.y - cf.y) || 1;
      const nx = (-(ct.y - cf.y) / len) * offset;
      const ny = ((ct.x - cf.x) / len) * offset;
      const a = clipToRect(from, { x: ct.x + nx, y: ct.y + ny });
      const b = clipToRect(to, { x: cf.x + nx, y: cf.y + ny });
      result.push({
        ...base,
        path: `M${a.x + nx},${a.y + ny} L${b.x + nx},${b.y + ny}`,
        label: { x: (a.x + b.x) / 2 + nx, y: (a.y + b.y) / 2 + ny },
      });
    });
  }
  return result;
}

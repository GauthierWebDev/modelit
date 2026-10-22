import type { Id, Issue, RelationLabelMode } from "@core/index";
import { t } from "@/i18n";
import { FONT_FAMILY, FONT_SIZE, normalizeRect, PAD_X, ROW_HEIGHT, TITLE_HEIGHT, TITLE_WEIGHT } from "./geometry";
import {
  columnStyle,
  KEY_BAR_X,
  type LogicalViewMode,
  type ReferenceGeometry,
  type TableLayout,
} from "./logicalGeometry";
import type { Marquee, PendingLink } from "./logicalGestures";
import { ErrorBadge } from "./shapes";

/** Ce que dessinent les vues MLD / MPD (calculé à chaque rendu du canevas). */
export interface LogicalView {
  mode: LogicalViewMode;
  layouts: TableLayout[];
  references: ReferenceGeometry[];
  selected: Set<Id>;
  issues: Map<Id, Issue[]>;
  link: PendingLink | null;
  marquee: Marquee | null;
  tableOf: (id: Id | null) => TableLayout | undefined;
  arrows: boolean;
  labelMode: RelationLabelMode;
  labels: Map<Id, string>;
}

/** Traits entre tables, tables, lien en cours. */
export function logicalShapes(v: LogicalView) {
  const { mode, layouts, references, selected, issues, link, tableOf, arrows } = v;
  return (
    <>
      {references.map((r) => {
        const active = selected.has(r.relationId) || selected.has(r.sourceId);
        return (
          <g key={r.key} data-id={r.relationId} className="cursor-pointer">
            {/* Zone de clic élargie */}
            <path d={r.path} fill="none" stroke="transparent" strokeWidth={12} />
            <path
              d={r.path}
              fill="none"
              stroke={active ? "var(--mcd-selection)" : "var(--mcd-link)"}
              strokeWidth={active ? 2 : 1.25}
              markerEnd={arrows ? (active ? "url(#arrow-selected)" : "url(#arrow)") : undefined}
            />
          </g>
        );
      })}
      {layouts.map((l) => (
        <TableShape
          key={l.sourceId}
          layout={l}
          mode={mode}
          selected={selected.has(l.sourceId) || link?.fromId === l.sourceId}
          issues={issues.get(l.sourceId)}
        />
      ))}
      {link && tableOf(link.fromId) && (
        <line
          x1={tableOf(link.fromId)!.x + tableOf(link.fromId)!.width / 2}
          y1={tableOf(link.fromId)!.y + tableOf(link.fromId)!.height / 2}
          x2={link.current.x}
          y2={link.current.y}
          stroke="var(--mcd-selection)"
          strokeDasharray="4 3"
          pointerEvents="none"
          data-ui-only=""
        />
      )}
    </>
  );
}

/** Libellés des traits (au-dessus des tables) et rectangle de sélection. */
export function logicalOverlays(v: LogicalView) {
  const { references, selected, marquee, labelMode, labels } = v;
  return (
    <>
      {/* Libellés des traits, au-dessus des tables pour rester lisibles. */}
      {references.map((r) => {
        const label = relationLabel(r, labelMode, labels);
        if (!label) {
          return null;
        }
        const active = selected.has(r.relationId) || selected.has(r.sourceId);
        return (
          <text
            key={`label-${r.key}`}
            data-id={r.relationId}
            className="cursor-pointer"
            x={r.label.x}
            y={r.label.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT_FAMILY}
            fontSize={FONT_SIZE - 1}
            fill={active ? "var(--mcd-selection)" : "var(--mcd-muted)"}
            fontStyle={labelMode === "text" ? "italic" : undefined}
            paintOrder="stroke"
            stroke="var(--mcd-canvas)"
            strokeWidth={4}
          >
            {label}
          </text>
        );
      })}
      {marquee ? (
        <rect
          {...normalizeRect(marquee.start, marquee.current)}
          fill="var(--mcd-selection)"
          fillOpacity={0.08}
          stroke="var(--mcd-selection)"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          data-ui-only=""
        />
      ) : null}
    </>
  );
}

export function TableShape({
  layout,
  mode,
  selected,
  issues,
}: {
  layout: TableLayout;
  mode: LogicalViewMode;
  selected: boolean;
  issues: Issue[] | undefined;
}) {
  const { x, y, width, height, table } = layout;
  return (
    <g data-id={layout.sourceId} className="cursor-move" fontFamily={FONT_FAMILY} fontSize={FONT_SIZE}>
      <rect x={x} y={y} width={width} height={height} fill="var(--mcd-table-body)" />
      <rect x={x} y={y} width={width} height={TITLE_HEIGHT} fill="var(--mcd-table-title)" />
      <line x1={x} x2={x + width} y1={y + TITLE_HEIGHT} y2={y + TITLE_HEIGHT} stroke="var(--mcd-table-stroke)" />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke={selected ? "var(--mcd-selection)" : "var(--mcd-table-stroke)"}
        strokeWidth={selected ? 2.5 : 1.25}
      />
      <text
        x={x + width / 2}
        y={y + TITLE_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontWeight={TITLE_WEIGHT}
        fill="var(--mcd-text)"
      >
        {table.name}
      </text>
      {layout.compositeKey ? (
        <line
          x1={x + KEY_BAR_X}
          x2={x + KEY_BAR_X}
          y1={y + layout.compositeKey.top}
          y2={y + layout.compositeKey.bottom}
          stroke="var(--mcd-text)"
          strokeWidth={1.5}
          data-tooltip={t("canvas.compositeKey")}
        />
      ) : null}
      {tableRows(layout, mode)}
      <ErrorBadge x={x + width} y={y} issues={issues} layer="logical" />
    </g>
  );
}

/** Colonnes d'une table : nom (souligné si clé primaire, coloré si clé étrangère) et type en MPD. */
function tableRows(layout: TableLayout, mode: LogicalViewMode) {
  const { x, y, rows } = layout;
  return rows.map((r) => {
    const cy = y + r.y + ROW_HEIGHT / 2;
    const style = columnStyle(r);
    return (
      <g key={r.column.name}>
        <text
          x={x + PAD_X + r.indent}
          y={cy}
          dominantBaseline="central"
          fill={r.column.foreign ? "var(--mcd-foreign)" : "var(--mcd-text)"}
          textDecoration={r.primaryKey ? "underline" : undefined}
          fontWeight={style.weight}
          fontStyle={style.italic ? "italic" : undefined}
        >
          {r.label}
        </text>
        {mode === "mpd" && r.type && (
          <text x={x + layout.typeX} y={cy} dominantBaseline="central" fill="var(--mcd-muted)">
            {r.type}
          </text>
        )}
        {mode === "mpd" && r.constraints && (
          <text
            x={x + layout.constraintsX}
            y={cy}
            dominantBaseline="central"
            fill="var(--mcd-muted)"
            fontSize={FONT_SIZE - 2}
          >
            {r.constraints}
          </text>
        )}
      </g>
    );
  });
}

/** Libellé d'un trait selon le réglage « Texte sur les liens » (override O-25). */
export function relationLabel(r: ReferenceGeometry, mode: RelationLabelMode, texts: Map<Id, string>): string {
  if (mode === "foreignKey") {
    return r.fk.columns.join(", ");
  }
  if (mode === "text") {
    return texts.get(r.relationId) ?? "";
  }
  return "";
}

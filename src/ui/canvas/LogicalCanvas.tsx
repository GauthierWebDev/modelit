import type { Id, Issue, Point, RelationLabelMode } from "@core/index";
import { useMemo, useRef } from "react";
import { useIssuesByTarget, useLogicalModel } from "@/app/derived";
import { t } from "@/i18n";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { revealSection } from "@/app/dock/actions";
import { CanvasSurface, hitId } from "./CanvasSurface";
import { FONT_FAMILY, FONT_SIZE, PAD_X, ROW_HEIGHT, snap, TITLE_HEIGHT, TITLE_WEIGHT } from "./geometry";
import {
  columnStyle,
  KEY_BAR_X,
  referenceGeometries,
  tableLayouts,
  type LogicalViewMode,
  type ReferenceGeometry,
  type TableLayout,
} from "./logicalGeometry";
import { ErrorBadge } from "./shapes";

/**
 * Vues MLD et MPD (override O-01). Leur contenu est dérivé du MCD et leur disposition
 * est celle du MCD : déplacer une table déplace l'entité ou l'association d'origine.
 * Cliquer sur une table sélectionne l'objet du MCD d'origine (édité dans l'inspecteur).
 * Glisser dans le vide déplace la vue.
 *
 * Traits entre tables (override O-25) : sans flèche par défaut ; libellé facultatif (nom de la
 * clé étrangère, ou texte libre saisi sur la patte / le lien d'héritage). Cliquer sur un trait
 * sélectionne la patte ou le lien d'héritage d'origine.
 */
export function LogicalCanvas({ mode }: { mode: LogicalViewMode }) {
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
  const drag = useRef<{ id: Id; start: Point; origin: Point } | null>(null);
  const { relationArrows: arrows, relationLabels: labelMode } = doc.settings.display;
  const labels = useMemo(
    () => new Map([...doc.links, ...doc.inheritanceLinks].map((l) => [l.id, l.relationLabel?.trim() ?? ""])),
    [doc.links, doc.inheritanceLinks],
  );

  return (
    <CanvasSurface
      grid={grid}
      panOnEmpty
      onPointerDown={(e, point) => {
        const hit = hitId(e);
        select(hit ? [hit] : []);
        if (hit && (e.target as Element).closest("[data-badge]")) {
          revealSection("issues");
          return true;
        }
        if (!hit) return false;
        const layout = layouts.find((l) => l.sourceId === hit);
        if (!layout) return true; // trait entre tables : sélection seule
        docHandle.store.getState().begin();
        drag.current = { id: hit, start: point, origin: { x: layout.x, y: layout.y } };
        return true;
      }}
      onPointerMove={(_, point) => {
        const d = drag.current;
        if (!d) return;
        const position = { x: snap(d.origin.x + point.x - d.start.x, grid), y: snap(d.origin.y + point.y - d.start.y, grid) };
        docHandle.store.getState().preview((draft) => void (draft.layout.positions[d.id] = position));
      }}
      onPointerUp={() => {
        if (drag.current) docHandle.store.getState().commit("history.moveTable");
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current) docHandle.store.getState().cancel();
        drag.current = null;
      }}
    >
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
        <TableShape key={l.sourceId} layout={l} mode={mode} selected={selected.has(l.sourceId)} issues={issues.get(l.sourceId)} />
      ))}
      {/* Libellés des traits, au-dessus des tables pour rester lisibles. */}
      {references.map((r) => {
        const label = relationLabel(r, labelMode, labels);
        if (!label) return null;
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
    </CanvasSurface>
  );
}

function TableShape({
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
  const { x, y, width, height, rows, table } = layout;
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
      <text x={x + width / 2} y={y + TITLE_HEIGHT / 2} textAnchor="middle" dominantBaseline="central" fontWeight={TITLE_WEIGHT} fill="var(--mcd-text)">
        {table.name}
      </text>
      {layout.compositeKey && (
        <line
          x1={x + KEY_BAR_X}
          x2={x + KEY_BAR_X}
          y1={y + layout.compositeKey.top}
          y2={y + layout.compositeKey.bottom}
          stroke="var(--mcd-text)"
          strokeWidth={1.5}
          data-tooltip={t("canvas.compositeKey")}
        />
      )}
      {rows.map((r) => {
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
              <text x={x + layout.constraintsX} y={cy} dominantBaseline="central" fill="var(--mcd-muted)" fontSize={FONT_SIZE - 2}>
                {r.constraints}
              </text>
            )}
          </g>
        );
      })}
      <ErrorBadge x={x + width} y={y} issues={issues} layer="logical" />
    </g>
  );
}

/** Libellé d'un trait selon le réglage « Texte sur les liens » (override O-25). */
function relationLabel(r: ReferenceGeometry, mode: RelationLabelMode, texts: Map<Id, string>): string {
  if (mode === "foreignKey") return r.fk.columns.join(", ");
  if (mode === "text") return texts.get(r.relationId) ?? "";
  return "";
}

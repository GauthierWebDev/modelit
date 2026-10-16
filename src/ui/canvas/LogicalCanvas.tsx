import { bendsOf, diagramLinks, linkSourceId, positionOf, setBends, type Id, type Issue, type Point, type RelationLabelMode } from "@core/index";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addEntity, connectNodes } from "@/app/commands";
import { useUiStore } from "@/app/uiStore";
import { useIssuesByTarget, useLogicalModel } from "@/app/derived";
import { t } from "@/i18n";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { revealSection } from "@/app/dock/actions";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { CanvasSurface, hitId, hitIdAt } from "./CanvasSurface";
import { columnTarget, InlineRename, type RenameTarget } from "./InlineRename";
import { openCanvasMenu } from "./objectActions";
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
  /** Déplacement des tables sélectionnées : positions et cassures (traits entre deux d'entre elles) d'origine. */
  const drag = useRef<{ start: Point; origins: Map<Id, Point>; bends: Map<Id, Point[]> } | null>(null);
  const toggleSelected = useDocumentView((s) => s.toggleSelected);
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const notify = useUiStore((s) => s.notify);
  /** Lien en cours (O-54) ; `pending` : premier clic fait, en attente du second. */
  const [link, setLink] = useState<{ fromId: Id; start: Point; current: Point; pending: boolean } | null>(null);
  useEffect(() => {
    if (tool !== "link") setLink(null);
  }, [tool]);
  const readOnly = useSessionReadOnly(docHandle);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const stopRenaming = useCallback(() => setRenaming(null), []);
  const tableOf = (id: Id | null) => (id ? layouts.find((l) => l.sourceId === id) : undefined);

  function connect(fromId: Id, toId: Id | null) {
    setLink(null);
    const a = tableOf(fromId);
    const b = tableOf(toId);
    if (!a || !b || !toId) return;
    // L'association (invisible ici) se place entre les deux tables, ou à droite d'une réflexive.
    const position =
      fromId === toId
        ? { x: snap(a.x + a.width + 60, grid), y: snap(a.y, grid) }
        : { x: snap((a.x + a.width / 2 + b.x + b.width / 2) / 2 - 40, grid), y: snap((a.y + a.height / 2 + b.y + b.height / 2) / 2 - 20, grid) };
    const result = connectNodes(docHandle, fromId, toId, { associationPosition: position });
    if (!result) return;
    if ("error" in result) notify({ kind: "error", text: result.error });
    else select([result.created]);
  }
  const { relationArrows: arrows, relationLabels: labelMode } = doc.settings.display;
  const labels = useMemo(
    () => new Map([...doc.links, ...doc.inheritanceLinks].map((l) => [l.id, l.relationLabel?.trim() ?? ""])),
    [doc.links, doc.inheritanceLinks],
  );

  /** Titre ou colonne sous le point (O-56) : cible du renommage. */
  function renameTargetAt(point: Point): RenameTarget | null {
    const layout = layouts.findLast((l) => point.x >= l.x && point.x <= l.x + l.width && point.y >= l.y && point.y <= l.y + l.height);
    if (!layout) return null;
    const dy = point.y - layout.y;
    if (dy < TITLE_HEIGHT) return { sourceId: layout.sourceId, column: null };
    const row = layout.rows.find((r) => dy >= r.y && dy < r.y + ROW_HEIGHT);
    return row ? columnTarget(layout.sourceId, row.column) : null;
  }

  return (
    <>
    <CanvasSurface
      grid={grid}
      panOnEmpty
      className={tool === "select" ? "" : "cursor-crosshair"}
      onPointerDown={(e, point) => {
        const hit = hitId(e);
        const table = tableOf(hit)?.sourceId ?? null;
        if (tool === "entity") {
          if (!hit) {
            select([addEntity(docHandle, { x: snap(point.x, grid), y: snap(point.y, grid) })]);
            setTool("select");
          }
          return true;
        }
        if (tool === "link") {
          if (link?.pending) {
            if (table) connect(link.fromId, table);
            else setLink(null);
          } else if (table) setLink({ fromId: table, start: point, current: point, pending: false });
          return true;
        }
        // Maj + clic : ajoute ou retire de la sélection (O-57, comme dans le MCD).
        if (hit && e.shiftKey) {
          toggleSelected(hit);
          return true;
        }
        const ids = hit && selected.has(hit) ? selection : hit ? [hit] : [];
        if (!(hit && selected.has(hit))) select(ids);
        if (hit && (e.target as Element).closest("[data-badge]")) {
          revealSection("issues");
          return true;
        }
        if (!hit) return false;
        if (!tableOf(hit)) return true; // trait entre tables : sélection seule
        const moved = new Set(ids.filter((id) => tableOf(id)));
        const origins = new Map([...moved].map((id) => [id, positionOf(doc.layout, id)]));
        const bends = new Map<Id, Point[]>();
        for (const l of diagramLinks(doc)) if (moved.has(linkSourceId(l)) && moved.has(l.entityId)) bends.set(l.id, bendsOf(doc.layout, l.id));
        docHandle.store.getState().begin();
        drag.current = { start: point, origins, bends };
        return true;
      }}
      onPointerMove={(_, point) => {
        if (link) setLink({ ...link, current: point });
        const d = drag.current;
        if (!d) return;
        const dx = point.x - d.start.x;
        const dy = point.y - d.start.y;
        docHandle.store.getState().preview((draft) => {
          for (const [id, o] of d.origins) draft.layout.positions[id] = { x: snap(o.x + dx, grid), y: snap(o.y + dy, grid) };
          for (const [id, points] of d.bends) setBends(draft.layout, id, points.map((b) => ({ x: snap(b.x + dx, grid), y: snap(b.y + dy, grid) })));
        });
      }}
      onPointerUp={(e, point) => {
        if (link && !link.pending) {
          // Glisser : relier à la table sous le pointeur ; simple clic : attendre le second clic.
          const dragged = Math.hypot(point.x - link.start.x, point.y - link.start.y) > 4;
          if (dragged) connect(link.fromId, tableOf(hitIdAt(e))?.sourceId ?? null);
          else setLink({ ...link, pending: true });
        }
        if (drag.current) docHandle.store.getState().commit(drag.current.origins.size > 1 ? "history.moveSelection" : "history.moveTable");
        drag.current = null;
      }}
      onContextMenu={(e) => {
        // Outil de création : abandon et retour à la sélection (override O-16) ; sinon, menu (O-53).
        if (tool === "select") return openCanvasMenu(docHandle, e, hitIdAt(e));
        e.preventDefault();
        setLink(null);
        setTool("select");
      }}
      onPointerCancel={() => {
        if (drag.current) docHandle.store.getState().cancel();
        drag.current = null;
      }}
      onDoubleClick={(_, point) => {
        if (tool !== "select" || readOnly) return;
        const target = renameTargetAt(point);
        if (!target) return;
        select([target.sourceId]);
        setRenaming(target);
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
        <TableShape key={l.sourceId} layout={l} mode={mode} selected={selected.has(l.sourceId) || link?.fromId === l.sourceId} issues={issues.get(l.sourceId)} />
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
    {renaming && <InlineRename key={JSON.stringify(renaming)} target={renaming} layouts={layouts} mode={mode} onClose={stopRenaming} />}
    </>
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

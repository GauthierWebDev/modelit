import {
  type Association,
  type Entity,
  formatCardinality,
  type Id,
  type Inheritance,
  type Issue,
  issueMessage,
  type ModelLayer,
  type Point,
} from "@core/index";
import { memo } from "react";
import { usePreferencesStore } from "@/app/preferencesStore";
import { t } from "@/i18n";
import { tip } from "@/ui/common/Tooltip";
import {
  alternateText,
  attributeMarks,
  attributeStyle,
  FONT_FAMILY,
  FONT_SIZE,
  type InheritanceLinkGeometry,
  type LinkGeometry,
  type NodeLayout,
  PAD_X,
  pathOf,
  ROW_HEIGHT,
  segmentMidpoints,
  TAG_FONT_SIZE,
  TITLE_HEIGHT,
  TITLE_WEIGHT,
  type Triangle,
  textWidth,
} from "./geometry";

/**
 * Rendu SVG des objets du schéma. Les couleurs viennent des variables CSS
 * `--mcd-*` (src/index.css) pour suivre le thème clair / sombre.
 * Chaque forme porte `data-id` : c'est ainsi que le canevas identifie la cible d'un clic.
 */

/**
 * Pastille d'erreur d'un objet (override O-15) : rouge s'il a au moins une erreur.
 * Survol : liste de ses problèmes ; clic : sélection de l'objet et onglet « Problèmes »
 * (`data-badge`, traité par le canevas).
 */
export function ErrorBadge({
  x,
  y,
  issues,
  layer = "conceptual",
}: {
  x: number;
  y: number;
  issues: Issue[] | undefined;
  /** Vocabulaire des messages : MCD ou MLD / MPD (override O-24). */
  layer?: ModelLayer;
}) {
  // Rouge : au moins une erreur ; ambre : avertissements seulement (O-36).
  if (!issues?.length) return null;
  const error = issues.some((i) => i.severity === "error");
  const text = issues
    .map((i) => `${t(i.severity === "error" ? "common.error" : "common.warning")} : ${issueMessage(i, layer)}`)
    .join("\n");
  return (
    <g data-badge="" data-tooltip={text} className="cursor-help">
      <circle
        cx={x}
        cy={y}
        r={7}
        fill={error ? "var(--mcd-error)" : "var(--mcd-warning)"}
        stroke="var(--mcd-canvas)"
        strokeWidth={1.5}
      />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill="#fff">
        !
      </text>
    </g>
  );
}

interface NodeShapeProps {
  node: Entity | Association;
  layout: NodeLayout;
  selected: boolean;
  issues?: Issue[];
  /** Association porteuse d'une dépendance fonctionnelle (patte max 1). */
  functional?: boolean;
  /** Association qui référence un identifiant alternatif plutôt que la clé primaire (O-36). */
  referencedKey?: { entity: string; attributes: string[] };
  /** Nom de l'association de chaque patte (identifiants alternatifs relatifs, O-39). */
  linkNames?: Map<string, string>;
}

export const NodeShape = memo(function NodeShape({
  node,
  layout,
  selected,
  issues,
  functional,
  referencedKey,
  linkNames,
}: NodeShapeProps) {
  const marks = attributeMarks(node, linkNames);
  const { x, y, width, height, rows } = layout;
  const isEntity = node.kind === "entity";
  const variant = isEntity ? "entity" : functional ? "assoc-df" : "assoc";
  const radius = isEntity ? 0 : 14;
  const clipId = `clip-${node.id}`;

  return (
    <g data-id={node.id} className="cursor-move" fontFamily={FONT_FAMILY} fontSize={FONT_SIZE}>
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={width} height={height} rx={radius} />
        </clipPath>
      </defs>
      <rect x={x} y={y} width={width} height={height} rx={radius} fill={`var(--mcd-${variant}-body)`} />
      <rect
        x={x}
        y={y}
        width={width}
        height={TITLE_HEIGHT}
        fill={`var(--mcd-${variant}-title)`}
        clipPath={`url(#${clipId})`}
      />
      {rows.length > 0 && (
        <line
          x1={x}
          x2={x + width}
          y1={y + TITLE_HEIGHT}
          y2={y + TITLE_HEIGHT}
          stroke={`var(--mcd-${variant}-stroke)`}
        />
      )}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        fill="none"
        stroke={selected ? "var(--mcd-selection)" : `var(--mcd-${variant}-stroke)`}
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
        {node.name}
      </text>
      {rows.map(({ attribute, y: rowY }) => {
        const mark = marks.get(attribute.id)!;
        const baseline = y + rowY + ROW_HEIGHT / 2;
        const style = attributeStyle(mark);
        const labelWidth = textWidth(mark.label, style);
        const alternate = mark.alternate;
        return (
          <g key={attribute.id}>
            <text
              x={x + PAD_X}
              y={baseline}
              dominantBaseline="central"
              fill="var(--mcd-text)"
              textDecoration={attribute.identifier ? "underline" : undefined}
              fontWeight={style.weight}
              fontStyle={style.italic ? "italic" : undefined}
              {...(mark.derived ? tip(t("mcd.derived", { expression: attribute.generated!.expression })) : {})}
            >
              {mark.label}
            </text>
            {alternate ? (
              <>
                {/* Identifiant alternatif : souligné en pointillé, étiquette AI (O-36). */}
                <line
                  x1={x + PAD_X}
                  x2={x + PAD_X + labelWidth}
                  y1={baseline + 7}
                  y2={baseline + 7}
                  stroke={alternate.prefix ? "var(--mcd-warning)" : "var(--mcd-text)"}
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
                <text
                  x={x + PAD_X + labelWidth + 5}
                  y={baseline}
                  dominantBaseline="central"
                  fontSize={TAG_FONT_SIZE}
                  fill={alternate.prefix ? "var(--mcd-warning)" : "var(--mcd-muted)"}
                  className="cursor-help"
                  {...tip(
                    alternate.prefix
                      ? t("mcd.alternatePrefix", { tag: alternate.tag, n: alternate.prefix })
                      : alternate.condition
                        ? t("mcd.alternateCondition", { tag: alternate.tag, condition: alternate.condition })
                        : alternate.expression
                          ? t("mcd.alternateExpression", { tag: alternate.tag, expression: alternate.expression })
                          : alternate.scope
                            ? t("mcd.alternateScopeTip", { tag: alternate.tag, scope: alternate.scope })
                            : t("mcd.alternate", { tag: alternate.tag }),
                  )}
                >
                  {alternateText(alternate)}
                  {alternate.prefix ? " ⚠" : ""}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
      {referencedKey ? (
        <text
          x={x + width / 2}
          y={y + height + 11}
          textAnchor="middle"
          fontSize={TAG_FONT_SIZE}
          fill="var(--mcd-muted)"
          className="cursor-help"
          {...tip(
            t("mcd.referencedKey", { entity: referencedKey.entity, attributes: referencedKey.attributes.join(", ") }),
          )}
        >
          → {referencedKey.attributes.join(", ")}
        </text>
      ) : null}
      <ErrorBadge x={x + width} y={y} issues={issues} />
    </g>
  );
});

interface LinkShapeProps {
  geometry: LinkGeometry;
  selected: boolean;
}

/** Patte entre une association et une entité (tracé, cassures, cardinalité). */
export const LinkShape = memo(function LinkShape({ geometry, selected }: LinkShapeProps) {
  const { link, points, label } = geometry;
  const text = formatCardinality(link.cardinality) + (link.relativeId ? "(R)" : "");
  const role = "role" in link ? link.role?.trim() : undefined;
  const rolePoint = geometry.role ?? { x: label.x, y: label.y + 13 };
  const d = pathOf(
    points,
    usePreferencesStore((s) => s.smoothBends),
  );
  return (
    <g data-id={link.id} className="cursor-pointer" fontFamily={FONT_FAMILY} fontSize={FONT_SIZE}>
      {/* Zone de clic élargie */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={d}
        fill="none"
        strokeLinejoin="round"
        stroke={selected ? "var(--mcd-selection)" : "var(--mcd-link)"}
        strokeWidth={selected ? 2.5 : 1.25}
      />
      <text
        x={label.x}
        y={label.y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={selected ? "var(--mcd-selection)" : "var(--mcd-text)"}
        paintOrder="stroke"
        stroke="var(--mcd-canvas)"
        strokeWidth={4}
      >
        {text}
      </text>
      {role ? (
        /* Rôle de la patte (réflexives : parrain, originale…) (O-36). */
        <text
          x={rolePoint.x}
          y={rolePoint.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={TAG_FONT_SIZE + 1}
          fontStyle="italic"
          fill={selected ? "var(--mcd-selection)" : "var(--mcd-muted)"}
          paintOrder="stroke"
          stroke="var(--mcd-canvas)"
          strokeWidth={4}
        >
          {role}
        </text>
      ) : null}
    </g>
  );
});

/**
 * Poignées d'une patte sélectionnée (override O-10), dessinées au-dessus des objets pour rester
 * accessibles : points de cassure (pleins, `data-handle="bend"`) et milieux de segment
 * (creux, `data-handle="mid"`) qu'on fait glisser pour créer une cassure.
 */
export function LinkHandles({
  geometry,
  activeIndex,
}: {
  geometry: { link: { id: Id }; bends: Point[]; points: Point[] };
  activeIndex: number | null;
}) {
  const { link, bends, points } = geometry;
  return (
    <g data-id={link.id}>
      {segmentMidpoints(points).map(({ index, point }) => (
        <circle
          key={`mid-${index}`}
          data-handle="mid"
          data-index={index}
          cx={point.x}
          cy={point.y}
          r={4}
          fill="var(--mcd-canvas)"
          stroke="var(--mcd-selection)"
          strokeWidth={1.5}
          className="cursor-copy"
          data-tooltip={t("canvas.midHandle")}
        />
      ))}
      {bends.map((b, index) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: une cassure est désignée par sa place (data-index)
          key={`bend-${index}`}
          data-handle="bend"
          data-index={index}
          cx={b.x}
          cy={b.y}
          r={index === activeIndex ? 7 : 5}
          fill="var(--mcd-selection)"
          stroke={index === activeIndex ? "var(--mcd-canvas)" : undefined}
          strokeWidth={2}
          className="cursor-move"
          data-tooltip={t("canvas.bendHandle")}
        />
      ))}
    </g>
  );
}

const CONSTRAINT_SYMBOL: Record<Inheritance["constraint"], string> = { none: "", X: "X", T: "T", XT: "XT" };

/**
 * Triangle d'héritage (overrides O-18, O-27) : toujours droit, pointe en haut ;
 * symbole de la contrainte au centre (X, T, XT, ou vide).
 */
export const InheritanceShape = memo(function InheritanceShape({
  inheritance,
  layout,
  triangle,
  selected,
  issues,
}: {
  inheritance: Inheritance;
  layout: NodeLayout;
  triangle: Triangle;
  selected: boolean;
  issues?: Issue[];
}) {
  const points = triangle.corners.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <g data-id={inheritance.id} className="cursor-move" fontFamily={FONT_FAMILY}>
      {/* Zone de clic : tout l'encombrement */}
      <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} fill="transparent" />
      <polygon
        points={points}
        fill="var(--mcd-inherit-fill)"
        stroke={selected ? "var(--mcd-selection)" : "var(--mcd-inherit-stroke)"}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeLinejoin="round"
      />
      <text
        x={triangle.centroid.x}
        y={triangle.centroid.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontWeight={700}
        fill="var(--mcd-text)"
      >
        {CONSTRAINT_SYMBOL[inheritance.constraint]}
      </text>
      <ErrorBadge x={layout.x + layout.width - 4} y={layout.y + 4} issues={issues} />
    </g>
  );
});

/** Lien d'héritage ; celui de l'entité générique est plus épais et fléché (non désactivable, O-27). */
export const InheritanceLinkShape = memo(function InheritanceLinkShape({
  geometry,
  selected,
}: {
  geometry: InheritanceLinkGeometry;
  selected: boolean;
}) {
  const d = pathOf(
    geometry.points,
    usePreferencesStore((s) => s.smoothBends),
  );
  return (
    <g data-id={geometry.link.id} className="cursor-pointer">
      <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
      <path
        d={d}
        fill="none"
        strokeLinejoin="round"
        stroke={selected ? "var(--mcd-selection)" : "var(--mcd-inherit-stroke)"}
        strokeWidth={(selected ? 1.25 : 0) + (geometry.toParent ? 2.25 : 1.25)}
        markerEnd={geometry.toParent ? (selected ? "url(#arrow-inherit-selected)" : "url(#arrow-inherit)") : undefined}
      />
    </g>
  );
});

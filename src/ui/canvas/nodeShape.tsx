import type { Association, Attribute, Entity, Issue } from "@core/index";
import { memo } from "react";
import { t } from "@/i18n";
import { tip } from "@/ui/common/Tooltip";
import type { AttributeMarks } from "./attributeMarks";
import {
  alternateText,
  attributeMarks,
  attributeStyle,
  FONT_FAMILY,
  FONT_SIZE,
  type NodeLayout,
  PAD_X,
  ROW_HEIGHT,
  TAG_FONT_SIZE,
  TITLE_HEIGHT,
  TITLE_WEIGHT,
  textWidth,
} from "./geometry";
import { ErrorBadge } from "./shapes";

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

// biome-ignore lint/suspicious/noShadow: nom de la fonction affiché par les outils de développement de React
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
      {rows.map(({ attribute, y: rowY }) => attributeRow(attribute, marks.get(attribute.id)!, x, y + rowY))}
      {referencedKey ? referencedKeyLabel(referencedKey, { x, y, width, height }) : null}
      <ErrorBadge x={x + width} y={y} issues={issues} />
    </g>
  );
});

/** Ligne d'une rubrique : nom (souligné si identifiant), étiquette d'identifiant alternatif (O-36). */
function attributeRow(attribute: Attribute, mark: AttributeMarks, x: number, top: number) {
  const baseline = top + ROW_HEIGHT / 2;
  const style = attributeStyle(mark);
  const labelWidth = textWidth(mark.label, style);
  const { alternate } = mark;
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
            {...tip(alternateTip(alternate))}
          >
            {alternateText(alternate)}
            {alternate.prefix ? " ⚠" : ""}
          </text>
        </>
      ) : null}
    </g>
  );
}

/** Infobulle de l'étiquette AI : préfixe, condition, expression ou portée. */
function alternateTip(alternate: NonNullable<AttributeMarks["alternate"]>): string {
  if (alternate.prefix) {
    return t("mcd.alternatePrefix", { tag: alternate.tag, n: alternate.prefix });
  }
  if (alternate.condition) {
    return t("mcd.alternateCondition", { tag: alternate.tag, condition: alternate.condition });
  }
  if (alternate.expression) {
    return t("mcd.alternateExpression", { tag: alternate.tag, expression: alternate.expression });
  }
  if (alternate.scope) {
    return t("mcd.alternateScopeTip", { tag: alternate.tag, scope: alternate.scope });
  }
  return t("mcd.alternate", { tag: alternate.tag });
}

/** Identifiant alternatif référencé par l'association (O-36), sous la boîte. */
function referencedKeyLabel(
  referencedKey: { entity: string; attributes: string[] },
  { x, y, width, height }: { x: number; y: number; width: number; height: number },
) {
  return (
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
  );
}

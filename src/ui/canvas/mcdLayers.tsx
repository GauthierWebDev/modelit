import type { ModelDocument } from "@core/index";
import { bendsOf } from "@core/index";
import type { useIssuesByTarget } from "@/app/derived";
import type { ActiveBend } from "@/app/document/documentView";
import { t } from "@/i18n";
import { center, normalizeRect, type Rect } from "./geometry";
import type { Gesture } from "./mcdGestures";
import type { useMcdModel } from "./mcdModel";
import { InheritanceLinkShape, InheritanceShape, LinkHandles, LinkShape, NodeShape } from "./shapes";

type Model = ReturnType<typeof useMcdModel>;

/** Traits, héritages, associations puis entités (ordre d'empilement du dessin). */
export function mcdShapes(
  doc: ModelDocument,
  model: Model,
  gesture: Gesture | null,
  issues: ReturnType<typeof useIssuesByTarget>,
) {
  const { layouts, selected, geometries, inheritance, referencedKeys, linkNames, functional } = model;
  return (
    <>
      {geometries.map((g) => (
        <LinkShape key={g.link.id} geometry={g} selected={selected.has(g.link.id)} />
      ))}
      {inheritance.links.map((g) => (
        <InheritanceLinkShape key={g.link.id} geometry={g} selected={selected.has(g.link.id)} />
      ))}
      {doc.inheritances.map((h) => {
        const triangle = inheritance.triangles.get(h.id);
        return (
          triangle && (
            <InheritanceShape
              key={h.id}
              inheritance={h}
              layout={layouts.get(h.id)!}
              triangle={triangle}
              selected={selected.has(h.id) || (gesture?.type === "link" && gesture.fromId === h.id)}
              issues={issues.get(h.id)}
            />
          )
        );
      })}
      {doc.associations.map((a) => (
        <NodeShape
          key={a.id}
          node={a}
          layout={layouts.get(a.id)!}
          selected={selected.has(a.id) || (gesture?.type === "link" && gesture.fromId === a.id)}
          issues={issues.get(a.id)}
          functional={functional.has(a.id)}
          referencedKey={referencedKeys.get(a.id)}
          linkNames={linkNames}
        />
      ))}
      {doc.entities.map((e) => (
        <NodeShape
          key={e.id}
          node={e}
          layout={layouts.get(e.id)!}
          selected={selected.has(e.id) || (gesture?.type === "link" && gesture.fromId === e.id)}
          issues={issues.get(e.id)}
          linkNames={linkNames}
        />
      ))}
    </>
  );
}

/** Lien en cours, poignées des liens sélectionnés, bouton de suppression d'une cassure, rectangle de sélection. */
export function mcdOverlays(doc: ModelDocument, model: Model, gesture: Gesture | null, activeBend: ActiveBend | null) {
  const { layouts, selected, geometries, inheritance } = model;
  const activeBendPoint =
    activeBend && selected.has(activeBend.linkId)
      ? bendsOf(doc.layout, activeBend.linkId)[activeBend.index]
      : undefined;
  const marquee: Rect | null = gesture?.type === "marquee" ? normalizeRect(gesture.start, gesture.current) : null;
  const linkSource = gesture?.type === "link" ? layouts.get(gesture.fromId) : undefined;
  return (
    <>
      {linkSource && gesture?.type === "link" && (
        <line
          x1={center(linkSource).x}
          y1={center(linkSource).y}
          x2={gesture.current.x}
          y2={gesture.current.y}
          stroke="var(--mcd-selection)"
          strokeDasharray="4 3"
          pointerEvents="none"
          data-ui-only=""
        />
      )}
      {[...geometries, ...inheritance.links]
        .filter((g) => selected.has(g.link.id))
        .map((g) => (
          <LinkHandles
            key={`handles-${g.link.id}`}
            geometry={g}
            activeIndex={activeBend?.linkId === g.link.id ? activeBend.index : null}
          />
        ))}
      {activeBendPoint ? (
        <g
          data-bend-delete=""
          data-tooltip={t("canvas.deleteBend")}
          className="cursor-pointer"
          transform={`translate(${activeBendPoint.x + 14} ${activeBendPoint.y - 14})`}
        >
          <circle r={8} fill="var(--mcd-error)" stroke="var(--mcd-canvas)" strokeWidth={1.5} />
          <path d="M-3,-3 L3,3 M3,-3 L-3,3" stroke="#fff" strokeWidth={1.75} strokeLinecap="round" />
        </g>
      ) : null}
      {marquee ? (
        <rect
          {...marquee}
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

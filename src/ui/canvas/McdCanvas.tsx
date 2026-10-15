import { createAssociation, diagramLinks, diagramNodes, linkSourceId, nextFreeName, type Id, type Point } from "@core/index";
import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { addAssociation, addEntity, addInheritance, connectNodes, findDiagramLink, removeBend } from "@/app/commands";
import { useIssuesByTarget } from "@/app/derived";
import { t } from "@/i18n";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { CanvasSurface, hitId, hitIdAt } from "./CanvasSurface";
import {
  center,
  INHERITANCE_SIZE,
  associationNamesByLink,
  inheritanceGeometries,
  intersects,
  linkGeometries,
  nodeLayout,
  normalizeRect,
  reflexiveBends,
  snap,
  type NodeLayout,
  type Rect,
} from "./geometry";
import { InheritanceLinkShape, InheritanceShape, LinkHandles, LinkShape, NodeShape } from "./shapes";
import { layoutsOf } from "./viewport";

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

const DRAG_THRESHOLD = 4;

type Gesture =
  /** `bendOrigins` : cassures des liens dont les deux extrémités sont déplacées. */
  | { type: "move"; start: Point; origins: Map<Id, Point>; bendOrigins: Map<Id, Point[]> }
  | { type: "bend"; linkId: Id; index: number; created: boolean }
  | { type: "marquee"; start: Point; current: Point; base: Id[] }
  /** `pending` : premier clic fait, en attente du second. */
  | { type: "link"; fromId: Id; start: Point; current: Point; pending: boolean };

export function McdCanvas() {
  const docHandle = useDocumentHandle();
  const doc = useDocument((s) => s.doc);
  const { tool, setTool, notify } = useUiStore();
  const { selection, select, toggleSelected, activeBend, setActiveBend } = useDocumentView((s) => s);
  const issues = useIssuesByTarget();
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const layouts = useMemo(() => layoutsOf(doc), [doc]);
  const geometries = useMemo(() => linkGeometries(doc.links, layouts), [doc.links, layouts]);
  const inheritance = useMemo(
    () => inheritanceGeometries(doc.inheritances, doc.inheritanceLinks, layouts),
    [doc.inheritances, doc.inheritanceLinks, layouts],
  );
  const selected = useMemo(() => new Set(selection), [selection]);
  /** Associations qui référencent un identifiant alternatif (oeuvre(isbn)) plutôt que la clé primaire (O-36). */
  const referencedKeys = useMemo(() => {
    const map = new Map<string, { entity: string; attributes: string[] }>();
    for (const link of doc.links) {
      if (!link.referencedAttributes?.length) continue;
      const entity = doc.entities.find((e) => e.id === link.entityId);
      if (!entity) continue;
      const attributes = link.referencedAttributes.map((id) => entity.attributes.find((x) => x.id === id)?.name ?? "?");
      map.set(link.associationId, { entity: entity.name, attributes });
    }
    return map;
  }, [doc.links, doc.entities]);
  const linkNames = useMemo(
    () => associationNamesByLink({ links: doc.links, associations: doc.associations, entities: doc.entities }),
    [doc.links, doc.associations, doc.entities],
  );
  const functional = useMemo(() => {
    const ids = new Set<Id>();
    for (const l of doc.links) if (l.cardinality.max === 1) ids.add(l.associationId);
    return ids;
  }, [doc.links]);
  const grid = doc.settings.grid.enabled ? doc.settings.grid.size : null;

  // Changer d'outil (ex. Échap) abandonne un lien en cours.
  useEffect(() => setGesture((g) => (g?.type === "link" ? null : g)), [tool]);

  /** Position de la nouvelle association : centrée entre les deux entités. */
  function associationPosition(a: NodeLayout, b: NodeLayout): Point {
    const name = nextFreeName("Association", doc.associations.map((x) => x.name));
    const size = nodeLayout(createAssociation(name, { x: 0, y: 0 }), doc.settings.display);
    const ca = center(a);
    const cb = center(b);
    return {
      x: snap((ca.x + cb.x) / 2 - size.width / 2, grid),
      y: snap((ca.y + cb.y) / 2 - size.height / 2, grid),
    };
  }

  /**
   * Association réflexive : placée sur un emplacement libre autour de l'entité (droite,
   * dessous, gauche, dessus, puis de plus en plus loin) ; la seconde patte contourne
   * l'ensemble pour rester distincte de la première (`reflexiveBends`).
   */
  function reflexivePlacement(e: NodeLayout) {
    const name = nextFreeName("Association", doc.associations.map((x) => x.name));
    const size = nodeLayout(createAssociation(name, { x: 0, y: 0 }), doc.settings.display);
    const ce = center(e);
    const others = [...layouts.values()];
    const MARGIN = 16;
    const isFree = (p: Point) =>
      !others.some((r) =>
        intersects({ x: p.x - MARGIN, y: p.y - MARGIN, width: size.width + 2 * MARGIN, height: size.height + 2 * MARGIN }, r),
      );
    type Side = "right" | "below" | "left" | "above";
    const at = (side: Side, distance: number): Point => {
      switch (side) {
        case "right":
          return { x: e.x + e.width + distance, y: ce.y - size.height / 2 };
        case "left":
          return { x: e.x - distance - size.width, y: ce.y - size.height / 2 };
        case "below":
          return { x: ce.x - size.width / 2, y: e.y + e.height + distance };
        case "above":
          return { x: ce.x - size.width / 2, y: e.y - distance - size.height };
      }
    };
    let position = at("right", 90);
    search: for (let distance = 90; distance <= 90 + 60 * 12; distance += 60) {
      for (const candidate of ["right", "below", "left", "above"] as Side[]) {
        const p = at(candidate, distance);
        const snapped = { x: snap(p.x, grid), y: snap(p.y, grid) };
        if (isFree(snapped)) {
          position = snapped;
          break search;
        }
      }
    }
    const reflexive = reflexiveBends(
      e,
      { ...position, width: size.width, height: size.height },
      grid,
      others.filter((r) => r !== e),
    );
    return { associationPosition: position, reflexiveBends: reflexive };
  }

  function connect(fromId: Id, toId: Id | null) {
    setGesture(null);
    const a = layouts.get(fromId);
    const b = toId ? layouts.get(toId) : undefined;
    if (!a || !b || !toId) return;
    const isEntity = doc.entities.some((e) => e.id === fromId);
    if (fromId === toId && !isEntity) return;
    const result = connectNodes(
      docHandle,
      fromId,
      toId,
      fromId === toId ? reflexivePlacement(a) : { associationPosition: associationPosition(a, b) },
    );
    if (!result) return;
    if ("error" in result) notify({ kind: "error", text: result.error });
    else select([result.created]);
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>, point: Point): boolean {
    const hit = hitId(e);
    const target = e.target as Element;
    if (target.closest("[data-bend-delete]") && activeBend) {
      removeBend(docHandle, activeBend.linkId, activeBend.index);
      return true;
    }
    if (target.closest("[data-badge]") && hit) {
      select([hit]);
      useUiStore.getState().setBottomTab("issues");
      return true;
    }
    const handle = target.closest<SVGElement>("[data-handle]");
    if (handle && hit && tool === "select") {
      const index = Number(handle.dataset.index);
      if (handle.dataset.handle === "bend" && e.detail >= 2) {
        removeBend(docHandle, hit, index);
        return true;
      }
      setActiveBend({ linkId: hit, index });
      docHandle.store.getState().begin();
      const created = handle.dataset.handle === "mid";
      if (created) {
        docHandle.store.getState().preview((d) => {
          findDiagramLink(d, hit)?.bends.splice(index, 0, { x: snap(point.x, grid), y: snap(point.y, grid) });
        });
      }
      setGesture({ type: "bend", linkId: hit, index, created });
      return true;
    }

    if (tool === "entity" || tool === "association" || tool === "inheritance") {
      if (hit) return true;
      const position = { x: snap(point.x, grid), y: snap(point.y, grid) };
      if (tool === "inheritance") {
        // Le triangle est centré sur le clic.
        const at = { x: snap(point.x - INHERITANCE_SIZE.width / 2, grid), y: snap(point.y - INHERITANCE_SIZE.height / 2, grid) };
        select([addInheritance(docHandle, at)]);
      } else {
        select([tool === "entity" ? addEntity(docHandle, position) : addAssociation(docHandle, position)]);
      }
      setTool("select");
      return true;
    }

    if (tool === "link") {
      if (gesture?.type === "link" && gesture.pending) {
        if (hit && layouts.has(hit)) connect(gesture.fromId, hit);
        else setGesture(null);
      } else if (hit && layouts.has(hit)) {
        setGesture({ type: "link", fromId: hit, start: point, current: point, pending: false });
      }
      return true;
    }

    if (!hit) {
      const base = e.shiftKey ? selection : [];
      if (!e.shiftKey) select([]);
      setGesture({ type: "marquee", start: point, current: point, base });
      return true;
    }
    if (e.shiftKey) {
      toggleSelected(hit);
      return true;
    }
    const ids = selected.has(hit) ? selection : [hit];
    if (!selected.has(hit)) select(ids);
    const origins = new Map<Id, Point>();
    for (const n of diagramNodes(doc)) if (ids.includes(n.id)) origins.set(n.id, n.position);
    const bendOrigins = new Map<Id, Point[]>();
    for (const l of diagramLinks(doc)) {
      if (l.bends.length && origins.has(linkSourceId(l)) && origins.has(l.entityId)) bendOrigins.set(l.id, l.bends);
    }
    if (origins.size > 0) {
      docHandle.store.getState().begin();
      setGesture({ type: "move", start: point, origins, bendOrigins });
    }
    return true;
  }

  function onPointerMove(_: PointerEvent<SVGSVGElement>, point: Point) {
    if (!gesture) return;
    switch (gesture.type) {
      case "move": {
        const dx = point.x - gesture.start.x;
        const dy = point.y - gesture.start.y;
        docHandle.store.getState().preview((d) => {
          for (const node of diagramNodes(d)) {
            const origin = gesture.origins.get(node.id);
            if (origin) node.position = { x: snap(origin.x + dx, grid), y: snap(origin.y + dy, grid) };
          }
          // Les cassures d'un lien suivent quand ses deux extrémités sont déplacées ensemble.
          for (const link of diagramLinks(d)) {
            const bends = gesture.bendOrigins.get(link.id);
            if (bends) link.bends = bends.map((b) => ({ x: snap(b.x + dx, grid), y: snap(b.y + dy, grid) }));
          }
        });
        break;
      }
      case "bend": {
        docHandle.store.getState().preview((d) => {
          const link = findDiagramLink(d, gesture.linkId);
          if (link?.bends[gesture.index]) link.bends[gesture.index] = { x: snap(point.x, grid), y: snap(point.y, grid) };
        });
        break;
      }
      case "marquee": {
        const rect = normalizeRect(gesture.start, point);
        const inside = [...layouts].filter(([, l]) => intersects(rect, l)).map(([id]) => id);
        select([...new Set([...gesture.base, ...inside])]);
        setGesture({ ...gesture, current: point });
        break;
      }
      case "link":
        setGesture({ ...gesture, current: point });
        break;
    }
  }

  function onPointerUp(e: PointerEvent<SVGSVGElement>, point: Point) {
    if (!gesture) return;
    if (gesture.type === "move") {
      docHandle.store.getState().commit(gesture.origins.size > 1 ? "history.moveSelection" : "history.move");
    } else if (gesture.type === "bend") {
      docHandle.store.getState().commit(gesture.created ? "history.createBend" : "history.moveBend");
    } else if (gesture.type === "link") {
      if (gesture.pending) return;
      const dragged = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > DRAG_THRESHOLD;
      // Simple clic : on attend le second clic. Glisser : on relie à l'objet sous le pointeur.
      if (!dragged) return setGesture({ ...gesture, pending: true });
      return connect(gesture.fromId, hitIdAt(e));
    }
    setGesture(null);
  }

  const activeBendPoint =
    activeBend && selected.has(activeBend.linkId)
      ? diagramLinks(doc).find((l) => l.id === activeBend.linkId)?.bends[activeBend.index]
      : undefined;
  const marquee: Rect | null = gesture?.type === "marquee" ? normalizeRect(gesture.start, gesture.current) : null;
  const linkSource = gesture?.type === "link" ? layouts.get(gesture.fromId) : undefined;

  return (
    <CanvasSurface
      grid={grid}
      className={tool === "select" ? "" : "cursor-crosshair"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        if (gesture?.type === "move" || gesture?.type === "bend") docHandle.store.getState().cancel();
        setGesture(null);
      }}
      onContextMenu={(e) => {
        // Outil de création : abandon et retour à la sélection (override O-16).
        if (tool !== "select") {
          e.preventDefault();
          setGesture(null);
          setTool("select");
          return;
        }
        // Clic droit sur une cassure : la supprimer.
        const handle = (e.target as Element).closest<SVGElement>("[data-handle=bend]");
        const linkId = hitId(e);
        if (!handle || !linkId) return;
        e.preventDefault();
        removeBend(docHandle, linkId, Number(handle.dataset.index));
      }}
    >
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
      {activeBendPoint && (
        <g
          data-bend-delete=""
          data-tooltip={t("canvas.deleteBend")}
          className="cursor-pointer"
          transform={`translate(${activeBendPoint.x + 14} ${activeBendPoint.y - 14})`}
        >
          <circle r={8} fill="var(--mcd-error)" stroke="var(--mcd-canvas)" strokeWidth={1.5} />
          <path d="M-3,-3 L3,3 M3,-3 L-3,3" stroke="#fff" strokeWidth={1.75} strokeLinecap="round" />
        </g>
      )}
      {marquee && (
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
      )}
    </CanvasSurface>
  );
}

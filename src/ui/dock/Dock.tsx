import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import { updateDock } from "@/app/dock/actions";
import { closeGroup, setFloatingRect, setWeights, setZoneSize } from "@/app/dock/layout";
import type { DockLayout, FloatingGroup, Zone } from "@/app/dock/model";
import { t } from "@/i18n";
import { nativeWindows } from "@/platform/floatWindows";
import { tip } from "@/ui/common/Tooltip";
import { useDragStore } from "./drag";
import { GroupView, useDock } from "./GroupView";
import { sectionLabel } from "./sectionViews";

export { GroupView, SectionChecks } from "./GroupView";

/**
 * Zones d'ancrage (droite, bas) et groupes de sections à onglets, ancrés ou flottants
 * (override O-46). Les groupes flottants sont ici dans la page ; dans l'application native,
 * ils deviennent des fenêtres (J-01, phase 4).
 */

/**
 * Emplacement de dépôt au bord d'un groupe (avant lui, ou après le dernier) : bande superposée,
 * sans décaler la disposition pendant le glisser.
 */
function DropSlot({ zone, index, after }: { zone: Zone; index: number; after?: boolean }) {
  const target = useDragStore((s) => s.target);
  const dragging = useDragStore((s) => s.item !== null);
  const active = target?.kind === "zone" && target.zone === zone && target.index === index;
  if (!dragging) {
    return null;
  }
  const position =
    zone === "right"
      ? after
        ? "inset-x-0 bottom-0 h-2"
        : "inset-x-0 top-0 h-2"
      : after
        ? "inset-y-0 right-0 w-2"
        : "inset-y-0 left-0 w-2";
  return (
    <div
      data-drop-zone={zone}
      data-drop-index={index}
      className={`absolute z-10 ${position} ${active ? "bg-blue-500/70" : "bg-blue-500/15"}`}
    />
  );
}

/** Zone vide pendant un glisser : une seule cible, toute la bande. */
function EmptyZoneSlot({ zone }: { zone: Zone }) {
  const target = useDragStore((s) => s.target);
  const active = target?.kind === "zone" && target.zone === zone;
  return (
    <div
      data-drop-zone={zone}
      data-drop-index={0}
      className={`flex-1 ${active ? "bg-blue-500/50" : "bg-blue-500/10"}`}
    />
  );
}

/** Place minimale d'un groupe lors d'un redimensionnement, en px. */
const MIN_GROUP_SPAN = 80;

/** Séparateur entre deux groupes d'une zone : redistribue la place. */
function GroupResizer({ zone, index, layout }: { zone: Zone; index: number; layout: DockLayout }) {
  const vertical = zone === "right";
  return (
    // biome-ignore lint/a11y/useSemanticElements: séparateur redimensionnable (motif ARIA window splitter), pas une ligne
    <div
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      {...tip(t("dock.resize"))}
      className={`flex-none bg-neutral-200 hover:bg-blue-400 dark:bg-neutral-700 ${vertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize"}`}
      onPointerDown={(e) => {
        // La zone entière, pas le parent direct : celui-ci est en `display: contents`, sans boîte
        // (hauteur 0 : le moindre mouvement envoyait le séparateur en butée).
        const parent = e.currentTarget.closest("[data-dock-zone]")!.getBoundingClientRect();
        const { groups } = layout.zones[zone];
        const a = groups[index]!.weight;
        const b = groups[index + 1]!.weight;
        const total = groups.reduce((sum, g) => sum + g.weight, 0);
        const span = Math.max(1, vertical ? parent.height : parent.width);
        // Chaque groupe garde au moins son en-tête et un peu de contenu.
        const min = (MIN_GROUP_SPAN / span) * total;
        const start = vertical ? e.clientY : e.clientX;
        const move = (ev: PointerEvent) => {
          const delta = (((vertical ? ev.clientY : ev.clientX) - start) / span) * total;
          const clamped = Math.max(Math.min(0, -a + min), Math.min(Math.max(0, b - min), delta));
          updateDock((l) => setWeights(l, zone, index, a + clamped, b - clamped));
        };
        const up = () => {
          globalThis.removeEventListener("pointermove", move);
          globalThis.removeEventListener("pointerup", up);
        };
        globalThis.addEventListener("pointermove", move);
        globalThis.addEventListener("pointerup", up);
      }}
    />
  );
}

/** Zone d'ancrage : groupes empilés (droite) ou juxtaposés (bas), bord intérieur redimensionnable. */
export function DockZone({ zone }: { zone: Zone }) {
  const layout = useDock();
  const dragging = useDragStore((s) => s.item !== null);
  const { groups, size } = layout.zones[zone];
  const ref = useRef<HTMLDivElement>(null);
  if (groups.length === 0 && !dragging) {
    return null;
  }
  const vertical = zone === "right";

  const resizeZone = (e: ReactPointerEvent) => {
    const start = vertical ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) =>
      updateDock((l) => setZoneSize(l, zone, size + (start - (vertical ? ev.clientX : ev.clientY))));
    const up = () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", up);
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", up);
  };

  return (
    <div
      className={`flex flex-none ${vertical ? "flex-row" : "flex-col"}`}
      style={vertical ? { width: groups.length > 0 ? size : 28 } : { height: groups.length > 0 ? size : 28 }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: séparateur redimensionnable (motif ARIA window splitter), pas une ligne */}
      <div
        role="separator"
        {...tip(t("dock.resize"))}
        onPointerDown={resizeZone}
        className={`flex-none bg-neutral-200 hover:bg-blue-400 dark:bg-neutral-700 ${vertical ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`}
      />
      <div
        ref={ref}
        data-dock-zone={zone}
        className={`flex min-h-0 min-w-0 flex-1 ${vertical ? "flex-col" : "flex-row"}`}
      >
        {groups.length === 0 && <EmptyZoneSlot zone={zone} />}
        {groups.map((g, i) => (
          <div key={g.id} className="contents">
            {i > 0 && <GroupResizer zone={zone} index={i - 1} layout={layout} />}
            <div
              data-group-id={g.id}
              className="relative min-h-0 min-w-0"
              style={g.collapsed ? { flex: "none" } : { flex: `${g.weight} 1 0` }}
            >
              <GroupView group={g} zone={zone} />
              <DropSlot zone={zone} index={i} />
              {i === groups.length - 1 && <DropSlot zone={zone} index={groups.length} after={true} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Groupe flottant dans la page (navigateur) : position fixe, redimensionnable par ses bords. */
function FloatingGroupView({ group }: { group: FloatingGroup }) {
  const resize = (e: ReactPointerEvent, edges: { right?: boolean; bottom?: boolean }) => {
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const origin = group.rect;
    const move = (ev: PointerEvent) =>
      updateDock((l) =>
        setFloatingRect(l, group.id, {
          ...origin,
          width: origin.width + (edges.right ? ev.clientX - start.x : 0),
          height: origin.height + (edges.bottom ? ev.clientY - start.y : 0),
        }),
      );
    const up = () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", up);
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", up);
  };
  const { x, y, width, height } = group.rect;
  return (
    <div
      data-floating-group={group.id}
      className="fixed z-40 overflow-hidden rounded-lg border border-neutral-300 shadow-2xl dark:border-neutral-600"
      style={{ left: x, top: y, width, height }}
    >
      <GroupView group={group} zone={null} onClose={() => updateDock((l) => closeGroup(l, group.id))} />
      <div
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize"
        onPointerDown={(e) => resize(e, { right: true })}
      />
      <div
        className="absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize"
        onPointerDown={(e) => resize(e, { bottom: true })}
      />
      <div
        className="absolute right-0 bottom-0 size-3 cursor-nwse-resize"
        onPointerDown={(e) => resize(e, { right: true, bottom: true })}
      />
    </div>
  );
}

/** Groupes flottants dans la page (navigateur) ; dans l'application native, ce sont des fenêtres. */
export function FloatingGroups() {
  const { floating } = useDock();
  if (nativeWindows()) {
    return null;
  }
  return (
    <>
      {floating.map((g) => (
        <FloatingGroupView key={g.id} group={g} />
      ))}
    </>
  );
}

/** Aperçu de l'élément glissé, sous le pointeur. */
export function DragGhost() {
  const item = useDragStore((s) => s.item);
  const pointer = useDragStore((s) => s.pointer);
  const target = useDragStore((s) => s.target);
  const layout = useDock();
  if (!(item && pointer)) {
    return null;
  }
  const sections =
    item.kind === "section"
      ? [item.section]
      : (layout.zones.right.groups.concat(layout.zones.bottom.groups, layout.floating).find((g) => g.id === item.group)
          ?.sections ?? []);
  return (
    <div
      className={`pointer-events-none fixed z-50 rounded border px-2 py-1 text-xs shadow-lg ${
        target?.kind === "float"
          ? "border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-800"
          : "border-blue-400 bg-blue-50 dark:bg-blue-950"
      }`}
      style={{ left: pointer.x + 12, top: pointer.y + 12 }}
    >
      {sections.map(sectionLabel).join(" · ")}
    </div>
  );
}

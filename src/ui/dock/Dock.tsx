import { ChevronDown, GripVertical, X } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import { updateDock } from "@/app/dock/actions";
import {
  closeGroup,
  type DockLayout,
  type DropTarget,
  defaultLayout,
  type FloatingGroup,
  type Group,
  hideSection,
  SECTIONS,
  setActive,
  setFloatingRect,
  setWeights,
  setZoneSize,
  showSection,
  toggleCollapsed,
  type Zone,
} from "@/app/dock/layout";
import { usePreferencesStore } from "@/app/preferencesStore";
import { t } from "@/i18n";
import { nativeWindows } from "@/platform/floatWindows";
import { Menu, MenuCheck, MenuItem, MenuSeparator } from "@/ui/common/Menu";
import { tip } from "@/ui/common/Tooltip";
import { dropItem, startDrag, toScreen, useDragStore } from "./drag";
import { SECTION_VIEWS, sectionLabel } from "./sectionViews";

/**
 * Zones d'ancrage (droite, bas) et groupes de sections à onglets, ancrés ou flottants
 * (override O-46). Les groupes flottants sont ici dans la page ; dans l'application native,
 * ils deviennent des fenêtres (J-01, phase 4).
 */

const useDock = () => usePreferencesStore((s) => s.dock);

/** Cases « Sections » : afficher ou masquer chaque section (menu ⌄ et barre d'outils). */
export function SectionChecks({ close, withReset }: { close: () => void; withReset?: boolean }) {
  const { hidden } = useDock();
  return (
    <>
      {SECTIONS.map((s) => (
        <MenuCheck
          key={s}
          checked={!hidden.includes(s)}
          onSelect={() => {
            updateDock((l) => (l.hidden.includes(s) ? showSection(l, s) : hideSection(l, s)));
            close();
          }}
        >
          {sectionLabel(s)}
        </MenuCheck>
      ))}
      {withReset ? (
        <>
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              updateDock((l) => ({ ...defaultLayout(), toolbar: l.toolbar }));
              close();
            }}
          >
            {t("dock.reset")}
          </MenuItem>
        </>
      ) : null}
    </>
  );
}

export function GroupView({
  group,
  zone,
  onClose,
  onGripDown,
}: {
  group: Group;
  zone: Zone | null;
  onClose?: () => void;
  /** Poignée : par défaut, glisser le groupe ; dans une fenêtre flottante native, déplacer la fenêtre. */
  onGripDown?: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const target = useDragStore((s) => s.target);
  const dragging = useDragStore((s) => s.item);
  const highlighted = target?.kind === "group" && target.group === group.id;
  const { Body } = SECTION_VIEWS[group.active];

  const dropSection = (section: (typeof SECTIONS)[number]) => (to: DropTarget) =>
    dropItem({ kind: "section", section, group: group.id }, to);
  const dropGroup = (to: DropTarget) => dropItem({ kind: "group", group: group.id }, to);

  return (
    <section
      aria-label={sectionLabel(group.active)}
      className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-900"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: repli au double-clic, sans équivalent clavier pour l'instant */}
      <header
        data-drop-group={group.id}
        onDoubleClick={(e) =>
          !(e.target as Element).closest("button") && updateDock((l) => toggleCollapsed(l, group.id))
        }
        className={`flex h-8 flex-none items-center gap-1 border-b border-neutral-200 bg-neutral-50 px-1 dark:border-neutral-700 dark:bg-neutral-800/60 ${
          highlighted ? "ring-2 ring-blue-500 ring-inset" : ""
        }`}
      >
        {onClose ? (
          <button
            type="button"
            aria-label={t("dock.close")}
            {...tip(t("dock.close"))}
            onClick={onClose}
            className="flex size-5 items-center justify-center rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700"
          >
            <X size={12} />
          </button>
        ) : null}
        {/* biome-ignore lint/a11y/useSemanticElements: poignée de déplacement au pointeur, hors de l'ordre de tabulation */}
        <span
          role="button"
          tabIndex={-1}
          aria-label={t("dock.grip")}
          {...tip(t("dock.grip"))}
          data-dock-grip=""
          onPointerDown={(e: ReactPointerEvent<HTMLElement>) =>
            e.button === 0 && (onGripDown ? onGripDown(e) : startDrag(e, { kind: "group", group: group.id }, dropGroup))
          }
          className="flex h-5 w-3 cursor-grab items-center justify-center text-neutral-400"
        >
          <GripVertical size={14} />
        </span>
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {group.sections.map((s) => {
            const { Title } = SECTION_VIEWS[s];
            const active = s === group.active;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={active}
                data-section={s}
                onPointerDown={(e) =>
                  e.button === 0 &&
                  startDrag(e, { kind: "section", section: s, group: group.id }, dropSection(s), () =>
                    updateDock((l) => setActive(l, group.id, s)),
                  )
                }
                className={`truncate rounded px-2 py-0.5 text-xs ${
                  active
                    ? "bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-700 dark:text-neutral-50"
                    : "text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-700/60"
                } ${dragging?.kind === "section" && dragging.section === s ? "opacity-40" : ""}`}
              >
                <Title />
              </button>
            );
          })}
        </div>
        <Menu
          trigger={({ toggle }) => (
            <button
              type="button"
              aria-label={t("dock.menu")}
              {...tip(t("dock.menu"))}
              onClick={toggle}
              className="flex size-5 items-center justify-center rounded border border-neutral-300 text-neutral-500 hover:bg-neutral-200 dark:border-neutral-600 dark:hover:bg-neutral-700"
            >
              <ChevronDown size={12} />
            </button>
          )}
        >
          {(close) => (
            <>
              {zone ? (
                <MenuItem
                  onSelect={() => {
                    dropGroup({ kind: "float", rect: toScreen(detachedRect(group.id)) });
                    close();
                  }}
                >
                  {t("dock.detach")}
                </MenuItem>
              ) : (
                <>
                  <MenuItem
                    onSelect={() => {
                      dropGroup({ kind: "zone", zone: "right", index: Number.POSITIVE_INFINITY });
                      close();
                    }}
                  >
                    {t("dock.dockRight")}
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      dropGroup({ kind: "zone", zone: "bottom", index: Number.POSITIVE_INFINITY });
                      close();
                    }}
                  >
                    {t("dock.dockBottom")}
                  </MenuItem>
                </>
              )}
              <MenuItem
                onSelect={() => {
                  updateDock((l) => closeGroup(l, group.id));
                  close();
                }}
              >
                {t("dock.closeGroup")}
              </MenuItem>
              <MenuSeparator />
              <SectionChecks close={close} />
            </>
          )}
        </Menu>
      </header>
      {!group.collapsed && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Body />
        </div>
      )}
    </section>
  );
}

/**
 * Place d'un groupe détaché par le menu : à gauche de sa place s'il y a la place, sinon décalé
 * vers l'intérieur ; toujours entièrement dans la page.
 */
function detachedRect(id: string) {
  const r =
    document.querySelector(`[data-group-id="${id}"]`)?.getBoundingClientRect() ?? new DOMRect(200, 120, 320, 320);
  const width = 320;
  const height = Math.min(420, Math.max(200, r.height));
  const x = r.left >= width + 40 ? r.left - width - 20 : r.left + 40;
  const y = Math.min(r.top + 20, window.innerHeight - height - 16);
  return { x: Math.max(8, Math.min(x, window.innerWidth - width - 8)), y: Math.max(8, y), width, height };
}

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

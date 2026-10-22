import { ChevronDown, GripVertical, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { updateDock } from "@/app/dock/actions";
import { closeGroup, defaultLayout, hideSection, setActive, showSection, toggleCollapsed } from "@/app/dock/layout";
import { type DropTarget, type Group, SECTIONS, type Zone } from "@/app/dock/model";
import { usePreferencesStore } from "@/app/preferencesStore";
import { t } from "@/i18n";
import { Menu, MenuCheck, MenuItem, MenuSeparator } from "@/ui/common/Menu";
import { tip } from "@/ui/common/Tooltip";
import { dropItem, startDrag, toScreen, useDragStore } from "./drag";
import { SECTION_VIEWS, sectionLabel } from "./sectionViews";

export const useDock = () => usePreferencesStore((s) => s.dock);

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
        {sectionTabs(group, dragging, dropSection)}
        {groupMenu(group, zone, dropGroup)}
      </header>
      {!group.collapsed && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Body />
        </div>
      )}
    </section>
  );
}

type DragItem = ReturnType<typeof useDragStore.getState>["item"];

/** Onglets des sections : clic pour activer, glisser pour déplacer la section. */
function sectionTabs(
  group: Group,
  dragging: DragItem,
  dropSection: (section: (typeof SECTIONS)[number]) => (to: DropTarget) => void,
) {
  return (
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
  );
}

/** Menu ⌄ du groupe : détacher ou ancrer, fermer, sections affichées. */
function groupMenu(group: Group, zone: Zone | null, dropGroup: (to: DropTarget) => void) {
  return (
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

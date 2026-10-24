import {
  ChevronDown,
  GripVertical,
  LayoutDashboard,
  LoaderCircle,
  MousePointer2,
  Redo2,
  Spline,
  Square,
  Triangle,
  Undo2,
  Users,
} from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { useEffect } from "react";
import { useCollabStore } from "@/app/collab/session";
import { updateDock } from "@/app/dock/actions";
import { setToolbar } from "@/app/dock/layout";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { selectRedoLabel, selectUndoLabel } from "@/app/document/documentStore";
import type { ViewMode } from "@/app/document/documentView";
import type { DocumentHandle } from "@/app/document/handle";
import { type Tool, useUiStore } from "@/app/uiStore";
import { chooseTool, showView, toolAvailable } from "@/app/viewCommands";
import { type MessageKey, t } from "@/i18n";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { IconButton } from "@/ui/common/controls";
import { Menu, MenuItem } from "@/ui/common/Menu";
import { tip } from "@/ui/common/Tooltip";
import { MOD } from "@/ui/shortcuts";
import { mainCommand } from "@/ui/windows/mainCommands";
import { AppMenu } from "./AppMenu";
import { DisplayMenu } from "./DisplayMenu";

/** Barre d'outils principale. */

const TOOLS: { id: Tool; label: MessageKey; icon: ReactNode; key: string }[] = [
  { id: "select", label: "tool.select", icon: <MousePointer2 size={16} />, key: "V" },
  { id: "entity", label: "tool.entity", icon: <Square size={16} />, key: "E" },
  { id: "association", label: "tool.association", icon: <AssociationIcon />, key: "A" },
  { id: "inheritance", label: "tool.inheritance", icon: <Triangle size={16} />, key: "H" },
  { id: "link", label: "tool.link", icon: <Spline size={16} />, key: "L" },
];

/** Icône de l'association : droite en haut et en bas, arrondie sur les côtés (override O-27). */
function AssociationIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x={2} y={7} width={20} height={10} rx={5} />
    </svg>
  );
}

/** Vues du schéma (override O-01), libellés dans la langue courante. */
export const views = (): { id: ViewMode; label: string; title: string }[] =>
  (["mcd", "mld", "mpd"] as const).map((id) => ({ id, label: t(`view.${id}`), title: t(`view.${id}.title`) }));

/**
 * Barre d'outils principale (overrides O-45, O-51) : l'édition seulement ; fichier, sections,
 * thème et options sont dans le menu ≡, le zoom dans la barre d'état. `floating` : barre flottante, largeur ajustée à son
 * contenu ; `onGripDown` : poignée de déplacement (gérée par `ToolbarHost`).
 */
export function Toolbar({
  floating = false,
  onGripDown,
}: {
  floating?: boolean;
  onGripDown?: (e: PointerEvent<HTMLElement>) => void;
}) {
  const { tool, setShareOpen } = useUiStore();
  const sharing = useCollabStore((s) => s.mode === "host" || s.mode === "guest");
  const doc = useDocumentHandle();
  // Lecture seule (lecteur, reconnexion) : seul l'outil de sélection reste (O-05 §4.3).
  const readOnly = useSessionReadOnly(doc);
  useEffect(() => {
    if (readOnly && tool !== "select") {
      chooseTool(doc, "select");
    }
  }, [readOnly, tool, doc]);
  const view = useDocumentView((s) => s.view);
  const layoutRunning = useDocumentView((s) => s.layoutRunning);
  const undoLabel = useDocument(selectUndoLabel);
  const redoLabel = useDocument(selectRedoLabel);
  const { undo, redo } = doc.store.getState();

  return (
    <div
      className={
        floating
          ? "inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-neutral-50 py-1 pr-2 pl-1 whitespace-nowrap shadow-2xl dark:border-neutral-600 dark:bg-neutral-900"
          : "flex items-center gap-1 border-b border-neutral-200 bg-neutral-50 py-1 pr-2 pl-1 dark:border-neutral-700 dark:bg-neutral-900"
      }
    >
      {/* biome-ignore lint/a11y/useSemanticElements: poignée de déplacement au pointeur, hors de l'ordre de tabulation */}
      <span
        role="button"
        tabIndex={-1}
        aria-label={t("toolbar.grip")}
        {...tip(t("toolbar.grip"))}
        data-toolbar-grip=""
        onPointerDown={onGripDown}
        className="flex h-7 w-3 cursor-grab items-center justify-center text-neutral-400"
      >
        <GripVertical size={14} />
      </span>
      <AppMenu />
      <Group>{historyButtons(undoLabel, redoLabel, undo, redo)}</Group>
      <Group>
        {viewTabs(doc, view)}
        <DisplayMenu />
      </Group>
      <Group>{toolButtons(doc, tool, view, readOnly)}</Group>
      <Group>{autoLayoutButton(layoutRunning)}</Group>
      {floating ? <div className="w-1" /> : <div className="flex-1" />}
      <IconButton tooltip={t("collab.share")} active={sharing} onClick={() => setShareOpen(true)}>
        <Users size={16} />
      </IconButton>
      <Menu
        trigger={({ toggle }) => (
          <button
            type="button"
            aria-label={t("toolbar.menu")}
            {...tip(t("toolbar.menu"))}
            onClick={toggle}
            className="ml-1 flex size-5 items-center justify-center rounded border border-neutral-300 text-neutral-500 hover:bg-neutral-200 dark:border-neutral-600 dark:hover:bg-neutral-700"
          >
            <ChevronDown size={12} />
          </button>
        )}
      >
        {(close) => (
          <MenuItem
            onSelect={() => {
              updateDock((l) => setToolbar(l, { floating: !floating }));
              close();
            }}
          >
            {t(floating ? "toolbar.dock" : "toolbar.detach")}
          </MenuItem>
        )}
      </Menu>
    </div>
  );
}

type HistoryLabel = ReturnType<typeof selectUndoLabel>;

/** Annuler et rétablir, avec le libellé de l'action concernée. */
function historyButtons(undoLabel: HistoryLabel, redoLabel: HistoryLabel, undo: () => void, redo: () => void) {
  return (
    <>
      <IconButton
        tooltip={undoLabel ? t("toolbar.undoAction", { label: t(undoLabel), key: `${MOD}Z` }) : t("toolbar.undo")}
        disabled={!undoLabel}
        onClick={undo}
      >
        <Undo2 size={16} />
      </IconButton>
      <IconButton
        tooltip={redoLabel ? t("toolbar.redoAction", { label: t(redoLabel), key: `⇧${MOD}Z` }) : t("toolbar.redo")}
        disabled={!redoLabel}
        onClick={redo}
      >
        <Redo2 size={16} />
      </IconButton>
    </>
  );
}

/** Placement automatique ; pendant le calcul, un loader à la place du contenu, et un clic l'annule (O-62). */
function autoLayoutButton(running: boolean) {
  return (
    <IconButton
      tooltip={t(running ? "toolbar.autoLayoutRunning" : "toolbar.autoLayout")}
      onClick={() => mainCommand({ name: running ? "cancelAutoLayout" : "autoLayout" })}
    >
      {running ? (
        <LoaderCircle size={16} className="animate-spin" />
      ) : (
        <>
          <LayoutDashboard size={16} />
          <span className="hidden text-xs whitespace-nowrap 2xl:inline">{t("toolbar.autoLayoutShort")}</span>
        </>
      )}
    </IconButton>
  );
}

/** Onglets des vues MCD, MLD, MPD (⌘1 à ⌘3). */
function viewTabs(doc: DocumentHandle, view: ViewMode) {
  return (
    <div role="tablist" className="flex overflow-hidden rounded border border-neutral-300 dark:border-neutral-600">
      {views().map((v, i) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={view === v.id}
          {...tip(`${v.title} (${MOD}${i + 1})`)}
          onClick={() => showView(doc, v.id)}
          className={`px-2.5 py-0.5 text-xs font-semibold ${
            view === v.id
              ? "bg-blue-600 text-white"
              : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Outils de la fenêtre ; ceux sans objet dans la vue ou en lecture seule sont grisés (O-54). */
function toolButtons(doc: DocumentHandle, tool: Tool, view: ViewMode, readOnly: boolean) {
  return (
    <>
      {TOOLS.map((x) => (
        <IconButton
          key={x.id}
          tooltip={t("tool.tooltip", { label: t(x.label), key: x.key })}
          active={tool === x.id}
          disabled={(!toolAvailable(x.id, view) || readOnly) && x.id !== "select"}
          onClick={() => chooseTool(doc, x.id)}
        >
          {x.icon}
          <span className="hidden text-xs whitespace-nowrap 2xl:inline">{t(x.label)}</span>
        </IconButton>
      ))}
    </>
  );
}

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 border-r border-neutral-200 pr-1 dark:border-neutral-700">{children}</div>
  );
}

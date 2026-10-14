import { DBMS_LIST, versionOptions } from "@core/index";
import {
  DatabaseZap,
  FilePlus,
  FolderOpen,
  ImageDown,
  LayoutDashboard,
  Maximize,
  Monitor,
  Moon,
  MousePointer2,
  Redo2,
  Save,
  Info,
  Settings,
  Spline,
  Square,
  Sun,
  Triangle,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { setDbmsVersion, setTargetDbms } from "@/app/commands";
import { selectRedoLabel, selectUndoLabel, useDocumentStore } from "@/app/documentStore";
import { newDocument, openDocument, saveDocument } from "@/app/fileCommands";
import { usePreferencesStore, type ThemePreference } from "@/app/preferencesStore";
import { useUiStore, type Tool, type ViewMode } from "@/app/uiStore";
import { t, type MessageKey } from "@/i18n";
import { autoLayoutTables } from "@/ui/canvas/autoLayout";
import { fitToWindow, zoomBy, zoomTo } from "@/ui/canvas/viewport";
import { IconButton, inputClass } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { MOD } from "@/ui/shortcuts";

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
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x={2} y={7} width={20} height={10} rx={5} />
    </svg>
  );
}

/** Vues du schéma (override O-01), libellés dans la langue courante. */
export const views = (): { id: ViewMode; label: string; title: string }[] =>
  (["mcd", "mld", "mpd"] as const).map((id) => ({ id, label: t(`view.${id}`), title: t(`view.${id}.title`) }));

const THEMES: { id: ThemePreference; label: MessageKey; icon: ReactNode }[] = [
  { id: "system", label: "theme.system", icon: <Monitor size={16} /> },
  { id: "light", label: "theme.light", icon: <Sun size={16} /> },
  { id: "dark", label: "theme.dark", icon: <Moon size={16} /> },
];

export function Toolbar() {
  const { tool, setTool, viewport, view, setView, setOptionsOpen, setExportOpen, setReverseOpen, setAbout } = useUiStore();
  const undoLabel = useDocumentStore(selectUndoLabel);
  const redoLabel = useDocumentStore(selectRedoLabel);
  const { dbms, dbmsVersion } = useDocumentStore((s) => s.doc.settings);
  const { undo, redo } = useDocumentStore.getState();
  const { theme, setTheme } = usePreferencesStore();
  const themeIndex = THEMES.findIndex((x) => x.id === theme);
  const currentTheme = THEMES[themeIndex] ?? THEMES[0]!;

  return (
    <div className="flex items-center gap-1 border-b border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900">
      <Group>
        <IconButton tooltip={t("toolbar.new", { key: `${MOD}N` })} onClick={() => void newDocument()}>
          <FilePlus size={16} />
        </IconButton>
        <IconButton tooltip={t("toolbar.open", { key: `${MOD}O` })} onClick={() => void openDocument()}>
          <FolderOpen size={16} />
        </IconButton>
        <IconButton tooltip={t("toolbar.save", { key: `${MOD}S` })} onClick={() => void saveDocument()}>
          <Save size={16} />
        </IconButton>
        <IconButton tooltip={t("toolbar.exportImage", { key: `${MOD}E` })} onClick={() => setExportOpen(true)}>
          <ImageDown size={16} />
        </IconButton>
        <IconButton tooltip={t("toolbar.reverse")} onClick={() => setReverseOpen(true)}>
          <DatabaseZap size={16} />
        </IconButton>
      </Group>
      <Group>
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
      </Group>
      <Group>
        <div role="tablist" className="flex overflow-hidden rounded border border-neutral-300 dark:border-neutral-600">
          {views().map((v, i) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              {...tip(`${v.title} (${MOD}${i + 1})`)}
              onClick={() => setView(v.id)}
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
      </Group>
      <Group>
        {TOOLS.map((x) => (
          <IconButton
            key={x.id}
            tooltip={t("tool.tooltip", { label: t(x.label), key: x.key })}
            active={tool === x.id}
            disabled={view !== "mcd" && x.id !== "select"}
            onClick={() => setTool(x.id)}
          >
            {x.icon}
            <span className="hidden text-xs whitespace-nowrap 2xl:inline">{t(x.label)}</span>
          </IconButton>
        ))}
      </Group>
      <Group>
        <IconButton tooltip={t("toolbar.zoomOut")} onClick={() => zoomBy(1 / 1.2)}>
          <ZoomOut size={16} />
        </IconButton>
        <button
          type="button"
          {...tip(t("toolbar.zoomReset"))}
          className="w-12 text-center text-xs text-neutral-600 tabular-nums hover:underline dark:text-neutral-300"
          onClick={() => zoomTo(1)}
        >
          {Math.round(viewport.zoom * 100)} %
        </button>
        <IconButton tooltip={t("toolbar.zoomIn")} onClick={() => zoomBy(1.2)}>
          <ZoomIn size={16} />
        </IconButton>
        <IconButton tooltip={t("toolbar.fit")} onClick={() => fitToWindow(useDocumentStore.getState().doc)}>
          <Maximize size={16} />
        </IconButton>
      </Group>
      <Group>
        <IconButton tooltip={t("toolbar.autoLayout")} onClick={() => void autoLayoutTables()}>
          <LayoutDashboard size={16} />
          <span className="hidden text-xs whitespace-nowrap 2xl:inline">{t("toolbar.autoLayoutShort")}</span>
        </IconButton>
      </Group>
      <div className="flex-1" />
      <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400" {...tip(t("toolbar.dbmsTooltip"))}>
        {t("toolbar.dbms")}
        <select className={`${inputClass} w-auto`} value={dbms} onChange={(e) => setTargetDbms(e.target.value as typeof dbms)}>
          {DBMS_LIST.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          className={`${inputClass} w-auto`}
          value={dbmsVersion}
          aria-label={t("toolbar.version")}
          onChange={(e) => setDbmsVersion(e.target.value)}
        >
          {versionOptions(dbms).map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <IconButton
        tooltip={t("toolbar.themeCycle", { theme: t(currentTheme.label) })}
        onClick={() => setTheme(THEMES[(themeIndex + 1) % THEMES.length]!.id)}
      >
        {currentTheme.icon}
      </IconButton>
      <IconButton tooltip={t("toolbar.options", { key: `${MOD},` })} onClick={() => setOptionsOpen(true)}>
        <Settings size={16} />
      </IconButton>
      <IconButton tooltip={t("toolbar.about")} onClick={() => setAbout("about")}>
        <Info size={16} />
      </IconButton>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 border-r border-neutral-200 pr-1 dark:border-neutral-700">{children}</div>
  );
}

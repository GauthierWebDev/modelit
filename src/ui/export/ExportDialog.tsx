import { useEffect, useState } from "react";
import { showError } from "@/app/dialogStore";
import { useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import type { ViewMode } from "@/app/document/documentView";
import type { DocumentHandle } from "@/app/document/handle";
import { fileName } from "@/app/documentNames";
import { fileAccess } from "@/app/fileAccess";
import { usePreferencesStore } from "@/app/preferencesStore";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { inputClass } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { views } from "@/ui/toolbar/Toolbar";
import { areaSpec, EXPORT_AREAS, effectiveArea } from "./exportArea";
import { DPI_OPTIONS, ExportError, FORMATS, renderExport } from "./exportImage";

/** Boîte « Exporter l'image » (override O-17). */
export function ExportDialog() {
  const { open, setOpen, doc, prefs, setPrefs, view, setView, busy, setBusy, hasSelection } = useExportDialog();
  if (!open) {
    return null;
  }
  const format = FORMATS.find((f) => f.id === prefs.format)!;
  const transparent = format.transparent && prefs.transparent;

  const form: ExportForm = { prefs, setPrefs, view, setView, format, transparent, hasSelection };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: fond de la boîte, un clic à l'extérieur la ferme
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: fond de la boîte, un clic à l'extérieur la ferme
    <div
      data-ui-only={true}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={() => setOpen(false)}
    >
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: un clic dans la boîte ne doit pas atteindre le fond */}
      <div
        role="dialog"
        aria-label={t("export.title")}
        className="w-96 rounded-lg border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{t("export.title")}</h2>
        <div className="flex flex-col gap-3 text-sm">
          {formatAndView(form)}
          {areaChoice(form)}
          {colorsAndResolution(form)}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => setOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={() => void runExport({ doc, view, prefs, format, transparent, setBusy, setOpen })}
          >
            {busy ? t("export.running") : t("export.run")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** État de la boîte : vue choisie (celle affichée à l'ouverture), export en cours ; Échap ferme. */
function useExportDialog() {
  const open = useUiStore((s) => s.exportOpen);
  const setOpen = useUiStore((s) => s.setExportOpen);
  const doc = useDocumentHandle();
  const currentView = useDocumentView((s) => s.view);
  const prefs = usePreferencesStore((s) => s.export);
  const setPrefs = usePreferencesStore((s) => s.setExport);
  const [view, setView] = useState<ViewMode>(currentView);
  const [busy, setBusy] = useState(false);
  const hasSelection = useDocumentView((s) => s.selection.length > 0);

  useEffect(() => {
    if (open) {
      setView(doc.view.getState().view);
    }
  }, [open, doc]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  return { open, setOpen, doc, prefs, setPrefs, view, setView, busy, setBusy, hasSelection };
}

type Prefs = ReturnType<typeof usePreferencesStore.getState>["export"];
type Format = (typeof FORMATS)[number];

interface ExportRun {
  doc: DocumentHandle;
  view: ViewMode;
  prefs: Prefs;
  format: Format;
  transparent: boolean;
  setBusy: (busy: boolean) => void;
  setOpen: (open: boolean) => void;
}

/** Dessine la vue demandée sans sélection, l'enregistre, puis rétablit la vue et la sélection. */
async function runExport({ doc, view, prefs, format, transparent, setBusy, setOpen }: ExportRun) {
  setBusy(true);
  const ui = useUiStore.getState();
  const display = doc.view.getState();
  const previous = { view: display.view, selection: display.selection };
  // Zone relevée avant de vider la sélection pour la capture (O-63).
  const area = areaSpec(doc, view, effectiveArea(prefs.area, previous.selection));
  try {
    // Dessin de la vue demandée, sans sélection, avant capture (l'outil de la fenêtre n'est pas touché).
    display.select([]);
    display.setView(view);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const blob = await renderExport({
      format: prefs.format,
      view,
      theme: prefs.theme,
      background: transparent ? null : prefs.color,
      dpi: prefs.dpi,
      area,
    });
    const path = doc.store.getState().filePath;
    const base = path ? fileName(path).replace(/\.[^.]+$/, "") : t("export.defaultName");
    const saved = await fileAccess().saveExport(blob, `${base}-${view}.${prefs.format}`, {
      name: format.label,
      extensions: [prefs.format],
    });
    if (saved) {
      setOpen(false);
      ui.notify({ kind: "info", text: t("export.done", { file: fileName(saved) }) });
    }
  } catch (e) {
    await showError(e instanceof ExportError ? e.message : t("export.failed", { error: String(e) }));
  } finally {
    display.setView(previous.view);
    display.select(previous.selection);
    setBusy(false);
  }
}

/** Zone exportée : partie affichée, sélection ou schéma complet (O-63). */
function areaChoice({ prefs, setPrefs, hasSelection }: ExportForm) {
  const current = effectiveArea(prefs.area, hasSelection ? ["x"] : []);
  return (
    <div>
      <p className={label}>{t("export.area")}</p>
      <div className="mt-1 grid grid-cols-3 overflow-hidden rounded border border-neutral-300 dark:border-neutral-600">
        {EXPORT_AREAS.map((a) => {
          const disabled = a === "selection" && !hasSelection;
          return (
            <span
              key={a}
              className="inline-flex"
              {...tip(t(disabled ? "export.area.noSelection" : `export.area.${a}Tip`))}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPrefs({ area: a })}
                className={`w-full py-1 text-xs font-semibold disabled:opacity-40 ${current === a ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              >
                {t(`export.area.${a}`)}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface ExportForm {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  view: ViewMode;
  setView: (view: ViewMode) => void;
  format: Format;
  transparent: boolean;
  hasSelection: boolean;
}

const label = "text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400";

/** Format de fichier et vue exportée. */
function formatAndView({ prefs, setPrefs, view, setView }: ExportForm) {
  return (
    <>
      <div>
        <p className={label}>{t("export.format")}</p>
        <div className="mt-1 grid grid-cols-4 overflow-hidden rounded border border-neutral-300 dark:border-neutral-600">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setPrefs({ format: f.id })}
              {...tip(f.id === "svg" ? t("export.svg") : f.label)}
              className={`py-1 text-xs font-semibold ${prefs.format === f.id ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            >
              {f.id.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <label className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <span className={label}>{t("export.view")}</span>
        <select className={inputClass} value={view} onChange={(e) => setView(e.target.value as ViewMode)}>
          {views().map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} — {v.title}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Thème, fond (transparent ou couleur) et résolution (images matricielles). */
function colorsAndResolution({ prefs, setPrefs, format, transparent }: ExportForm) {
  return (
    <>
      <label className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <span className={label}>{t("export.colors")}</span>
        <select
          className={inputClass}
          value={prefs.theme}
          onChange={(e) => setPrefs({ theme: e.target.value as Prefs["theme"] })}
        >
          <option value="screen">{t("export.themeScreen")}</option>
          <option value="light">{t("export.themeLight")}</option>
          <option value="dark">{t("export.themeDark")}</option>
        </select>
      </label>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <span className={label}>{t("export.background")}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1" {...tip(format.transparent ? null : t("export.jpgNoAlpha"))}>
            <input
              type="radio"
              name="background"
              disabled={!format.transparent}
              checked={transparent}
              onChange={() => setPrefs({ transparent: true })}
            />
            {t("export.transparent")}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="background"
              checked={!transparent}
              onChange={() => setPrefs({ transparent: false })}
            />
            {t("export.color")}
          </label>
          <input
            type="color"
            aria-label={t("export.colorLabel")}
            disabled={transparent}
            value={prefs.color}
            onChange={(e) => setPrefs({ color: e.target.value })}
            className="h-6 w-10 cursor-pointer rounded border border-neutral-300 disabled:opacity-40 dark:border-neutral-600"
          />
        </div>
      </div>
      {prefs.format !== "svg" && (
        <label className="grid grid-cols-[7rem_1fr] items-center gap-2">
          <span className={label}>{t("export.resolution")}</span>
          <select className={inputClass} value={prefs.dpi} onChange={(e) => setPrefs({ dpi: Number(e.target.value) })}>
            {DPI_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t("export.dpi", { dpi: d, percent: Math.round((d / 96) * 100) })}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

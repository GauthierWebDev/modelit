import { type CustomDbms, DBMS_LIST, type Dbms, GENERIC_VERSION, versionFeatures, versionOptions } from "@core/index";
import { Database, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyCustomDbms, setDbmsVersion, setTargetDbms, dbmsLabel as targetLabel } from "@/app/commands";
import { useDocument, useDocumentHandle } from "@/app/document/DocumentContext";
import type { DocumentHandle } from "@/app/document/handle";
import { usePreferencesStore } from "@/app/preferencesStore";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { Field, inputClass, Select } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";

/**
 * Cible du modèle dans la barre d'état (override O-49) : un bouton « PostgreSQL 18 » qui ouvre une
 * boîte éphémère au-dessus de lui. Les choix s'appliquent tout de suite (une entrée d'historique
 * chacun) ; Échap, un clic à l'extérieur ou sur le bouton la ferment.
 */
export function DbmsTarget() {
  const doc = useDocumentHandle();
  const readOnly = useSessionReadOnly(doc);
  const { dbms, dbmsVersion, customDbms: custom } = useDocument((s) => s.doc.settings);
  const library = usePreferencesStore((s) => s.customDbms);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useTargetDismiss(open, setOpen, ref);

  const versions = versionOptions(dbms);
  const base = targetLabel(dbms, dbmsVersion);
  const features = versionFeatures(dbms, dbmsVersion);
  const redefined = custom ? Object.keys(custom.types).length : 0;
  // SGBD personnalisé (O-59) : « custom:<id> » ; celui du modèle est listé même s'il n'est pas dans la bibliothèque.
  const value = custom ? `custom:${custom.id}` : dbms;
  const customOptions = [
    ...library.map((d) => ({ id: d.id, name: d.name })),
    ...(custom && !library.some((d) => d.id === custom.id) ? [{ id: custom.id, name: custom.name }] : []),
  ];

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        aria-expanded={open}
        {...tip(t("target.tooltip"))}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex items-center gap-1 rounded px-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${open ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
      >
        {custom ? <Wrench size={12} /> : <Database size={12} />}
        {/* biome-ignore lint/suspicious/noLeakedRender: libellé texte de la cible, affiché volontairement */}
        {custom ? custom.name : base}
      </button>
      {open
        ? targetBox({
            doc,
            library,
            readOnly,
            dbmsVersion,
            custom,
            value,
            customOptions,
            versions,
            base,
            features,
            redefined,
            close,
          })
        : null}
    </div>
  );
}

/** Fermeture : Échap (sans atteindre le canevas), clic à l'extérieur ; le clavier revient au canevas. */
function useTargetDismiss(open: boolean, setOpen: (open: boolean) => void, ref: { current: HTMLDivElement | null }) {
  const close = useCallback(() => {
    setOpen(false);
    // Rend le clavier au canevas : les raccourcis ne doivent pas viser une liste de la boîte.
    if (ref.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  }, [setOpen, ref]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      // Échap ferme la boîte sans désélectionner ni changer d'outil sur le canevas.
      e.stopPropagation();
      close();
    };
    globalThis.addEventListener("pointerdown", onPointer, true);
    globalThis.addEventListener("keydown", onKey, true);
    return () => {
      globalThis.removeEventListener("pointerdown", onPointer, true);
      globalThis.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, ref]);
  return close;
}

type Library = ReturnType<typeof usePreferencesStore.getState>["customDbms"];

/** SGBD standard, ou SGBD personnalisé de la bibliothèque (« custom:<id> », O-59). */
function chooseTarget(doc: DocumentHandle, library: Library, next: string) {
  if (!next.startsWith("custom:")) {
    return setTargetDbms(doc, next as Dbms);
  }
  const id = next.slice("custom:".length);
  const entry = library.find((d) => d.id === id);
  if (entry) {
    applyCustomDbms(doc, entry);
  }
}

interface BoxScope {
  doc: DocumentHandle;
  library: Library;
  readOnly: boolean;
  dbmsVersion: string;
  custom: CustomDbms | undefined;
  value: string;
  customOptions: { id: string; name: string }[];
  versions: ReturnType<typeof versionOptions>;
  base: string;
  features: string[];
  redefined: number;
  close: () => void;
}

/** Boîte éphémère : SGBD et version, SGBD personnalisé, types, nouveautés de la version. */
function targetBox(scope: BoxScope) {
  const {
    doc,
    library,
    readOnly,
    dbmsVersion,
    custom,
    value,
    customOptions,
    versions,
    base,
    features,
    redefined,
    close,
  } = scope;
  return (
    <div
      role="dialog"
      aria-label={t("target.title")}
      className="absolute right-0 bottom-full z-50 mb-1 flex w-80 flex-col gap-2 rounded border border-neutral-200 bg-white p-3 text-sm text-neutral-900 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
    >
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        {t("target.title")}
      </h2>
      <fieldset disabled={readOnly} className="flex flex-col gap-2">
        <Field label={t("toolbar.dbms")}>
          <select className={inputClass} value={value} onChange={(e) => chooseTarget(doc, library, e.target.value)}>
            {DBMS_LIST.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
            {customOptions.length > 0 && (
              <optgroup label={t("customDbms.library")}>
                {customOptions.map((d) => (
                  <option key={d.id} value={`custom:${d.id}`}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        <Field label={t("toolbar.version")}>
          <Select value={dbmsVersion} options={versions} onChange={(version) => setDbmsVersion(doc, version)} />
        </Field>
      </fieldset>
      {custom ? (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t("customDbms.basedOnLabel", { dbms: base })} · {t("customDbms.typesCount", { n: redefined })}
        </p>
      ) : null}
      <button
        type="button"
        className="self-start text-xs text-blue-600 hover:underline dark:text-blue-400"
        onClick={() => {
          close();
          usePreferencesStore.getState().setModelSettingsTab("types");
          useUiStore.getState().setModelSettingsOpen(true);
        }}
      >
        {t("customDbms.editTypes")}
      </button>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{featuresText(dbmsVersion, features)}</div>
      {readOnly ? <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("target.readOnly")}</p> : null}
    </div>
  );
}

/** Nouveautés de la version cible prises en compte par le générateur. */
function featuresText(dbmsVersion: string, features: string[]) {
  return (
    <>
      {dbmsVersion === GENERIC_VERSION ? (
        t("target.generic")
      ) : features.length > 0 ? (
        <>
          {t("target.features")}
          <ul className="mt-1 list-disc pl-4">
            {features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      ) : (
        t("target.noFeatures")
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { Database } from "lucide-react";
import { DBMS_LIST, GENERIC_VERSION, versionFeatures, versionOptions } from "@core/index";
import { setDbmsVersion, setTargetDbms } from "@/app/commands";
import { useDocument, useDocumentHandle } from "@/app/document/DocumentContext";
import { t } from "@/i18n";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { Field, Select } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";

/**
 * Cible du modèle dans la barre d'état (override O-49) : un bouton « PostgreSQL 18 » qui ouvre une
 * boîte éphémère au-dessus de lui. Les choix s'appliquent tout de suite (une entrée d'historique
 * chacun) ; Échap, un clic à l'extérieur ou sur le bouton la ferment.
 */
export function DbmsTarget() {
  const doc = useDocumentHandle();
  const readOnly = useSessionReadOnly(doc);
  const { dbms, dbmsVersion } = useDocument((s) => s.doc.settings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    // Rend le clavier au canevas : les raccourcis ne doivent pas viser une liste de la boîte.
    if (ref.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Échap ferme la boîte sans désélectionner ni changer d'outil sur le canevas.
      e.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const dbmsLabel = DBMS_LIST.find((d) => d.id === dbms)?.label ?? dbms;
  const versions = versionOptions(dbms);
  const versionLabel = dbmsVersion === GENERIC_VERSION ? null : versions.find((v) => v.id === dbmsVersion)?.label;
  const features = versionFeatures(dbms, dbmsVersion);

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        aria-expanded={open}
        {...tip(t("target.tooltip"))}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex items-center gap-1 rounded px-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${open ? "bg-neutral-200 dark:bg-neutral-700" : ""}`}
      >
        <Database size={12} />
        {versionLabel ? `${dbmsLabel} ${versionLabel}` : dbmsLabel}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("target.title")}
          className="absolute right-0 bottom-full z-50 mb-1 flex w-80 flex-col gap-2 rounded border border-neutral-200 bg-white p-3 text-sm text-neutral-900 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{t("target.title")}</h2>
          <fieldset disabled={readOnly} className="flex flex-col gap-2">
            <Field label={t("toolbar.dbms")}>
              <Select value={dbms} options={DBMS_LIST.map((d) => ({ id: d.id, label: d.label }))} onChange={(value) => setTargetDbms(doc, value)} />
            </Field>
            <Field label={t("toolbar.version")}>
              <Select value={dbmsVersion} options={versions} onChange={(value) => setDbmsVersion(doc, value)} />
            </Field>
          </fieldset>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            {dbmsVersion === GENERIC_VERSION ? (
              t("target.generic")
            ) : features.length ? (
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
          </div>
          {readOnly && <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("target.readOnly")}</p>}
        </div>
      )}
    </div>
  );
}

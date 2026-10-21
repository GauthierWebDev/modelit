import {
  type CustomDbms,
  DBMS_LIST,
  type Dbms,
  type DocumentSettings,
  defaultTemplate,
  TYPE_KEYS,
  type TypeKey,
  versionOptions,
} from "@core/index";
import { Wrench } from "lucide-react";
import * as cmd from "@/app/commands";
import { useDocument, useDocumentHandle } from "@/app/document/DocumentContext";
import { type LibraryDbms, usePreferencesStore } from "@/app/preferencesStore";
import { type MessageKey, t } from "@/i18n";
import { CommitInput, Select } from "@/ui/common/controls";

/**
 * Onglet « Types SQL » des paramètres du modèle (override O-59) : types du SGBD cible, et SGBD
 * personnalisé du modèle (nom, base, types redéfinis), lié à la bibliothèque « Mes SGBD » du poste.
 */

/** Définition du modèle, telle qu'elle serait enregistrée dans la bibliothèque. */
export const libraryEntry = (s: Pick<DocumentSettings, "dbms" | "dbmsVersion">, custom: CustomDbms): LibraryDbms => ({
  ...custom,
  types: { ...custom.types },
  base: s.dbms,
  version: s.dbmsVersion,
});

/** Même définition (nom, base, types) : le modèle et la bibliothèque sont à jour l'un de l'autre. */
export function sameDefinition(a: LibraryDbms, b: LibraryDbms): boolean {
  const keys = new Set([...Object.keys(a.types), ...Object.keys(b.types)]) as Set<TypeKey>;
  return (
    a.name === b.name &&
    a.base === b.base &&
    a.version === b.version &&
    [...keys].every((k) => a.types[k] === b.types[k])
  );
}

const button =
  "rounded border border-neutral-300 px-2 py-0.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-700";

export function TypesTab() {
  const handle = useDocumentHandle();
  const settings = useDocument((d) => d.doc.settings);
  const { dbms, dbmsVersion, customDbms: custom } = settings;
  const library = usePreferencesStore((s) => s.customDbms);
  const save = usePreferencesStore((s) => s.saveCustomDbms);
  const base = cmd.dbmsLabel(dbms, dbmsVersion);

  const entry = custom ? libraryEntry(settings, custom) : null;
  const saved = custom ? library.find((d) => d.id === custom.id) : undefined;

  return (
    <div className="flex flex-col gap-3">
      {!custom || !entry ? (
        <div className="flex items-center gap-3 rounded bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
          <p className="flex-1">{t("customDbms.standard", { dbms: base })}</p>
          <button type="button" className={button} onClick={() => cmd.customizeTarget(handle)}>
            {t("customDbms.customize")}
          </button>
        </div>
      ) : (
        <section className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40">
          <div className="grid grid-cols-[8rem_1fr] items-center gap-2 text-sm">
            <span className="flex items-center gap-1 text-neutral-600 dark:text-neutral-300">
              <Wrench size={12} /> {t("customDbms.name")}
            </span>
            <CommitInput value={custom.name} onCommit={(name) => cmd.renameCustomDbms(handle, name)} />
            <span className="text-neutral-600 dark:text-neutral-300">{t("customDbms.basedOn")}</span>
            <div className="flex gap-1">
              <Select<Dbms>
                value={dbms}
                options={DBMS_LIST.map((d) => ({ id: d.id, label: d.label }))}
                onChange={(v) => cmd.setTargetDbms(handle, v, true)}
              />
              <Select
                value={dbmsVersion}
                options={versionOptions(dbms)}
                onChange={(v) => cmd.setDbmsVersion(handle, v)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            <span className="flex-1">
              {!saved
                ? t("customDbms.notSaved")
                : sameDefinition(saved, entry)
                  ? t("customDbms.saved")
                  : t("customDbms.differs")}
            </span>
            {(!saved || !sameDefinition(saved, entry)) && (
              <button type="button" className={button} onClick={() => save(entry)}>
                {saved ? t("customDbms.updateLibrary") : t("customDbms.save")}
              </button>
            )}
            {saved && !sameDefinition(saved, entry) && (
              <button type="button" className={button} onClick={() => cmd.applyCustomDbms(handle, saved)}>
                {t("customDbms.takeLibrary")}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              disabled={!Object.keys(custom.types).length}
              onClick={() => cmd.resetCustomTypes(handle)}
            >
              {t("customDbms.resetAll")}
            </button>
            <button type="button" className={button} onClick={() => cmd.removeCustomization(handle)}>
              {t("customDbms.remove", { dbms: base })}
            </button>
          </div>
        </section>
      )}

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {custom ? t("customDbms.help") : t("customDbms.helpStandard")}
      </p>
      <div className="grid grid-cols-[14rem_1fr] items-center gap-x-3 gap-y-1 text-sm">
        {TYPE_KEYS.map((key) => {
          const fallback = defaultTemplate(key, dbms, dbmsVersion) ?? "—";
          const redefined = custom?.types[key];
          return (
            <TypeRow key={key} label={t(`sqlType.${key}` as MessageKey)} redefined={Boolean(redefined)}>
              {custom ? (
                <CommitInput
                  value={redefined ?? ""}
                  placeholder={fallback}
                  onCommit={(v) => cmd.setCustomType(handle, key, v)}
                />
              ) : (
                <code className="px-1.5 text-neutral-600 dark:text-neutral-300">{fallback}</code>
              )}
            </TypeRow>
          );
        })}
      </div>
    </div>
  );
}

function TypeRow({ label, redefined, children }: { label: string; redefined: boolean; children: React.ReactNode }) {
  return (
    <>
      <span
        className={`flex items-center gap-1.5 ${redefined ? "font-medium text-amber-700 dark:text-amber-400" : "text-neutral-500 dark:text-neutral-400"}`}
      >
        <span
          className={`size-1.5 flex-none rounded-full ${redefined ? "bg-amber-500" : "bg-transparent"}`}
          aria-hidden
        />
        {label}
        {redefined ? <span className="sr-only">({t("customDbms.redefined")})</span> : null}
      </span>
      {children}
    </>
  );
}

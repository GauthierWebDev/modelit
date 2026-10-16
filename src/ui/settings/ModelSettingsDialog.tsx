import { type DdlOptions, type SqlDialect, sourceDialects, TYPOLOGIES } from "@core/index";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import * as cmd from "@/app/commands";
import { useDocument, useDocumentHandle } from "@/app/document/DocumentContext";
import { type ModelSettingsTab, usePreferencesStore } from "@/app/preferencesStore";
import { useUiStore } from "@/app/uiStore";
import { type MessageKey, t } from "@/i18n";
import { Checkbox, Select } from "@/ui/common/controls";
import { Modal } from "@/ui/common/Modal";
import { ReadOnly } from "@/ui/panels/Inspector";
import { KeyPatternField } from "@/ui/panels/sections";
import { TypesTab } from "./TypesTab";

/**
 * Boîte « Paramètres du modèle » (override O-55) : paramètres du document actif, en onglets.
 * Chaque changement s'applique tout de suite et s'annule avec ⌘Z ; pas de bouton Valider.
 */

const TABS: ModelSettingsTab[] = ["naming", "script", "conversions", "types"];

export function ModelSettingsDialog() {
  const open = useUiStore((s) => s.modelSettingsOpen);
  const setOpen = useUiStore((s) => s.setModelSettingsOpen);
  const stored = usePreferencesStore((s) => s.modelSettingsTab);
  const setTab = usePreferencesStore((s) => s.setModelSettingsTab);
  if (!open) return null;
  const tab = TABS.includes(stored) ? stored : "naming";

  return (
    <Modal
      title={t("modelSettings.title")}
      width="w-[44rem]"
      onClose={() => setOpen(false)}
      footer={
        <button
          type="button"
          className="ml-auto rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => setOpen(false)}
        >
          {t("common.close")}
        </button>
      }
    >
      <div role="tablist" className="mb-3 flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab === id
                ? "border-blue-600 font-medium text-neutral-900 dark:text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            }`}
          >
            {t(`modelSettings.tab.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-h-80 flex-col">
        <ReadOnly>
          {tab === "naming" && <NamingTab />}
          {tab === "script" && <ScriptTab />}
          {tab === "conversions" && <ConversionsTab />}
          {tab === "types" && <TypesTab />}
        </ReadOnly>
      </div>
    </Modal>
  );
}

function Group({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-neutral-200 py-3 first:pt-0 last:border-b-0 dark:border-neutral-700">
      {title && (
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          {title}
          {aside}
        </h3>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** Ligne libellé / valeur, plus large que dans une section : les listes ne sont pas tronquées. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: le champ est passé en children
    <label className="grid grid-cols-[14rem_1fr] items-start gap-3 text-sm">
      <span className="pt-0.5 text-neutral-500 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

const Help = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-neutral-500 dark:text-neutral-400">{children}</p>
);

function NamingTab() {
  const handle = useDocumentHandle();
  const s = useDocument((d) => d.doc.settings);
  return (
    <>
      <Group title={t("inspector.logicalNames")}>
        <Row label={t("inspector.typology")}>
          <Select
            value={s.naming.typology}
            options={TYPOLOGIES.map((id) => ({ id, label: t(`typology.${id}`) }))}
            onChange={(typology) =>
              cmd.updateSettings(handle, "history.typology", (d) => {
                d.naming.typology = typology;
              })
            }
          />
        </Row>
        <Checkbox
          label={t("inspector.stripAccents")}
          checked={s.naming.stripAccents}
          onChange={(v) =>
            cmd.updateSettings(handle, "history.stripAccents", (d) => {
              d.naming.stripAccents = v;
            })
          }
        />
      </Group>
      <Group title={t("inspector.keys")}>
        <Row label={t("inspector.autoIdMask")}>
          <KeyPatternField
            kind="discriminant"
            value={s.autoIdMask}
            onChange={(pattern) =>
              cmd.updateSettings(handle, "history.autoIdMask", (d) => {
                d.autoIdMask = pattern;
              })
            }
          />
        </Row>
        <Row label={t("inspector.primaryKey")}>
          <KeyPatternField
            kind="primaryKey"
            value={s.keys.primary}
            onChange={(pattern) =>
              cmd.updateSettings(handle, "history.primaryKeyMask", (d) => {
                d.keys.primary = pattern;
              })
            }
          />
        </Row>
        <Row label={t("inspector.foreignKey")}>
          <KeyPatternField
            kind="foreignKey"
            value={s.keys.foreign}
            onChange={(pattern) =>
              cmd.updateSettings(handle, "history.foreignKeyMask", (d) => {
                d.keys.foreign = pattern;
              })
            }
          />
        </Row>
        <Help>{t("inspector.keysHelp")}</Help>
      </Group>
    </>
  );
}

/** Modifie une option du script SQL (une entrée d'historique). */
function useDdlOption() {
  const handle = useDocumentHandle();
  const ddl = useDocument((d) => d.doc.settings.ddl);
  const set = <K extends keyof DdlOptions>(key: K, value: DdlOptions[K]) =>
    cmd.updateSettings(handle, "history.ddlOptions", (d) => {
      d.ddl[key] = value;
    });
  return { ddl, set };
}

/** Liste d'une option à valeurs énumérées : libellés `ddl.<option>.<valeur>`. */
function OptionSelect<K extends keyof DdlOptions>({
  option,
  values,
}: {
  option: K;
  values: readonly (DdlOptions[K] & string)[];
}) {
  const { ddl, set } = useDdlOption();
  return (
    <Row label={t(`ddl.${option}` as MessageKey)}>
      <Select
        value={ddl[option] as DdlOptions[K] & string}
        options={values.map((id) => ({ id, label: t(`ddl.${option}.${id}` as MessageKey) }))}
        onChange={(v) => set(option, v)}
      />
    </Row>
  );
}

function OptionCheck({ option }: { option: "foreignKeysInAlter" | "indexes" | "sourceColumnOrder" | "strictRanges" }) {
  const { ddl, set } = useDdlOption();
  return <Checkbox label={t(`ddl.${option}`)} checked={ddl[option]} onChange={(v) => set(option, v)} />;
}

function ScriptTab() {
  return (
    <Group>
      <OptionCheck option="foreignKeysInAlter" />
      <OptionCheck option="indexes" />
      <OptionCheck option="sourceColumnOrder" />
      <OptionSelect option="constraintNaming" values={["none", "prefix", "suffix"]} />
    </Group>
  );
}

/** Conversions des scripts rétroconçus, par SGBD source (O-35 à O-42). */
const SOURCES: { id: "all" | SqlDialect; content: ReactNode }[] = [
  {
    id: "all",
    content: (
      <>
        <OptionSelect option="collations" values={["icu", "deterministic"]} />
        <OptionSelect option="spatial" values={["postgis", "wkb", "wkt"]} />
      </>
    ),
  },
  {
    id: "mysql",
    content: (
      <>
        <OptionSelect option="unsigned" values={["widen", "check"]} />
        <OptionSelect option="enums" values={["check", "type"]} />
        <OptionSelect option="sets" values={["array", "text"]} />
      </>
    ),
  },
  {
    id: "oracle",
    content: (
      <>
        <OptionSelect option="oracleDates" values={["timestamp", "date"]} />
        <OptionSelect option="emptyStrings" values={["check", "none"]} />
        <OptionCheck option="strictRanges" />
      </>
    ),
  },
  {
    id: "sqlserver",
    content: (
      <>
        <OptionSelect option="sqlServerCollation" values={["ci_as", "ci_ai", "cs_as"]} />
        <OptionSelect option="dboSchema" values={["public", "dbo"]} />
      </>
    ),
  },
];

function ConversionsTab() {
  const entities = useDocument((d) => d.doc.entities);
  const associations = useDocument((d) => d.doc.associations);
  const present = sourceDialects({ entities, associations });
  return (
    <>
      {present.size === 0 && (
        <p className="mb-3 rounded bg-neutral-100 px-2 py-1.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {t("modelSettings.noSource")}
        </p>
      )}
      {SOURCES.map(({ id, content }) => (
        <SourceGroup key={id} id={id} present={id === "all" ? present.size > 0 : present.has(id)}>
          {content}
        </SourceGroup>
      ))}
    </>
  );
}

/** Groupe d'un SGBD source : déplié s'il est présent dans le modèle, sinon replié. */
function SourceGroup({ id, present, children }: { id: "all" | SqlDialect; present: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(present || id === "all");
  return (
    <section className="border-b border-neutral-200 py-2 last:border-b-0 dark:border-neutral-700">
      {/* Pas un <button> : il reste utilisable en lecture seule, où l'on consulte sans modifier. */}
      {/* biome-ignore lint/a11y/useSemanticElements: voir ci-dessus, utilisable en lecture seule */}
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          setOpen(!open);
        }}
        className="flex cursor-pointer items-center gap-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase select-none hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {t(`modelSettings.source.${id}` as MessageKey)}
        {present && id !== "all" && (
          <span className="rounded bg-blue-100 px-1.5 font-normal tracking-normal text-blue-800 normal-case dark:bg-blue-900 dark:text-blue-200">
            {t("modelSettings.present")}
          </span>
        )}
      </span>
      {open && <div className="mt-2 flex flex-col gap-2 pl-4">{children}</div>}
    </section>
  );
}

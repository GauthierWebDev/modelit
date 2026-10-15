import { DBMS_LIST, resolveVersion, versionOptions, type Dbms } from "@core/index";
import type { ReactNode } from "react";
import { applyDefaultsToCurrent } from "@/app/commands";
import { usePreferencesStore, type AutosaveBackend, type ThemePreference } from "@/app/preferencesStore";
import { useDocumentHandle } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { checkForUpdatesNow } from "@/app/updates";
import { LOCALES, t } from "@/i18n";
import { mcpAvailable } from "@/platform/mcp";
import { updatesSupported } from "@/platform/updater";
import { McpOptions } from "@/ui/mcp/McpOptions";
import { IdentityOptions } from "@/ui/collab/IdentityOptions";
import { Checkbox, CommitInput, Field, inputClass, Select } from "@/ui/common/controls";
import { Modal } from "@/ui/common/Modal";
import { KeyPatternField } from "@/ui/panels/sections";

/**
 * Options générales (override O-21) : réglages du poste, conservés dans le localStorage.
 * Thème, langue, lissage des cassures, réglages des nouveaux modèles, sauvegarde automatique,
 * mises à jour (application native uniquement).
 */
export function OptionsDialog() {
  const doc = useDocumentHandle();
  const open = useUiStore((s) => s.optionsOpen);
  const setOpen = useUiStore((s) => s.setOptionsOpen);
  const prefs = usePreferencesStore();
  if (!open) return null;

  const defaults = prefs.defaults;
  const setDbms = (dbms: Dbms) => prefs.setDefaults({ dbms, dbmsVersion: resolveVersion(dbms, undefined) });

  return (
    <Modal
      title={t("options.title")}
      onClose={() => setOpen(false)}
      footer={
        <>
          <p className="flex-1 text-xs text-neutral-500 dark:text-neutral-400">{t("options.storageNote")}</p>
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => setOpen(false)}
          >
            {t("common.close")}
          </button>
        </>
      }
    >
      <Group title={t("options.appearance")}>
        <Field label={t("options.theme")}>
          <Segmented<ThemePreference>
            value={prefs.theme}
            options={(["system", "light", "dark"] as const).map((id) => ({ id, label: t(`options.theme.${id}`) }))}
            onChange={prefs.setTheme}
          />
        </Field>
        <Field label={t("options.language")}>
          <Select value={prefs.locale} options={LOCALES.map((id) => ({ id, label: t(`language.${id}`) }))} onChange={prefs.setLocale} />
        </Field>
      </Group>

      <Group title={t("options.links")}>
        <Checkbox label={t("options.smoothBends")} checked={prefs.smoothBends} onChange={prefs.setSmoothBends} />
        <Help>{t("options.smoothBendsHelp")}</Help>
      </Group>

      <Group title={t("options.defaults")}>
        <Help>{t("options.defaultsHelp")}</Help>
        <Field label={t("toolbar.dbms")}>
          <div className="flex gap-1">
            <select className={inputClass} value={defaults.dbms} onChange={(e) => setDbms(e.target.value as Dbms)}>
              {DBMS_LIST.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              aria-label={t("toolbar.version")}
              value={defaults.dbmsVersion}
              onChange={(e) => prefs.setDefaults({ dbmsVersion: e.target.value })}
            >
              {versionOptions(defaults.dbms).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label={t("inspector.autoIdMask")}>
          <KeyPatternField kind="discriminant" value={defaults.autoIdMask} onChange={(autoIdMask) => prefs.setDefaults({ autoIdMask })} />
        </Field>
        <Field label={t("inspector.primaryKey")}>
          <KeyPatternField kind="primaryKey" value={defaults.primaryKey} onChange={(primaryKey) => prefs.setDefaults({ primaryKey })} />
        </Field>
        <Field label={t("inspector.foreignKey")}>
          <KeyPatternField kind="foreignKey" value={defaults.foreignKey} onChange={(foreignKey) => prefs.setDefaults({ foreignKey })} />
        </Field>
        <button
          type="button"
          className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => {
            applyDefaultsToCurrent(doc);
            useUiStore.getState().notify({ kind: "info", text: t("options.applied") });
          }}
        >
          {t("options.applyToCurrent")}
        </button>
      </Group>

      <Group title={t("options.autosave")}>
        <Help>{t("options.autosaveHelp")}</Help>
        <div role="radiogroup" className="flex flex-col gap-1 text-sm">
          {(["indexeddb", "off"] as AutosaveBackend[]).map((backend) => (
            <label key={backend} className="flex items-center gap-2">
              <input
                type="radio"
                name="autosave"
                className="accent-blue-600"
                checked={prefs.autosave === backend}
                onChange={() => prefs.setAutosave(backend)}
              />
              {t(`options.autosave.${backend}`)}
            </label>
          ))}
        </div>
        {prefs.autosave === "indexeddb" && (
          <>
            <Field label={t("options.autosaveDelay")}>
              <CommitInput
                value={String(prefs.autosaveDelay)}
                onCommit={(text) => {
                  const minutes = Number(text.replace(",", "."));
                  if (!Number.isFinite(minutes) || minutes < 0) return t("common.positiveNumberExpected");
                  prefs.setAutosaveDelay(minutes);
                }}
              />
            </Field>
            <Help>{t("options.autosaveDelayHelp")}</Help>
          </>
        )}
      </Group>

      <Group title={t("collab.title")}>
        <IdentityOptions />
      </Group>

      {mcpAvailable() && (
        <Group title={t("mcp.title")}>
          <McpOptions />
        </Group>
      )}

      {updatesSupported() && (
        <Group title={t("options.updates")}>
          <Checkbox label={t("options.updateCheck")} checked={prefs.updateCheck} onChange={prefs.setUpdateCheck} />
          <Help>{t("options.updateHelp")}</Help>
          <button
            type="button"
            className="self-start rounded border border-neutral-300 px-2 py-0.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
            onClick={() => void checkForUpdatesNow()}
          >
            {t("options.checkNow")}
          </button>
        </Group>
      )}
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-neutral-200 py-3 first:pt-0 last:border-b-0 dark:border-neutral-700">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

const Help = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-neutral-500 dark:text-neutral-400">{children}</p>
);

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex overflow-hidden rounded border border-neutral-300 dark:border-neutral-600">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 px-2 py-0.5 text-sm ${value === o.id ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

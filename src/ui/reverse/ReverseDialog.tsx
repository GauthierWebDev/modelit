import { DBMS_LIST, detectDialect, type ReverseReport, type SqlDialect } from "@core/index";
import { FileUp } from "lucide-react";
import { useId, useState } from "react";
import { showError } from "@/app/dialogStore";
import { fileAccess } from "@/app/fileAccess";
import { reverseIntoNewTab } from "@/app/reverseCommands";
import { useUiStore } from "@/app/uiStore";
import { showView } from "@/app/viewCommands";
import { t } from "@/i18n";
import { autoLayoutTables } from "@/ui/canvas/autoLayout";
import { Modal } from "@/ui/common/Modal";

/**
 * Rétroconception : script SQL → MCD (override O-28). Le script peut venir de
 * n'importe quel SGBD ; le nouveau modèle prend les réglages des options générales.
 */
export function ReverseDialog() {
  const dialectId = useId();
  const open = useUiStore((s) => s.reverseOpen);
  const setOpen = useUiStore((s) => s.setReverseOpen);
  const [sql, setSql] = useState("");
  const [report, setReport] = useState<ReverseReport | null>(null);
  /** Dialecte du script : détecté automatiquement, ou imposé (override O-29). */
  const [dialect, setDialect] = useState<SqlDialect | "auto">("auto");
  if (!open) {
    return null;
  }

  return (
    <Modal
      title={t("reverse.title")}
      width="w-[44rem]"
      onClose={() => setOpen(false)}
      footer={reverseFooter({ sql, setSql, setReport, dialect, setOpen })}
    >
      <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">{t("reverse.help")}</p>
      <textarea
        aria-label={t("reverse.title")}
        spellCheck={false}
        value={sql}
        placeholder={t("reverse.placeholder")}
        onChange={(e) => {
          setSql(e.target.value);
          setReport(null);
        }}
        className="h-64 w-full resize-y rounded border border-neutral-300 bg-white p-2 font-mono text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
      />
      {dialectChoice(dialectId, sql, dialect, setDialect)}
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t("reverse.target")}</p>
      {report ? reportView(report) : null}
    </Modal>
  );
}

/** Script lu depuis un fichier : remplace la saisie, efface le compte rendu. */
async function importFile(setSql: (sql: string) => void, setReport: (report: ReverseReport | null) => void) {
  try {
    const file = await fileAccess().openText({ name: t("file.sqlFilter"), extensions: ["sql", "ddl", "txt"] });
    if (file) {
      setSql(file.content);
      setReport(null);
    }
  } catch (e) {
    await showError(t("file.openFailed", { error: String(e) }));
  }
}

interface Run {
  sql: string;
  setSql: (sql: string) => void;
  setReport: (report: ReverseReport | null) => void;
  dialect: SqlDialect | "auto";
  setOpen: (open: boolean) => void;
}

/** Rétroconception du script, ouverte dans un nouvel onglet et placée automatiquement. */
function generate({ sql, setReport, dialect }: Run) {
  const { doc, report } = reverseIntoNewTab(sql, dialect === "auto" ? undefined : dialect);
  setReport(report);
  if (!doc) {
    return;
  }
  showView(doc, "mcd");
  void autoLayoutTables(doc);
  useUiStore.getState().notify({ kind: "info", text: t("reverse.done", { tables: report.tables }) });
}

/** Ouvrir un fichier, fermer, lancer. */
function reverseFooter(run: Run) {
  const { sql, setSql, setReport, setOpen } = run;
  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1 rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
        onClick={() => void importFile(setSql, setReport)}
      >
        <FileUp size={14} /> {t("reverse.open")}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
        onClick={() => setOpen(false)}
      >
        {t("common.close")}
      </button>
      <button
        type="button"
        disabled={!sql.trim()}
        className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        onClick={() => generate(run)}
      >
        {t("reverse.run")}
      </button>
    </>
  );
}

/** Dialecte du script : détecté (nom affiché) ou imposé. */
function dialectChoice(
  dialectId: string,
  sql: string,
  dialect: SqlDialect | "auto",
  setDialect: (dialect: SqlDialect | "auto") => void,
) {
  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      <label htmlFor={dialectId} className="text-neutral-600 dark:text-neutral-300">
        {t("reverse.dialect")}
      </label>
      <select
        id={dialectId}
        className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-sm dark:border-neutral-600 dark:bg-neutral-800"
        value={dialect}
        onChange={(e) => setDialect(e.target.value as SqlDialect | "auto")}
      >
        <option value="auto">
          {sql.trim()
            ? t("reverse.dialectAutoDetected", { dialect: dialectLabel(detectDialect(sql)) })
            : t("reverse.dialectAuto")}
        </option>
        {DBMS_LIST.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
        <option value="generic">{t("reverse.dialectGeneric")}</option>
      </select>
    </div>
  );
}

/** Compte rendu : tables, objets créés, avertissements. */
function reportView(report: ReverseReport) {
  return (
    <div role="status" className="mt-3 rounded border border-neutral-200 p-2 text-sm dark:border-neutral-700">
      <p>
        {report.tables === 0
          ? t("reverse.noTable")
          : t("reverse.report", {
              tables: report.tables,
              entities: report.entities,
              associations: report.associations,
              inheritances: report.inheritances,
              ignored: report.ignored,
            })}
      </p>
      {report.warnings.length > 0 && (
        <>
          <p className="mt-2 text-xs font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-400">
            {t("reverse.warnings")}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600 dark:text-neutral-300">
            {report.warnings.map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: liste en lecture seule, jamais réordonnée
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function dialectLabel(dialect: SqlDialect) {
  return dialect === "generic"
    ? t("reverse.dialectGeneric")
    : (DBMS_LIST.find((d) => d.id === dialect)?.label ?? dialect);
}

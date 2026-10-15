import { DBMS_LIST, groupLosses, issueMessage, mldLines, mldPlainText, type Loss } from "@core/index";
import { useState } from "react";
import { Copy } from "lucide-react";
import { useDdl, useLogicalModel } from "@/app/derived";
import { useDocument, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore, type BottomTab } from "@/app/uiStore";
import { t } from "@/i18n";
import { IconButton } from "@/ui/common/controls";

/** Panneaux « MLD textuel », « Script LDD » et « Problèmes », mis à jour en temps réel. */
export function OutputPanel() {
  const tab = useUiStore((s) => s.bottomTab);
  const setTab = useUiStore((s) => s.setBottomTab);
  const logical = useLogicalModel();
  const ddl = useDdl();
  const dbms = useDocument((s) => s.doc.settings.dbms);
  const errors = logical.issues.filter((i) => i.severity === "error").length;

  const copyText = tab === "mld" ? mldPlainText(logical) : tab === "sql" && ddl.ok ? ddl.sql : null;

  const tabs: { id: BottomTab; label: string }[] = [
    { id: "mld", label: t("output.mld") },
    { id: "sql", label: t("output.sql", { dbms: DBMS_LIST.find((d) => d.id === dbms)?.label ?? "" }) },
    { id: "issues", label: logical.issues.length ? t("output.issuesCount", { n: logical.issues.length }) : t("output.issues") },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-neutral-200 px-2 dark:border-neutral-700">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab === x.id
                ? "border-blue-600 text-neutral-900 dark:text-neutral-50"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            } ${x.id === "issues" && errors > 0 ? "text-red-600 dark:text-red-400" : ""}`}
          >
            {x.label}
          </button>
        ))}
        <div className="flex-1" />
        {copyText !== null && (
          <IconButton tooltip={t("output.copy")} onClick={() => void navigator.clipboard.writeText(copyText)}>
            <Copy size={14} />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[13px] leading-5 select-text">
        {tab === "mld" && <MldView />}
        {tab === "sql" && (ddl.ok ? <SqlView sql={ddl.sql} losses={ddl.losses} /> : <p className="text-red-600 dark:text-red-400">{ddl.error}</p>)}
        {tab === "issues" && <IssuesView />}
      </div>
    </div>
  );
}

/**
 * Script LDD précédé du rapport de pertes (override O-29) : ce que le SGBD cible ne sait pas
 * exprimer, abandonné ou dégradé. Le même rapport figure en commentaire en tête du script.
 */
function SqlView({ sql, losses }: { sql: string; losses: Loss[] }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {losses.length > 0 && (
        <div role="status" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 font-sans text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <button type="button" className="font-medium text-amber-800 dark:text-amber-300" onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"} {t("output.losses", { n: losses.length })}
          </button>
          {open && (
            <ul className="mt-1 list-disc pl-5 text-xs text-neutral-700 dark:text-neutral-300">
              {/* Une ligne par perte, avec ses emplacements (O-37). */}
              {groupLosses(losses).map((g, i) => (
                <li key={i}>
                  {g.message}
                  {g.places.length > 0 && (
                    <>
                      {" — "}
                      <span className="font-mono">{g.places.join(", ")}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <pre>{sql}</pre>
    </>
  );
}

function MldView() {
  const lines = mldLines(useLogicalModel());
  if (lines.length === 0) return <p className="font-sans text-neutral-500">{t("output.mldEmpty")}</p>;
  return (
    <div>
      {lines.map((line) => (
        <div key={line.table}>
          <strong>{line.table}</strong> = (
          {line.columns.map((c, i) => (
            <span key={`${c.name}-${i}`}>
              {i > 0 && ", "}
              <span
                className={[
                  c.primaryKey && "underline",
                  (c.primaryKey || c.unique) && "font-bold",
                  c.foreign && "italic text-[var(--mcd-foreign)]",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
              >
                {c.foreign && "#"}
                {c.name}
              </span>
            </span>
          ))}
          );
        </div>
      ))}
    </div>
  );
}

/** Problèmes, formulés dans le vocabulaire de la vue active : MCD, ou MLD / MPD (override O-24). */
function IssuesView() {
  const { issues } = useLogicalModel();
  const select = useDocumentView((s) => s.select);
  const layer = useDocumentView((s) => (s.view === "mcd" ? "conceptual" : "logical"));
  if (issues.length === 0) return <p className="font-sans text-neutral-500">{t("output.noIssues")}</p>;
  return (
    <ul className="font-sans text-sm">
      {issues.map((issue, i) => (
        <li key={i}>
          <button
            type="button"
            disabled={!issue.target}
            onClick={() => issue.target && select([issue.target.id])}
            className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className={issue.severity === "error" ? "text-red-600" : "text-amber-600"}>●</span>
            {issueMessage(issue, layer)}
          </button>
        </li>
      ))}
    </ul>
  );
}

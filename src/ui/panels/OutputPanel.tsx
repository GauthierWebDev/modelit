import { DBMS_LIST, groupLosses, issueMessage, type Loss, mldLines, mldPlainText } from "@core/index";
import { Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useDdl, useLogicalModel } from "@/app/derived";
import { useDocument, useDocumentView } from "@/app/document/DocumentContext";
import { t } from "@/i18n";
import { IconButton } from "@/ui/common/controls";

/**
 * Sections « MLD textuel », « Script LDD » et « Problèmes » (override O-46), mises à jour en temps
 * réel. Chacune fournit son corps et le libellé de son onglet.
 */

function OutputBody({ copyText, children }: { copyText?: string | null; children: ReactNode }) {
  return (
    <div className="relative h-full overflow-auto p-3 font-mono text-[13px] leading-5 select-text">
      {copyText != null && (
        <div className="absolute top-1 right-1">
          <IconButton tooltip={t("output.copy")} onClick={() => void navigator.clipboard.writeText(copyText)}>
            <Copy size={14} />
          </IconButton>
        </div>
      )}
      {children}
    </div>
  );
}

export function MldSection() {
  const logical = useLogicalModel();
  return (
    <OutputBody copyText={mldPlainText(logical)}>
      <MldView />
    </OutputBody>
  );
}

export function SqlSection() {
  const ddl = useDdl();
  return (
    <OutputBody copyText={ddl.ok ? ddl.sql : null}>
      {ddl.ok ? (
        <SqlView sql={ddl.sql} losses={ddl.losses} />
      ) : (
        <p className="text-red-600 dark:text-red-400">{ddl.error}</p>
      )}
    </OutputBody>
  );
}

export function IssuesSection() {
  return (
    <OutputBody>
      <IssuesView />
    </OutputBody>
  );
}

export const MldTitle = () => <>{t("output.mld")}</>;

export function SqlTitle() {
  const dbms = useDocument((s) => s.doc.settings.dbms);
  // SGBD personnalisé : son nom, pour ne pas le confondre avec le SGBD de base (O-59).
  const custom = useDocument((s) => s.doc.settings.customDbms?.name);
  return <>{t("output.sql", { dbms: custom ?? DBMS_LIST.find((d) => d.id === dbms)?.label ?? "" })}</>;
}

export function IssuesTitle() {
  const { issues } = useLogicalModel();
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <span className={errors > 0 ? "text-red-600 dark:text-red-400" : undefined}>
      {issues.length ? t("output.issuesCount", { n: issues.length }) : t("output.issues")}
    </span>
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
        <div
          role="status"
          className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 font-sans text-sm dark:border-amber-700 dark:bg-amber-950/40"
        >
          <button
            type="button"
            className="font-medium text-amber-800 dark:text-amber-300"
            onClick={() => setOpen(!open)}
          >
            {open ? "▾" : "▸"} {t("output.losses", { n: losses.length })}
          </button>
          {open ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-neutral-700 dark:text-neutral-300">
              {/* Une ligne par perte, avec ses emplacements (O-37). */}
              {groupLosses(losses).map((g) => (
                <li key={`${g.category}|${g.priority ?? ""}|${g.message}`}>
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
          ) : null}
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
            // biome-ignore lint/suspicious/noArrayIndexKey: liste en lecture seule, recalculée
            <span key={`${c.name}-${i}`}>
              {i > 0 && ", "}
              <span
                className={
                  [
                    c.primaryKey && "underline",
                    (c.primaryKey || c.unique) && "font-bold",
                    c.foreign && "italic text-[var(--mcd-foreign)]",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                {c.foreign ? "#" : null}
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
        // biome-ignore lint/suspicious/noArrayIndexKey: liste en lecture seule, recalculée
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

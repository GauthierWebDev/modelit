import { generateDdl, toLogicalModel, type DdlResult, type Id, type Issue, type LogicalModel, type ModelDocument } from "@core/index";
import { getLocale } from "@/i18n";
import { useDocumentStore } from "./documentStore";

/**
 * Vues dérivées du document (MLD, SQL), recalculées en temps réel
 * et partagées entre composants grâce à un cache sur la référence du document
 * (et sur la langue, dont dépendent les messages des problèmes).
 */

function memoizeLast<A extends object, R>(fn: (a: A) => R): (a: A) => R {
  let lastArg: A | undefined;
  let lastLocale: string | undefined;
  let lastResult: R;
  return (a) => {
    if (a !== lastArg || getLocale() !== lastLocale) {
      lastResult = fn(a);
      lastArg = a;
      lastLocale = getLocale();
    }
    return lastResult;
  };
}

export const logicalModelOf = memoizeLast((doc: ModelDocument): LogicalModel => toLogicalModel(doc));
export const ddlOf = memoizeLast((doc: ModelDocument): DdlResult =>
  generateDdl(logicalModelOf(doc), { dbms: doc.settings.dbms, version: doc.settings.dbmsVersion }, doc.settings.ddl),
);

/** Problèmes regroupés par objet (pastilles d'erreur, override O-15). */
export const issuesByTargetOf = memoizeLast((model: LogicalModel): Map<Id, Issue[]> => {
  const map = new Map<Id, Issue[]>();
  for (const issue of model.issues) {
    if (issue.target) map.set(issue.target.id, [...(map.get(issue.target.id) ?? []), issue]);
  }
  return map;
});

export const useIssuesByTarget = () => issuesByTargetOf(useLogicalModel());
export const useLogicalModel = () => logicalModelOf(useDocumentStore((s) => s.doc));
export const useDdl = () => ddlOf(useDocumentStore((s) => s.doc));

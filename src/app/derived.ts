import { generateDdl, toLogicalModel, type DdlResult, type Id, type Issue, type LogicalModel, type ModelDocument } from "@core/index";
import { getLocale } from "@/i18n";
import { useDocument } from "./document/DocumentContext";

/**
 * Vues dérivées du document (MLD, SQL), recalculées en temps réel
 * et partagées entre composants grâce à un cache indexé par la référence du document
 * (et par la langue, dont dépendent les messages des problèmes). Un cache par document :
 * plusieurs documents ouverts ne se chassent pas mutuellement (docs/jalons/J-01, phase 1).
 */

function memoizeByRef<A extends object, R>(fn: (a: A) => R): (a: A) => R {
  const cache = new WeakMap<A, { locale: string; result: R }>();
  return (a) => {
    const locale = getLocale();
    const hit = cache.get(a);
    if (hit && hit.locale === locale) return hit.result;
    const result = fn(a);
    cache.set(a, { locale, result });
    return result;
  };
}

export const logicalModelOf = memoizeByRef((doc: ModelDocument): LogicalModel => toLogicalModel(doc));
export const ddlOf = memoizeByRef((doc: ModelDocument): DdlResult =>
  generateDdl(logicalModelOf(doc), { dbms: doc.settings.dbms, version: doc.settings.dbmsVersion }, doc.settings.ddl),
);

/** Problèmes regroupés par objet (pastilles d'erreur, override O-15). */
export const issuesByTargetOf = memoizeByRef((model: LogicalModel): Map<Id, Issue[]> => {
  const map = new Map<Id, Issue[]>();
  for (const issue of model.issues) {
    if (issue.target) map.set(issue.target.id, [...(map.get(issue.target.id) ?? []), issue]);
  }
  return map;
});

export const useIssuesByTarget = () => issuesByTargetOf(useLogicalModel());
export const useLogicalModel = () => logicalModelOf(useDocument((s) => s.doc));
export const useDdl = () => ddlOf(useDocument((s) => s.doc));

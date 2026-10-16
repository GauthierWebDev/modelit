import {
  type DdlResult,
  generateDdl,
  type Id,
  type Issue,
  type LogicalModel,
  type ModelDocument,
  targetOf,
  toLogicalModel,
} from "@core/index";
import { getLocale } from "@/i18n";
import { useDocument } from "./document/DocumentContext";

/**
 * Vues dérivées du document (MLD, SQL), recalculées en temps réel et partagées entre composants.
 *
 * Le cache porte sur la partie sémantique du document (objets, liens, paramètres) et sur la
 * langue, dont dépendent les messages des problèmes. La géométrie (`layout`) n'en fait pas
 * partie : déplacer un objet ou une cassure ne recalcule ni le MLD ni le SQL (J-01, phase 3).
 * Un cache par document : plusieurs onglets ne se chassent pas mutuellement.
 */

type Semantic = Omit<ModelDocument, "layout">;

const sameSemantic = (a: Semantic, b: Semantic) =>
  a.settings === b.settings &&
  a.entities === b.entities &&
  a.associations === b.associations &&
  a.links === b.links &&
  a.inheritances === b.inheritances &&
  a.inheritanceLinks === b.inheritanceLinks;

/** Indexé par la liste des entités : propre à un document, partagée tant qu'elle ne change pas. */
const logicalCache = new WeakMap<object, { source: Semantic; locale: string; result: LogicalModel }>();

export function logicalModelOf(doc: ModelDocument): LogicalModel {
  const locale = getLocale();
  const hit = logicalCache.get(doc.entities);
  if (hit && hit.locale === locale && sameSemantic(hit.source, doc)) return hit.result;
  const result = toLogicalModel(doc);
  logicalCache.set(doc.entities, { source: doc, locale, result });
  return result;
}

const ddlCache = new WeakMap<LogicalModel, { settings: ModelDocument["settings"]; result: DdlResult }>();

export function ddlOf(doc: ModelDocument): DdlResult {
  const logical = logicalModelOf(doc);
  const hit = ddlCache.get(logical);
  if (hit && hit.settings === doc.settings) return hit.result;
  const result = generateDdl(logical, targetOf(doc.settings), doc.settings.ddl);
  ddlCache.set(logical, { settings: doc.settings, result });
  return result;
}

const issuesCache = new WeakMap<LogicalModel, Map<Id, Issue[]>>();

/** Problèmes regroupés par objet (pastilles d'erreur, override O-15). */
export function issuesByTargetOf(model: LogicalModel): Map<Id, Issue[]> {
  const hit = issuesCache.get(model);
  if (hit) return hit;
  const map = new Map<Id, Issue[]>();
  for (const issue of model.issues) {
    if (issue.target) map.set(issue.target.id, [...(map.get(issue.target.id) ?? []), issue]);
  }
  issuesCache.set(model, map);
  return map;
}

export const useIssuesByTarget = () => issuesByTargetOf(useLogicalModel());
export const useLogicalModel = () => logicalModelOf(useDocument((s) => s.doc));
export const useDdl = () => ddlOf(useDocument((s) => s.doc));

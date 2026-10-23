import { detectDialect, type ReverseReport, reverseEngineer, type SqlDialect } from "@core/index";
import type { DocumentHandle } from "./document/handle";
import { newModelDocument } from "./modelDefaults";
import { openInTab } from "./workspace";

/**
 * Rétroconception d'un script SQL (O-28) dans un nouvel onglet (O-44), le document affiché n'étant plus
 * remplacé ; dialecte détecté s'il n'est pas donné. Aucune table reconnue : pas d'onglet (`doc` nul).
 * Commune à la boîte « Rétroconception » et à l'assistant IA (audit A-01, U-3) ; le placement
 * automatique et l'annonce restent à l'appelant.
 */
export function reverseIntoNewTab(
  sql: string,
  dialect: SqlDialect = detectDialect(sql),
): { doc: DocumentHandle | null; report: ReverseReport } {
  const result = reverseEngineer(sql, newModelDocument(), dialect);
  if (result.report.tables === 0) {
    return { doc: null, report: result.report };
  }
  return { doc: openInTab((d) => d.store.getState().load(result.doc, null, true)), report: result.report };
}

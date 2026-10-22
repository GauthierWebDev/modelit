import { t } from "@/i18n";
import type { DocumentHandle } from "./document/handle";
import { useWorkspaceStore } from "./workspace";

/** Noms affichés des documents : onglets, titre de la fenêtre, session, assistant IA (override O-44). */

export const fileName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : t("app.untitled"));

/** Nom affiché d'un document : nom du fichier, ou « Sans titre N » (override O-44). */
export function documentName(
  doc: DocumentHandle,
  untitled = useWorkspaceStore.getState().untitled,
  titles = useWorkspaceStore.getState().titles,
): string {
  if (titles[doc.id]) {
    return titles[doc.id]!;
  }
  const path = doc.store.getState().filePath;
  if (path) {
    return fileName(path);
  }
  const n = untitled[doc.id] ?? 1;
  return n === 1 ? t("app.untitled") : t("app.untitledN", { n });
}

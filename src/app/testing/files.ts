import { expect, vi } from "vitest";
import { settleDialog, useDialogStore } from "../dialogStore";
import { type FileAccess, setFileAccess } from "../fileAccess";

/** Appuis des tests des commandes Fichier (exclus de l'application). */

/** Faux accès aux fichiers : répond ce que le test prévoit, retient les enregistrements. */
export function fakeFiles(overrides: Partial<FileAccess> = {}) {
  const saved: { content: string; path: string | null }[] = [];
  const files: FileAccess = {
    openModel: () => Promise.resolve(null),
    openText: () => Promise.resolve(null),
    saveModel: (content, path) => {
      saved.push({ content, path });
      return Promise.resolve(path ?? "/choisi/nouveau.mcd");
    },
    saveExport: () => Promise.resolve(null),
    readModel: () => Promise.resolve(null),
    readsPaths: true,
    ...overrides,
  };
  setFileAccess(files);
  return saved;
}

/** Message de la boîte affichée par la commande, fermée (réponse `answer`) pour la laisser se terminer. */
export async function dialogMessage(answer = true): Promise<string> {
  await vi.waitFor(() => expect(useDialogStore.getState().queue).toHaveLength(1));
  const [request] = useDialogStore.getState().queue;
  settleDialog(request!.id, answer);
  return request!.message;
}

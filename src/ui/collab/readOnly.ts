import { selectReadOnlyTab, useCollabStore } from "@/app/collab/session";
import type { DocumentHandle } from "@/app/document/handle";
import { useMirrorStore } from "@/app/windows/replica";

/**
 * Vrai si `doc` ne peut pas être modifié ici : onglet d'une session rejointe en lecture seule, ou
 * reconnexion en cours (O-05 §4.3, §4.4). Dans une fenêtre flottante, `doc` est le reflet du
 * document actif de la principale.
 */
export function useSessionReadOnly(doc: DocumentHandle): boolean {
  const tab = useCollabStore(selectReadOnlyTab);
  const mirrored = useMirrorStore((s) => s.state?.documentId);
  return tab !== null && (tab === doc.id || (doc.id === "replica" && tab === mirrored));
}

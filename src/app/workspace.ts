import type { ModelDocument } from "@core/index";
import { create } from "zustand";
import { selectIsDirty } from "./document/documentStore";
import { createDocumentHandle, type DocumentHandle } from "./document/handle";
import { newModelDocument } from "./modelDefaults";

/**
 * Documents ouverts dans la fenêtre, un par onglet, et document actif (override O-44).
 * La fenêtre contient toujours au moins un document.
 */

interface WorkspaceState {
  /** Ordre des onglets. */
  documents: DocumentHandle[];
  activeId: string;
  /** Numéro « Sans titre N » de chaque document jamais enregistré (1 = « Sans titre »). */
  untitled: Record<string, number>;
  /** Titre imposé d'un onglet (session rejointe : « Session de Alice », O-05). */
  titles: Record<string, string>;
}

function initialState(): WorkspaceState {
  const first = createDocumentHandle(newModelDocument());
  return { documents: [first], activeId: first.id, untitled: { [first.id]: 1 }, titles: {} };
}

export const useWorkspaceStore = create<WorkspaceState>()(initialState);

/** Remet l'espace de travail à un seul document vierge (tests). */
export const resetWorkspace = () => useWorkspaceStore.setState(initialState(), true);

/** Document actif, pour le code hors React (raccourcis, gestionnaires de la fenêtre). */
export function activeDocument(): DocumentHandle {
  const { documents, activeId } = useWorkspaceStore.getState();
  const active = documents.find((d) => d.id === activeId);
  if (!active) throw new Error(`Document actif introuvable : ${activeId}`);
  return active;
}

export const useActiveDocument = (): DocumentHandle =>
  useWorkspaceStore((s) => s.documents.find((d) => d.id === s.activeId) ?? s.documents[0]!);

/** Plus petit numéro « Sans titre N » libre. */
function nextUntitled(untitled: Record<string, number>): number {
  const used = new Set(Object.values(untitled));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Document « Sans titre » jamais modifié ni enregistré : réutilisable par Nouveau / Ouvrir. */
export function isBlank(doc: DocumentHandle): boolean {
  const s = doc.store.getState();
  return s.filePath === null && !s.recovered && s.past.length === 0 && s.future.length === 0 && !selectIsDirty(s);
}

/** Document déjà ouvert pour ce fichier, s'il y en a un. */
export const findByPath = (path: string): DocumentHandle | undefined =>
  useWorkspaceStore.getState().documents.find((d) => d.store.getState().filePath === path);

export function activate(id: string) {
  if (useWorkspaceStore.getState().documents.some((d) => d.id === id)) useWorkspaceStore.setState({ activeId: id });
}

/** Active l'onglet voisin (`step` = 1 : suivant, -1 : précédent), en boucle. */
export function activateNeighbour(step: 1 | -1) {
  const { documents, activeId } = useWorkspaceStore.getState();
  const index = documents.findIndex((d) => d.id === activeId);
  const next = documents[(index + step + documents.length) % documents.length];
  if (next) activate(next.id);
}

/**
 * Ouvre un document dans un nouvel onglet, à droite de l'onglet actif, et l'active.
 * `reuseBlank` : un onglet actif « Sans titre » vierge est remplacé au lieu d'en ajouter un.
 * `load` prépare le document (chargement, récupération…) avant son affichage.
 */
export function openInTab(
  load: (doc: DocumentHandle) => void = () => undefined,
  { reuseBlank = true, model = newModelDocument() }: { reuseBlank?: boolean; model?: ModelDocument } = {},
): DocumentHandle {
  const { documents, activeId, untitled } = useWorkspaceStore.getState();
  const active = documents.find((d) => d.id === activeId);
  const doc = createDocumentHandle(model);
  load(doc);
  const named = doc.store.getState().filePath !== null;
  const replaced = reuseBlank && active && isBlank(active) ? active : undefined;
  const nextUntitledMap = { ...untitled };
  if (replaced) delete nextUntitledMap[replaced.id];
  if (!named) nextUntitledMap[doc.id] = nextUntitled(nextUntitledMap);

  const index = documents.findIndex((d) => d.id === activeId);
  const list = replaced
    ? documents.map((d) => (d.id === replaced.id ? doc : d))
    : [...documents.slice(0, index + 1), doc, ...documents.slice(index + 1)];
  useWorkspaceStore.setState({ documents: list, activeId: doc.id, untitled: nextUntitledMap });
  return doc;
}

/** Ferme un onglet sans confirmation ; le dernier est remplacé par un document vierge. */
export function closeTab(id: string) {
  const { documents, activeId, untitled } = useWorkspaceStore.getState();
  const index = documents.findIndex((d) => d.id === id);
  if (index < 0) return;
  const rest = documents.filter((d) => d.id !== id);
  const nextUntitledMap = { ...untitled };
  delete nextUntitledMap[id];
  const { [id]: _title, ...titles } = useWorkspaceStore.getState().titles;
  useWorkspaceStore.setState({ titles });
  if (rest.length === 0) {
    const blank = createDocumentHandle(newModelDocument());
    nextUntitledMap[blank.id] = nextUntitled(nextUntitledMap);
    useWorkspaceStore.setState({ documents: [blank], activeId: blank.id, untitled: nextUntitledMap });
    return;
  }
  // Onglet actif fermé : le voisin de droite, sinon de gauche, devient actif.
  const nextActive = id === activeId ? (rest[index] ?? rest[index - 1])!.id : activeId;
  useWorkspaceStore.setState({ documents: rest, activeId: nextActive, untitled: nextUntitledMap });
}

/**
 * Remplace le document d'un onglet, à la même place (session collaborative : l'onglet partagé
 * passe à un document de session, puis revient à un document ordinaire, O-05).
 */
export function replaceDocument(id: string, doc: DocumentHandle) {
  const { documents, activeId, untitled, titles } = useWorkspaceStore.getState();
  if (!documents.some((d) => d.id === id)) return;
  const rename = <T,>(record: Record<string, T>) => {
    if (doc.id === id || !(id in record)) return record;
    const { [id]: value, ...rest } = record;
    return { ...rest, [doc.id]: value! };
  };
  useWorkspaceStore.setState({
    documents: documents.map((d) => (d.id === id ? doc : d)),
    activeId: activeId === id ? doc.id : activeId,
    untitled: rename(untitled),
    titles: rename(titles),
  });
}

/** Ajoute un document existant dans un nouvel onglet, à droite de l'actif, et l'active. */
export function addTab(doc: DocumentHandle, title?: string) {
  const { documents, activeId, untitled, titles } = useWorkspaceStore.getState();
  const index = documents.findIndex((d) => d.id === activeId);
  useWorkspaceStore.setState({
    documents: [...documents.slice(0, index + 1), doc, ...documents.slice(index + 1)],
    activeId: doc.id,
    ...(title ? { titles: { ...titles, [doc.id]: title } } : doc.store.getState().filePath ? {} : { untitled: { ...untitled, [doc.id]: nextUntitled(untitled) } }),
  });
}

export function setTitle(id: string, title: string | null) {
  const { titles } = useWorkspaceStore.getState();
  const { [id]: _previous, ...rest } = titles;
  useWorkspaceStore.setState({ titles: title ? { ...rest, [id]: title } : rest });
}

/** Déplace un onglet à la position `to` (glisser-déposer dans la barre). */
export function moveTab(id: string, to: number) {
  const { documents } = useWorkspaceStore.getState();
  const doc = documents.find((d) => d.id === id);
  if (!doc) return;
  const rest = documents.filter((d) => d.id !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  useWorkspaceStore.setState({ documents: [...rest.slice(0, at), doc, ...rest.slice(at)] });
}

/**
 * Un document enregistré quitte la numérotation « Sans titre » ; un document redevenu sans
 * fichier (Nouveau dans l'onglet, rétroconception) y entre.
 */
export function syncUntitled(doc: DocumentHandle) {
  const { untitled } = useWorkspaceStore.getState();
  const named = doc.store.getState().filePath !== null;
  if (named && doc.id in untitled) {
    const next = { ...untitled };
    delete next[doc.id];
    useWorkspaceStore.setState({ untitled: next });
  } else if (!named && !(doc.id in untitled)) {
    useWorkspaceStore.setState({ untitled: { ...untitled, [doc.id]: nextUntitled(untitled) } });
  }
}

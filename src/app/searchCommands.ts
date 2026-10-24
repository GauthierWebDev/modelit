import { type Id, type ModelDocument, matchesSearch, positionOf } from "@core/index";
import { logicalModelOf } from "./derived";
import type { ViewMode } from "./document/documentView";
import type { DocumentHandle } from "./document/handle";

/**
 * Recherche dans le canevas (override O-64). MCD : entités et associations, par nom conceptuel et nom logique ;
 * MLD / MPD : tables, par nom de table et nom conceptuel de leur objet. Résultats dans l'ordre de lecture (haut en
 * bas, puis gauche à droite ; disposition commune aux trois vues, O-01). L'interface montre le résultat courant.
 */
export function findMatches(doc: ModelDocument, view: ViewMode, query: string): Id[] {
  const nodes = [...doc.entities, ...doc.associations];
  const conceptual = new Map(nodes.map((n) => [n.id, n.name]));
  const candidates: { id: Id; names: string[] }[] =
    view === "mcd"
      ? nodes.map((n) => ({ id: n.id, names: n.logicalName ? [n.name, n.logicalName] : [n.name] }))
      : logicalModelOf(doc).tables.map((t) => ({
          id: t.source.id,
          names: [t.name, conceptual.get(t.source.id) ?? ""],
        }));
  const found = candidates.filter((c) => matchesSearch(c.names, query)).map((c) => c.id);
  const at = (id: Id) => positionOf(doc.layout, id);
  return found.sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x);
}

/** Résultats de la recherche du document, dans sa vue, et index du courant (borné si le schéma a changé). */
export function searchResults(handle: DocumentHandle): { matches: Id[]; current: number } {
  const { view, search } = handle.view.getState();
  const matches = search.open ? findMatches(handle.store.getState().doc, view, search.query) : [];
  return { matches, current: matches.length > 0 ? Math.min(search.index, matches.length - 1) : -1 };
}

export function openSearch(handle: DocumentHandle) {
  handle.view.getState().setSearch({ open: true });
}

/** Nouveau texte : le premier résultat devient courant ; renvoie l'objet à montrer. */
export function setSearchQuery(handle: DocumentHandle, query: string): Id | undefined {
  handle.view.getState().setSearch({ query, index: 0 });
  return searchResults(handle).matches[0];
}

/** Résultat suivant (`step` = 1) ou précédent (-1), en boucle ; renvoie l'objet à montrer. */
export function stepSearch(handle: DocumentHandle, step: 1 | -1): Id | undefined {
  const { matches, current } = searchResults(handle);
  if (matches.length === 0) {
    return undefined;
  }
  const index = (current + step + matches.length) % matches.length;
  handle.view.getState().setSearch({ index });
  return matches[index];
}

export function closeSearch(handle: DocumentHandle) {
  handle.view.getState().setSearch({ open: false });
}

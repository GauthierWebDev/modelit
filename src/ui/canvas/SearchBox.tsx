import type { Id } from "@core/index";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { type KeyboardEvent, useMemo } from "react";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import type { DocumentHandle } from "@/app/document/handle";
import { closeSearch, findMatches, setSearchQuery, stepSearch } from "@/app/searchCommands";
import { t } from "@/i18n";
import { tip } from "@/ui/common/Tooltip";
import { revealObjects } from "./viewport";

/** Met le champ de recherche au premier plan, texte sélectionné (⌘/Ctrl+F, O-64). */
export function focusSearch() {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-search-input]")?.select());
}

const show = (doc: DocumentHandle, id: Id | undefined) => id && revealObjects(doc, [id]);

/** Entrée / Maj+Entrée, flèches : résultat suivant / précédent ; Échap ferme ; ⌘/Ctrl+F : texte sélectionné. */
function onKeyDown(doc: DocumentHandle, e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    show(doc, stepSearch(doc, e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 1));
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeSearch(doc);
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    e.currentTarget.select();
  }
  // Les raccourcis du schéma (Suppr, lettres des outils…) ne s'appliquent pas pendant la saisie.
  e.stopPropagation();
}

/** Recherche dans le canevas (override O-64) : champ en haut à droite, compteur, navigation. */
export function SearchBox() {
  const doc = useDocumentHandle();
  const model = useDocument((s) => s.doc);
  const view = useDocumentView((s) => s.view);
  const search = useDocumentView((s) => s.search);
  const total = useMemo(
    () => (search.open ? findMatches(model, view, search.query).length : 0),
    [model, view, search.open, search.query],
  );
  if (!search.open) {
    return null;
  }
  const counter =
    search.query.trim() === ""
      ? ""
      : total === 0
        ? t("search.none")
        : t("search.count", { current: Math.min(search.index, total - 1) + 1, total });
  const button =
    "flex size-6 items-center justify-center rounded hover:bg-neutral-200 disabled:opacity-35 dark:hover:bg-neutral-700";
  return (
    <div
      data-ui-only=""
      className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-neutral-300 bg-white py-1 pr-1 pl-2 text-sm shadow-lg dark:border-neutral-600 dark:bg-neutral-900"
    >
      <Search size={14} className="text-neutral-400" />
      <input
        data-search-input=""
        // biome-ignore lint/a11y/noAutofocus: le champ s'ouvre à la demande (⌘/Ctrl+F), pour la saisie
        autoFocus={true}
        aria-label={t("search.placeholder")}
        placeholder={t("search.placeholder")}
        value={search.query}
        onChange={(e) => show(doc, setSearchQuery(doc, e.target.value))}
        onKeyDown={(e) => onKeyDown(doc, e)}
        className="w-44 bg-transparent outline-none"
      />
      <span className="min-w-14 text-right text-xs whitespace-nowrap text-neutral-500">{counter}</span>
      <span className="inline-flex" {...tip(t("search.previous"))}>
        <button
          type="button"
          aria-label={t("search.previous")}
          disabled={total === 0}
          className={button}
          onClick={() => show(doc, stepSearch(doc, -1))}
        >
          <ChevronUp size={14} />
        </button>
      </span>
      <span className="inline-flex" {...tip(t("search.next"))}>
        <button
          type="button"
          aria-label={t("search.next")}
          disabled={total === 0}
          className={button}
          onClick={() => show(doc, stepSearch(doc, 1))}
        >
          <ChevronDown size={14} />
        </button>
      </span>
      <span className="inline-flex" {...tip(t("search.close"))}>
        <button type="button" aria-label={t("search.close")} className={button} onClick={() => closeSearch(doc)}>
          <X size={14} />
        </button>
      </span>
    </div>
  );
}

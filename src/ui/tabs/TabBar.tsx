import { Plus, Users, X } from "lucide-react";
import { type PointerEvent, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useCollabStore } from "@/app/collab/session";
import { selectIsDirty } from "@/app/document/documentStore";
import type { DocumentHandle } from "@/app/document/handle";
import { closeDocument, documentName, newTab } from "@/app/fileCommands";
import { activate, moveTab, useWorkspaceStore } from "@/app/workspace";
import { t } from "@/i18n";
import { tip } from "@/ui/common/Tooltip";
import { MOD } from "@/ui/shortcuts";

/**
 * Barre d'onglets, un par document ouvert (override O-44) : clic pour activer, clic milieu ou
 * croix pour fermer, glisser pour réordonner, « + » (⌘/Ctrl + T) pour un nouvel onglet vierge. Elle défile horizontalement si les onglets ne
 * tiennent pas ; l'onglet actif reste visible.
 */

const DRAG_THRESHOLD = 4;

export function TabBar() {
  const documents = useWorkspaceStore((s) => s.documents);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const drag = useRef<{ id: string; startX: number; moved: boolean } | null>(null);

  function onPointerDown(e: PointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || (e.target as Element).closest("[data-tab-close]")) {
      return;
    }
    activate(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, startX: e.clientX, moved: false };
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const { current } = drag;
    if (!current) {
      return;
    }
    if (!current.moved && Math.abs(e.clientX - current.startX) < DRAG_THRESHOLD) {
      return;
    }
    current.moved = true;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tab-index]");
    if (!over) {
      return;
    }
    const target = Number(over.dataset.tabIndex);
    const from = useWorkspaceStore.getState().documents.findIndex((d) => d.id === current.id);
    if (target !== from) {
      moveTab(current.id, target);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={t("tabs.label")}
      className="flex h-8 flex-none items-end gap-px overflow-x-auto border-b border-neutral-200 bg-neutral-100 px-1 dark:border-neutral-700 dark:bg-neutral-950"
    >
      {documents.map((doc, index) => (
        <Tab
          key={doc.id}
          doc={doc}
          index={index}
          active={doc.id === activeId}
          onPointerDown={(e) => onPointerDown(e, doc.id)}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null;
          }}
        />
      ))}
      <button
        type="button"
        aria-label={t("tabs.new", { key: `${MOD}T` })}
        {...tip(t("tabs.new", { key: `${MOD}T` }))}
        onClick={newTab}
        className="mb-1 ml-1 flex size-6 flex-none items-center justify-center rounded text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function Tab({
  doc,
  index,
  active,
  ...handlers
}: {
  doc: DocumentHandle;
  index: number;
  active: boolean;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const filePath = useStore(doc.store, (s) => s.filePath);
  const dirty = useStore(doc.store, selectIsDirty);
  const recovered = useStore(doc.store, (s) => s.recovered);
  const untitled = useWorkspaceStore((s) => s.untitled);
  const titles = useWorkspaceStore((s) => s.titles);
  const name = documentName(doc, untitled, titles);
  // Onglet d'une session collaborative, partagé ou rejoint (O-05 §4.1).
  const shared = useCollabStore((s) => s.tabId === doc.id && (s.mode === "host" || s.mode === "guest"));

  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active]);

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-tab-index={index}
      {...tip(filePath ?? name)}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onAuxClick={(e) => e.button === 1 && void closeDocument(doc)}
      className={`group flex h-7 max-w-56 min-w-28 flex-none cursor-default items-center gap-1 rounded-t border border-b-0 px-2 text-xs select-none ${
        active
          ? "border-neutral-200 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          : "border-transparent text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
      }`}
    >
      <span className="w-2 flex-none text-center" aria-hidden="true">
        {dirty ? "•" : ""}
      </span>
      {shared && (
        <span className="flex-none text-emerald-600 dark:text-emerald-400" {...tip(t("collab.sharing"))}>
          <Users size={12} aria-label={t("collab.sharing")} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {name}
        {recovered && ` ${t("app.recovered")}`}
      </span>
      {dirty && <span className="sr-only">{t("app.modified")}</span>}
      <button
        type="button"
        data-tab-close=""
        aria-label={t("tabs.close", { key: `${MOD}W` })}
        {...tip(t("tabs.close", { key: `${MOD}W` }))}
        onClick={() => void closeDocument(doc)}
        className={`flex size-4 flex-none items-center justify-center rounded hover:bg-neutral-300 dark:hover:bg-neutral-700 ${
          active ? "" : "invisible group-hover:visible"
        }`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

import {
  type Association,
  type Attribute,
  createAttribute,
  type Entity,
  type Id,
  type ModelDocument,
} from "@core/index";
import { GripVertical, KeyRound, Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import * as cmd from "@/app/commands";
import { useDocumentHandle } from "@/app/document/DocumentContext";
import type { DocumentHandle } from "@/app/document/handle";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { IconButton } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { AttributeDetail, Badge, DropLine, Pill, typeSummary, useRowDrag } from "./attributeParts";

type Report = (message: string | null) => string | null;

export function AttributesPanel({
  doc,
  owner,
  isEntity,
  report,
}: {
  doc: ModelDocument;
  owner: Entity | Association;
  isEntity: boolean;
  report: Report;
}) {
  const handle = useDocumentHandle();
  const readOnly = useSessionReadOnly(handle);
  const { attributes } = owner;
  const { selected, setSelected, editing, edit } = useAttributeSelection(attributes);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const index = attributes.findIndex((a) => a.id === selected);
  const current = index >= 0 ? attributes[index]! : null;
  const ops = attributeOps({ handle, owner, attributes, report, rows, setSelected, edit });
  const drag = useRowDrag(
    rows,
    readOnly
      ? () => {
          // Lecture seule : l'ordre des rubriques ne change pas.
        }
      : ops.move,
  );
  const duplicates = new Set(attributes.map((a) => a.name).filter((name, i, all) => all.indexOf(name) !== i));
  const list: RowList = { attributes, selected, setSelected, isEntity, readOnly, rows, drag, duplicates, ops, edit };

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <h3 className="min-w-0 truncate text-sm font-semibold">{owner.name}</h3>
        {isEntity ? (
          <button
            type="button"
            className="flex flex-none items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => report(cmd.addAutoIdentifier(handle, owner.id))}
          >
            <KeyRound size={12} /> {t("inspector.autoDiscriminant")}
          </button>
        ) : null}
      </div>
      <div role="listbox" aria-label={t("inspector.attributes")} className="flex flex-col py-1">
        {attributes.length === 0 && <p className="px-3 py-1 text-sm text-neutral-500">{t("attributes.empty")}</p>}
        {attributes.map((a, i) => attributeRow(list, a, i))}
        {drag.target === attributes.length && <DropLine />}
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={ops.add}
          className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-neutral-300 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Plus size={14} /> {t("attribute.add")}
        </button>
      </div>
      {current ? (
        <AttributeDetail
          key={editing?.id === current.id ? `${current.id}:${editing.n}` : current.id}
          doc={doc}
          attribute={current}
          isEntity={isEntity}
          focusName={editing?.id === current.id}
          update={(patch) => ops.update(current.id, patch)}
          // Saisie à la chaîne : Entrée dans le nom de la dernière rubrique en ajoute une (O-50).
          onEnter={index === attributes.length - 1 ? ops.add : undefined}
        />
      ) : (
        attributes.length > 0 && (
          <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
            {t("attributes.pick")}
          </p>
        )
      )}
    </>
  );
}

/** Rubrique choisie et demande de saisie de son nom, y compris depuis hors de la section (O-53, O-56). */
function useAttributeSelection(attributes: Attribute[]) {
  const [selected, setSelected] = useState<Id | null>(null);
  /** Demande de saisie du nom (rubrique ajoutée, Entrée sur une ligne) : le détail est remonté, nom sélectionné. */
  const [editing, setEditing] = useState<{ id: Id; n: number } | null>(null);
  const edit = useCallback((id: Id) => setEditing((e) => ({ id, n: (e?.n ?? 0) + 1 })), []);
  // Rubrique ajoutée hors de la section (« ⋯ », menu contextuel, O-53) : la choisir et la nommer.
  const toEdit = useUiStore((s) => s.attributeToEdit);
  useEffect(() => {
    if (!(toEdit && attributes.some((a) => a.id === toEdit))) {
      return;
    }
    setSelected(toEdit);
    edit(toEdit);
    useUiStore.getState().editAttribute(null);
  }, [toEdit, attributes, edit]);
  // Colonne renommée dans le MLD / MPD (O-56) : la rubrique est choisie, le focus reste sur le canevas.
  const toShow = useUiStore((s) => s.attributeToShow);
  useEffect(() => {
    if (!(toShow && attributes.some((a) => a.id === toShow))) {
      return;
    }
    setSelected(toShow);
    useUiStore.getState().showAttribute(null);
  }, [toShow, attributes]);
  return { selected, setSelected, editing, edit };
}

interface OpsScope {
  handle: DocumentHandle;
  owner: Entity | Association;
  attributes: Attribute[];
  report: Report;
  rows: { current: (HTMLDivElement | null)[] };
  setSelected: (id: Id | null) => void;
  edit: (id: Id) => void;
}

/** Modifications de la liste : mise à jour, déplacement, suppression, ajout ; focus d'une ligne. */
function attributeOps({ handle, owner, attributes, report, rows, setSelected, edit }: OpsScope) {
  // La ligne à focaliser n'existe qu'au rendu suivant (après suppression ou déplacement).
  const focusRow = (i: number) => requestAnimationFrame(() => rows.current[i]?.focus());
  /**
   * Rubriques à jour dans le document : deux modifications peuvent se suivre avant le rendu
   * suivant (Entrée valide le nom puis ajoute une rubrique), la seconde part de la première.
   */
  const latest = (): Attribute[] => {
    const d = handle.store.getState().doc;
    return [...d.entities, ...d.associations].find((n) => n.id === owner.id)?.attributes ?? attributes;
  };
  const apply = (next: Attribute[]) => report(cmd.setAttributes(handle, owner.id, next));
  const update = (attributeId: Id, patch: Partial<Attribute>) =>
    apply(latest().map((a) => (a.id === attributeId ? { ...a, ...patch } : a)));
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= attributes.length) {
      return;
    }
    const next = [...latest()];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    apply(next);
  };
  const remove = (i: number) => {
    if (apply(latest().filter((_, j) => j !== i))) {
      return;
    }
    const next = attributes[i + 1] ? i : i - 1;
    setSelected(attributes[i + 1]?.id ?? attributes[i - 1]?.id ?? null);
    if (next >= 0) {
      focusRow(next);
    }
  };
  const add = () => {
    const list = latest();
    const taken = new Set(list.map((a) => a.name));
    let n = list.length + 1;
    while (taken.has(t("attribute.defaultName", { n }))) {
      n += 1;
    }
    const created = createAttribute(t("attribute.defaultName", { n }));
    if (apply([...list, created])) {
      return;
    }
    setSelected(created.id);
    edit(created.id);
  };
  return { update, move, remove, add, focusRow };
}

type Ops = ReturnType<typeof attributeOps>;

/** Ce qu'une ligne de rubrique lit et modifie. */
interface RowList {
  attributes: Attribute[];
  selected: Id | null;
  setSelected: (id: Id | null) => void;
  isEntity: boolean;
  readOnly: boolean;
  rows: { current: (HTMLDivElement | null)[] };
  drag: ReturnType<typeof useRowDrag>;
  duplicates: Set<string>;
  ops: Ops;
  edit: (id: Id) => void;
}

/** Clavier d'une ligne : déplacer (Alt + flèches), parcourir, supprimer, nommer (Entrée). */
function rowKey(list: RowList, e: KeyboardEvent, i: number) {
  // Touches d'une bascule ou de la corbeille de la ligne : elles gardent leur effet.
  if (e.target !== e.currentTarget) {
    return;
  }
  if (rowAction(list, e, i)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Action de la touche ; vrai si elle est prise en charge. */
function rowAction(list: RowList, e: KeyboardEvent, i: number): boolean {
  if (list.readOnly && (e.altKey || e.key === "Delete" || e.key === "Backspace")) {
    // Lecture seule : ni déplacement ni suppression.
    return true;
  }
  return moveKey(list, e, i) || selectKey(list, e, i);
}

/** Alt + flèches : déplacer la rubrique. */
function moveKey({ attributes, ops }: RowList, e: KeyboardEvent, i: number): boolean {
  if (e.altKey && e.key === "ArrowUp") {
    ops.move(i, i - 1);
    ops.focusRow(Math.max(0, i - 1));
    return true;
  }
  if (e.altKey && e.key === "ArrowDown") {
    ops.move(i, i + 1);
    ops.focusRow(Math.min(attributes.length - 1, i + 1));
    return true;
  }
  return false;
}

/** Flèches : rubrique voisine ; Suppr : supprimer ; Entrée : nommer. */
function selectKey({ attributes, rows, ops, setSelected, edit }: RowList, e: KeyboardEvent, i: number): boolean {
  const a = attributes[i]!;
  if (e.key === "ArrowUp" && i > 0) {
    setSelected(attributes[i - 1]!.id);
    rows.current[i - 1]?.focus();
  } else if (e.key === "ArrowDown" && i < attributes.length - 1) {
    setSelected(attributes[i + 1]!.id);
    rows.current[i + 1]?.focus();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    ops.remove(i);
  } else if (e.key === "Enter") {
    setSelected(a.id);
    edit(a.id);
  } else {
    return false;
  }
  return true;
}

/** Ligne d'une rubrique : poignée, nom, marques, type, bascules ID / NN / UQ, corbeille. */
function attributeRow(list: RowList, a: Attribute, i: number) {
  const { selected, setSelected, isEntity, rows, drag, duplicates, ops } = list;
  return (
    <div key={a.id}>
      {drag.target === i && <DropLine />}
      <div
        ref={(el) => {
          rows.current[i] = el;
        }}
        role="option"
        aria-selected={a.id === selected}
        tabIndex={0}
        onClick={() => setSelected(a.id)}
        onKeyDown={(e) => rowKey(list, e, i)}
        className={`group flex h-7 items-center gap-1 pr-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-inset ${
          a.id === selected ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
        } ${drag.from === i ? "opacity-50" : ""}`}
      >
        <span
          role="img"
          aria-label={t("attributes.drag")}
          {...tip(t("attributes.drag"))}
          onPointerDown={(e) => drag.start(e, i)}
          className="flex h-full w-5 flex-none cursor-grab items-center justify-center text-neutral-300 group-hover:text-neutral-500 dark:text-neutral-600"
        >
          <GripVertical size={12} />
        </span>
        <span className={`mr-1 min-w-0 flex-1 truncate ${a.identifier ? "font-semibold underline" : ""}`}>
          {a.name}
        </span>
        <Badge attribute={a} duplicate={duplicates.has(a.name)} />
        <span
          className={`max-w-32 flex-none truncate text-xs ${a.type ? "text-neutral-500 dark:text-neutral-400" : "text-amber-600 italic"}`}
        >
          {typeSummary(a.type)}
        </span>
        {isEntity ? (
          <Pill
            label="ID"
            tooltip={t("attribute.identifier")}
            on={a.identifier}
            onToggle={() => ops.update(a.id, { identifier: !a.identifier })}
          />
        ) : null}
        <Pill label="NN" tooltip="NOT NULL" on={a.notNull} onToggle={() => ops.update(a.id, { notNull: !a.notNull })} />
        <Pill label="UQ" tooltip="UNIQUE" on={a.unique} onToggle={() => ops.update(a.id, { unique: !a.unique })} />
        <IconButton tooltip={t("attribute.delete")} onClick={() => ops.remove(i)}>
          <Trash2 size={12} />
        </IconButton>
      </div>
    </div>
  );
}

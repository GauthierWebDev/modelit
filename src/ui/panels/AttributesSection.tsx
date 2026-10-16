import { createAttribute, type Association, type Attribute, type DataType, type Entity, type Id, type ModelDocument } from "@core/index";
import { GripVertical, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import * as cmd from "@/app/commands";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { Checkbox, CommitInput, Disclosure, ErrorBanner, Field, IconButton } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { AdvancedFields } from "./AttributesEditor";
import { ReadOnly } from "./Inspector";
import { TypePicker } from "./TypePicker";

/**
 * Section « Rubriques » (override O-50) : rubriques de l'entité ou de l'association sélectionnée,
 * en liste compacte (une ligne chacune), avec le détail de la rubrique choisie dessous.
 */
export function AttributesSection() {
  const doc = useDocument((s) => s.doc);
  const selection = useDocumentView((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [selection]);
  const report = (message: string | null) => {
    setError(message);
    return message;
  };

  const id = selection.length === 1 ? selection[0]! : null;
  const entity = doc.entities.find((e) => e.id === id);
  const owner = entity ?? doc.associations.find((a) => a.id === id);

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      // Suppr ne vise jamais le canevas tant que le focus est dans la section (O-50).
      onKeyDown={(e) => (e.key === "Delete" || e.key === "Backspace") && e.stopPropagation()}
    >
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {owner ? (
        <ReadOnly>
          <AttributesPanel key={owner.id} doc={doc} owner={owner} isEntity={Boolean(entity)} report={report} />
        </ReadOnly>
      ) : (
        <p className="p-3 text-sm text-neutral-500">{t("attributes.none")}</p>
      )}
    </div>
  );
}

type Report = (message: string | null) => string | null;

function AttributesPanel({ doc, owner, isEntity, report }: { doc: ModelDocument; owner: Entity | Association; isEntity: boolean; report: Report }) {
  const handle = useDocumentHandle();
  const readOnly = useSessionReadOnly(handle);
  const attributes = owner.attributes;
  const [selected, setSelected] = useState<Id | null>(null);
  /** Demande de saisie du nom (rubrique ajoutée, Entrée sur une ligne) : le détail est remonté, nom sélectionné. */
  const [editing, setEditing] = useState<{ id: Id; n: number } | null>(null);
  const edit = (id: Id) => setEditing((e) => ({ id, n: (e?.n ?? 0) + 1 }));
  // Rubrique ajoutée hors de la section (« ⋯ », menu contextuel, O-53) : la choisir et la nommer.
  const toEdit = useUiStore((s) => s.attributeToEdit);
  useEffect(() => {
    if (!toEdit || !attributes.some((a) => a.id === toEdit)) return;
    setSelected(toEdit);
    edit(toEdit);
    useUiStore.getState().editAttribute(null);
  }, [toEdit, attributes]);
  // Colonne renommée dans le MLD / MPD (O-56) : la rubrique est choisie, le focus reste sur le canevas.
  const toShow = useUiStore((s) => s.attributeToShow);
  useEffect(() => {
    if (!toShow || !attributes.some((a) => a.id === toShow)) return;
    setSelected(toShow);
    useUiStore.getState().showAttribute(null);
  }, [toShow, attributes]);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const index = attributes.findIndex((a) => a.id === selected);
  const current = index >= 0 ? attributes[index]! : null;

  /**
   * Rubriques à jour dans le document : deux modifications peuvent se suivre avant le rendu
   * suivant (Entrée valide le nom puis ajoute une rubrique), la seconde part de la première.
   */
  const latest = (): Attribute[] => {
    const d = handle.store.getState().doc;
    return [...d.entities, ...d.associations].find((n) => n.id === owner.id)?.attributes ?? attributes;
  };
  const apply = (next: Attribute[]) => report(cmd.setAttributes(handle, owner.id, next));
  const update = (attributeId: Id, patch: Partial<Attribute>) => apply(latest().map((a) => (a.id === attributeId ? { ...a, ...patch } : a)));
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= attributes.length) return;
    const next = [...latest()];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    apply(next);
  };
  const remove = (i: number) => {
    if (apply(latest().filter((_, j) => j !== i))) return;
    const next = attributes[i + 1] ? i : i - 1;
    setSelected(attributes[i + 1]?.id ?? attributes[i - 1]?.id ?? null);
    if (next >= 0) focusRow(next);
  };
  const add = () => {
    const list = latest();
    const taken = new Set(list.map((a) => a.name));
    let n = list.length + 1;
    while (taken.has(t("attribute.defaultName", { n }))) n++;
    const created = createAttribute(t("attribute.defaultName", { n }));
    if (apply([...list, created])) return;
    setSelected(created.id);
    edit(created.id);
  };
  // La ligne à focaliser n'existe qu'au rendu suivant (après suppression ou déplacement).
  const focusRow = (i: number) => requestAnimationFrame(() => rows.current[i]?.focus());

  const onRowKey = (e: KeyboardEvent, i: number) => {
    // Touches d'une bascule ou de la corbeille de la ligne : elles gardent leur effet.
    if (e.target !== e.currentTarget) return;
    const a = attributes[i]!;
    let handled = true;
    if (readOnly && (e.altKey || e.key === "Delete" || e.key === "Backspace")) {
      // Lecture seule : ni déplacement ni suppression.
    } else if (e.altKey && e.key === "ArrowUp") {
      move(i, i - 1);
      focusRow(Math.max(0, i - 1));
    } else if (e.altKey && e.key === "ArrowDown") {
      move(i, i + 1);
      focusRow(Math.min(attributes.length - 1, i + 1));
    } else if (e.key === "ArrowUp" && i > 0) {
      setSelected(attributes[i - 1]!.id);
      rows.current[i - 1]?.focus();
    } else if (e.key === "ArrowDown" && i < attributes.length - 1) {
      setSelected(attributes[i + 1]!.id);
      rows.current[i + 1]?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      remove(i);
    } else if (e.key === "Enter") {
      setSelected(a.id);
      edit(a.id);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const drag = useRowDrag(rows, readOnly ? () => {} : move);
  const duplicates = new Set(attributes.map((a) => a.name).filter((name, i, all) => all.indexOf(name) !== i));

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <h3 className="min-w-0 truncate text-sm font-semibold">{owner.name}</h3>
        {isEntity && (
          <button
            type="button"
            className="flex flex-none items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => report(cmd.addAutoIdentifier(handle, owner.id))}
          >
            <KeyRound size={12} /> {t("inspector.autoDiscriminant")}
          </button>
        )}
      </div>
      <div role="listbox" aria-label={t("inspector.attributes")} className="flex flex-col py-1">
        {attributes.length === 0 && <p className="px-3 py-1 text-sm text-neutral-500">{t("attributes.empty")}</p>}
        {attributes.map((a, i) => (
          <div key={a.id}>
            {drag.target === i && <DropLine />}
            <div
              ref={(el) => void (rows.current[i] = el)}
              role="option"
              aria-selected={a.id === selected}
              tabIndex={0}
              onClick={() => setSelected(a.id)}
              onKeyDown={(e) => onRowKey(e, i)}
              className={`group flex h-7 items-center gap-1 pr-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-inset ${
                a.id === selected ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
              } ${drag.from === i ? "opacity-50" : ""}`}
            >
              <span
                aria-label={t("attributes.drag")}
                {...tip(t("attributes.drag"))}
                onPointerDown={(e) => drag.start(e, i)}
                className="flex h-full w-5 flex-none cursor-grab items-center justify-center text-neutral-300 group-hover:text-neutral-500 dark:text-neutral-600"
              >
                <GripVertical size={12} />
              </span>
              <span className={`mr-1 min-w-0 flex-1 truncate ${a.identifier ? "font-semibold underline" : ""}`}>{a.name}</span>
              <Badge attribute={a} duplicate={duplicates.has(a.name)} />
              <span className={`max-w-32 flex-none truncate text-xs ${a.type ? "text-neutral-500 dark:text-neutral-400" : "text-amber-600 italic"}`}>
                {typeSummary(a.type)}
              </span>
              {isEntity && <Pill label="ID" tooltip={t("attribute.identifier")} on={a.identifier} onToggle={() => update(a.id, { identifier: !a.identifier })} />}
              <Pill label="NN" tooltip="NOT NULL" on={a.notNull} onToggle={() => update(a.id, { notNull: !a.notNull })} />
              <Pill label="UQ" tooltip="UNIQUE" on={a.unique} onToggle={() => update(a.id, { unique: !a.unique })} />
              <IconButton tooltip={t("attribute.delete")} onClick={() => remove(i)}>
                <Trash2 size={12} />
              </IconButton>
            </div>
          </div>
        ))}
        {drag.target === attributes.length && <DropLine />}
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={add}
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
          update={(patch) => update(current.id, patch)}
          // Saisie à la chaîne : Entrée dans le nom de la dernière rubrique en ajoute une (O-50).
          onEnter={index === attributes.length - 1 ? add : undefined}
        />
      ) : (
        attributes.length > 0 && <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">{t("attributes.pick")}</p>
      )}
    </>
  );
}

function AttributeDetail({
  doc,
  attribute: a,
  isEntity,
  focusName,
  update,
  onEnter,
}: {
  doc: ModelDocument;
  attribute: Attribute;
  isEntity: boolean;
  focusName: boolean;
  update: (patch: Partial<Attribute>) => string | null;
  onEnter?: () => void;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-neutral-200 px-3 py-3 dark:border-neutral-700">
      <Field label={t("inspector.name")}>
        <CommitInput value={a.name} autoFocus={focusName} autoSelect={focusName} onEnter={onEnter} onCommit={(name) => update({ name: name.trim() })} />
      </Field>
      <Field label={t("attributes.type")}>
        {/* Nouveau type choisi : le type d'origine (rétroconception) ne vaut plus. */}
        <TypePicker value={a.type} onChange={(type) => update({ type, sourceType: undefined })} />
      </Field>
      <div className="flex flex-wrap gap-x-3">
        {isEntity && <Checkbox label={t("attribute.identifier")} checked={a.identifier} onChange={(identifier) => update({ identifier })} />}
        <Checkbox label="NOT NULL" checked={a.notNull} onChange={(notNull) => update({ notNull })} />
        <Checkbox label="UNIQUE" checked={a.unique} onChange={(unique) => update({ unique })} />
      </div>
      <Disclosure id="attribute.advanced" title={t("inspector.advanced")}>
        <AdvancedFields attribute={a} dialect={doc.settings.dbms} update={(patch) => void update(patch)} />
      </Disclosure>
    </section>
  );
}

/** Bascule compacte d'une ligne (Identifiant, NOT NULL, UNIQUE). */
function Pill({ label, tooltip, on, onToggle }: { label: string; tooltip: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={tooltip}
      {...tip(tooltip)}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`flex-none rounded px-1 font-mono text-[10px] leading-4 ${
        on ? "bg-blue-600 text-white" : "text-neutral-400 hover:bg-neutral-200 dark:text-neutral-500 dark:hover:bg-neutral-700"
      }`}
    >
      {label}
    </button>
  );
}

/** Pastille d'une rubrique en erreur (nom en double) ou en avertissement (sans type) (O-15). */
function Badge({ attribute, duplicate }: { attribute: Attribute; duplicate: boolean }) {
  if (!duplicate && attribute.type) return null;
  const message = duplicate ? t("attributes.duplicate") : t("attributes.untyped");
  return <span aria-label={message} {...tip(message)} className={`size-2 flex-none rounded-full ${duplicate ? "bg-red-500" : "bg-amber-500"}`} />;
}

const DropLine = () => <div className="mx-2 h-0.5 rounded bg-blue-500" />;

/**
 * Réordonner par la poignée : glisser au pointeur (pas de glisser-déposer HTML, que la coquille
 * native peut intercepter). `target` : place d'insertion entre les lignes (0 … n).
 */
function useRowDrag(rows: { current: (HTMLDivElement | null)[] }, move: (from: number, to: number) => void) {
  const [state, setState] = useState<{ from: number; target: number } | null>(null);
  const start = (e: PointerEvent<HTMLElement>, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Le focus quitte un éventuel champ : ⌘Z annule ensuite le déplacement, pas la saisie.
    rows.current[from]?.focus();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let target = from;
    setState({ from, target });
    const onMove = (ev: globalThis.PointerEvent) => {
      const centers = rows.current.map((row) => (row ? row.getBoundingClientRect() : null)).map((r) => (r ? r.top + r.height / 2 : Infinity));
      target = centers.filter((c) => c < ev.clientY).length;
      setState({ from, target });
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setState(null);
      // Insertion avant la ligne `target` : au-delà de la ligne d'origine, l'index se décale d'un cran.
      const to = target > from ? target - 1 : target;
      if (to !== from) move(from, to);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };
  // Pas de trait d'insertion juste avant ou après la ligne déplacée : elle ne bougerait pas.
  const shown = state && state.target !== state.from && state.target !== state.from + 1 ? state.target : null;
  return { start, from: state?.from ?? null, target: shown };
}

/** Résumé court du type d'une rubrique (« Texte var. 50 », « Entier 64 bits »…). */
export function typeSummary(type: DataType | undefined): string {
  if (!type) return t("attributes.untypedShort");
  switch (type.kind) {
    case "text": {
      const encoding = type.encoding === "ascii" ? "" : ` ${t(`type.${type.encoding}`)}`;
      const length =
        type.length === "large"
          ? t("attributes.large")
          : `${t(type.length === "variable" ? "attributes.variable" : "attributes.fixed")}${type.size ? ` ${type.size}` : ""}`;
      return `${t("type.text")}${encoding} ${length}`;
    }
    case "integer":
      return type.bits === 32 ? t("type.integer") : `${t("type.integer")} ${t("type.bits", { n: type.bits })}`;
    case "counter":
      return type.bits === 64 ? `${t("type.counter")} ${t("type.bits", { n: 64 })}` : t("type.counter");
    case "decimal":
      return type.precision === undefined ? t("type.decimal") : `${t("type.decimal")} ${type.precision},${type.scale}`;
    case "real":
      return `${t("type.real")} ${t(`type.${type.precision}`).toLowerCase()}`;
    case "datetime":
      return type.withTimeZone ? `${t("type.datetime")} (${t("type.timezone")})` : t("type.datetime");
    case "free":
      return type.sql || t("type.free");
    default:
      return t(`type.${type.kind}`);
  }
}

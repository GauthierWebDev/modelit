import type { Attribute, DataType, ModelDocument } from "@core/index";
import { type PointerEvent, useState } from "react";
import { t } from "@/i18n";
import { Checkbox, CommitInput, Disclosure, Field } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { AdvancedFields } from "./AttributesEditor";
import { TypePicker } from "./TypePicker";

export function AttributeDetail({
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
        <CommitInput
          value={a.name}
          autoFocus={focusName}
          autoSelect={focusName}
          onEnter={onEnter}
          onCommit={(name) => update({ name: name.trim() })}
        />
      </Field>
      <Field label={t("inspector.logicalName")}>
        <CommitInput
          value={a.logicalName ?? ""}
          placeholder={t("inspector.logicalPlaceholder")}
          onCommit={(logicalName) => update({ logicalName: logicalName.trim() || undefined })}
        />
      </Field>
      <Field label={t("attributes.type")}>
        {/* Nouveau type choisi : le type d'origine (rétroconception) ne vaut plus. */}
        <TypePicker value={a.type} onChange={(type) => update({ type, sourceType: undefined })} />
      </Field>
      <div className="flex flex-wrap gap-x-3">
        {isEntity ? (
          <Checkbox
            label={t("attribute.identifier")}
            checked={a.identifier}
            onChange={(identifier) => update({ identifier })}
          />
        ) : null}
        <Checkbox label="NOT NULL" checked={a.notNull} onChange={(notNull) => update({ notNull })} />
        <Checkbox label="UNIQUE" checked={a.unique} onChange={(unique) => update({ unique })} />
      </div>
      {/* biome-ignore lint/correctness/useUniqueElementIds: prop « id » de Disclosure = clé de préférence, pas un id du DOM */}
      <Disclosure id="attribute.advanced" title={t("inspector.advanced")}>
        <AdvancedFields attribute={a} dialect={doc.settings.dbms} update={(patch) => void update(patch)} />
      </Disclosure>
    </section>
  );
}

/** Bascule compacte d'une ligne (Identifiant, NOT NULL, UNIQUE). */
export function Pill({
  label,
  tooltip,
  on,
  onToggle,
}: {
  label: string;
  tooltip: string;
  on: boolean;
  onToggle: () => void;
}) {
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
        on
          ? "bg-blue-600 text-white"
          : "text-neutral-400 hover:bg-neutral-200 dark:text-neutral-500 dark:hover:bg-neutral-700"
      }`}
    >
      {label}
    </button>
  );
}

/** Pastille d'une rubrique en erreur (nom en double) ou en avertissement (sans type) (O-15). */
export function Badge({ attribute, duplicate }: { attribute: Attribute; duplicate: boolean }) {
  if (!duplicate && attribute.type) {
    return null;
  }
  const message = duplicate ? t("attributes.duplicate") : t("attributes.untyped");
  return (
    <span
      role="img"
      aria-label={message}
      {...tip(message)}
      className={`size-2 flex-none rounded-full ${duplicate ? "bg-red-500" : "bg-amber-500"}`}
    />
  );
}

export const DropLine = () => <div className="mx-2 h-0.5 rounded bg-blue-500" />;

/**
 * Réordonner par la poignée : glisser au pointeur (pas de glisser-déposer HTML, que la coquille
 * native peut intercepter). `target` : place d'insertion entre les lignes (0 … n).
 */
export function useRowDrag(rows: { current: (HTMLDivElement | null)[] }, move: (from: number, to: number) => void) {
  const [state, setState] = useState<{ from: number; target: number } | null>(null);
  const start = (e: PointerEvent<HTMLElement>, from: number) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // Le focus quitte un éventuel champ : ⌘Z annule ensuite le déplacement, pas la saisie.
    rows.current[from]?.focus();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let target = from;
    setState({ from, target });
    const onMove = (ev: globalThis.PointerEvent) => {
      const centers = rows.current
        .map((row) => (row ? row.getBoundingClientRect() : null))
        .map((r) => (r ? r.top + r.height / 2 : Number.POSITIVE_INFINITY));
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
      if (to !== from) {
        move(from, to);
      }
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
  if (!type) {
    return t("attributes.untypedShort");
  }
  switch (type.kind) {
    case "text":
      return textSummary(type);
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

function textSummary(type: Extract<DataType, { kind: "text" }>): string {
  const encoding = type.encoding === "ascii" ? "" : ` ${t(`type.${type.encoding}`)}`;
  // biome-ignore lint/style/useExplicitLengthCheck: « size » est la taille du type texte (nombre facultatif), pas une collection
  const size = type.size ? ` ${type.size}` : "";
  const length =
    type.length === "large"
      ? t("attributes.large")
      : `${t(type.length === "variable" ? "attributes.variable" : "attributes.fixed")}${size}`;
  return `${t("type.text")}${encoding} ${length}`;
}

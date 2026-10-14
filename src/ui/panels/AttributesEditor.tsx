import { createAttribute, type Attribute, type SqlDialect } from "@core/index";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { t } from "@/i18n";
import { Checkbox, CommitInput, Field, IconButton } from "@/ui/common/controls";
import { CheckRow } from "./PhysicalSection";
import { TypePicker } from "./TypePicker";

/**
 * Liste des rubriques d'une entité ou d'une association.
 * Toute modification produit une nouvelle liste, validée par `onChange`
 * (qui renvoie un éventuel message d'erreur).
 */
export function AttributesEditor({
  attributes,
  onChange,
  allowIdentifier,
  advanced = false,
  dialect = "generic",
}: {
  attributes: Attribute[];
  onChange: (attributes: Attribute[]) => string | null;
  allowIdentifier: boolean;
  /** Vue avancée : défaut, CHECK, type d'origine, casse (override O-29). */
  advanced?: boolean;
  /** Dialecte des expressions saisies (celui du SGBD cible). */
  dialect?: SqlDialect;
}) {
  const update = (index: number, patch: Partial<Attribute>) =>
    onChange(attributes.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  const move = (index: number, delta: number) => {
    const next = [...attributes];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };
  const add = () => {
    const taken = new Set(attributes.map((a) => a.name));
    let n = attributes.length + 1;
    while (taken.has(t("attribute.defaultName", { n }))) n++;
    onChange([...attributes, createAttribute(t("attribute.defaultName", { n }))]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {attributes.map((a, i) => (
        <div key={a.id} className="rounded border border-neutral-200 p-1.5 dark:border-neutral-700">
          <div className="flex items-start gap-1">
            <CommitInput className="flex-1" value={a.name} onCommit={(name) => update(i, { name: name.trim() })} />
            <IconButton tooltip={t("attribute.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={14} />
            </IconButton>
            <IconButton tooltip={t("attribute.moveDown")} disabled={i === attributes.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={14} />
            </IconButton>
            <IconButton tooltip={t("attribute.delete")} onClick={() => onChange(attributes.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </IconButton>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Nouveau type choisi : le type d'origine (rétroconception) ne vaut plus. */}
            <TypePicker value={a.type} onChange={(type) => update(i, { type, sourceType: undefined })} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3">
            {allowIdentifier && (
              <Checkbox label={t("attribute.identifier")} checked={a.identifier} onChange={(identifier) => update(i, { identifier })} />
            )}
            <Checkbox label="NOT NULL" checked={a.notNull} onChange={(notNull) => update(i, { notNull })} />
            <Checkbox label="UNIQUE" checked={a.unique} onChange={(unique) => update(i, { unique })} />
          </div>
          {advanced && <AdvancedFields attribute={a} dialect={dialect} update={(patch) => update(i, patch)} />}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center justify-center gap-1 rounded border border-dashed border-neutral-300 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <Plus size={14} /> {t("attribute.add")}
      </button>
    </div>
  );
}

/** Annotations physiques d'une rubrique : valeur par défaut, CHECK, type d'origine, casse. */
function AdvancedFields({ attribute: a, dialect, update }: { attribute: Attribute; dialect: SqlDialect; update: (patch: Partial<Attribute>) => void }) {
  return (
    <div className="mt-1 flex flex-col gap-1 border-t border-dashed border-neutral-200 pt-1 dark:border-neutral-700">
      <Field label="DEFAULT">
        <CommitInput
          className="font-mono text-xs"
          value={a.defaultValue?.expression ?? ""}
          placeholder={t("physical.none")}
          onCommit={(value) => {
            const expression = value.trim();
            if (expression === (a.defaultValue?.expression ?? "")) return;
            update({ defaultValue: expression ? { expression, dialect } : undefined });
          }}
        />
      </Field>
      {a.check ? (
        <CheckRow check={a.check} onChange={(check) => update({ check: check ?? undefined })} />
      ) : (
        <button
          type="button"
          className="flex items-center gap-1 self-start text-xs text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => update({ check: { expression: `${a.name} IS NOT NULL`, dialect } })}
        >
          <Plus size={12} /> CHECK
        </button>
      )}
      {a.sourceType && (
        <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="min-w-0 flex-1 truncate">{t("physical.sourceType", { type: a.sourceType.sql, dialect: a.sourceType.dialect })}</span>
          <IconButton tooltip={t("physical.forgetSourceType")} onClick={() => update({ sourceType: undefined })}>
            <Trash2 size={12} />
          </IconButton>
        </div>
      )}
      {a.domain && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t(a.domain.kind === "enum" ? "physical.domainEnum" : "physical.domainSet", { values: a.domain.values.join(", ") })}
        </p>
      )}
      {a.generated && (
        <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
          {t("physical.generated", { expression: a.generated.expression, mode: a.generated.stored ? "STORED" : "VIRTUAL" })}
        </p>
      )}
      {a.onUpdate && <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">ON UPDATE {a.onUpdate.expression}</p>}
      <Checkbox label={t("physical.unsigned")} checked={Boolean(a.unsigned)} onChange={(on) => update({ unsigned: on || undefined })} />
      <Checkbox label={t("physical.caseSensitive")} checked={Boolean(a.caseSensitive)} onChange={(on) => update({ caseSensitive: on || undefined })} />
    </div>
  );
}

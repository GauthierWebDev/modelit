import type { Attribute, SqlDialect } from "@core/index";
import { Plus, Trash2 } from "lucide-react";
import { t } from "@/i18n";
import { Checkbox, CommitInput, Field, IconButton } from "@/ui/common/controls";
import { CheckRow } from "./PhysicalSection";

/**
 * Annotations physiques d'une rubrique (O-29) : valeur par défaut, CHECK, type d'origine, casse.
 * Affichées dans le bloc « Avancé » du détail de la section Rubriques (O-50).
 */
export function AdvancedFields({
  attribute: a,
  dialect,
  update,
}: {
  attribute: Attribute;
  dialect: SqlDialect;
  update: (patch: Partial<Attribute>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
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
      {a.sourceType ? (
        <div className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="min-w-0 flex-1 truncate">
            {t("physical.sourceType", { type: a.sourceType.sql, dialect: a.sourceType.dialect })}
          </span>
          <IconButton tooltip={t("physical.forgetSourceType")} onClick={() => update({ sourceType: undefined })}>
            <Trash2 size={12} />
          </IconButton>
        </div>
      ) : null}
      {a.domain ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t(a.domain.kind === "enum" ? "physical.domainEnum" : "physical.domainSet", {
            values: a.domain.values.join(", "),
          })}
        </p>
      ) : null}
      {a.generated ? (
        <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
          {t("physical.generated", {
            expression: a.generated.expression,
            mode: a.generated.stored ? "STORED" : "VIRTUAL",
          })}
        </p>
      ) : null}
      {a.onUpdate ? (
        <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">ON UPDATE {a.onUpdate.expression}</p>
      ) : null}
      <Checkbox
        label={t("physical.unsigned")}
        checked={Boolean(a.unsigned)}
        onChange={(on) => update({ unsigned: on || undefined })}
      />
      <Checkbox
        label={t("physical.caseSensitive")}
        checked={Boolean(a.caseSensitive)}
        onChange={(on) => update({ caseSensitive: on || undefined })}
      />
    </div>
  );
}

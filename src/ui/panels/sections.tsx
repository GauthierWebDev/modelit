import {
  applyPattern,
  DISCRIMINANT_PRESETS,
  displayPattern,
  FOREIGN_KEY_PRESETS,
  parsePattern,
  PATTERN_ALIASES,
  PATTERN_VARIABLES,
  PRIMARY_KEY_PRESETS,
  type KeyPattern,
  type PatternKind,
} from "@core/index";
import { useState } from "react";
import * as cmd from "@/app/commands";
import { useLogicalModel } from "@/app/derived";
import { getLocale, t, type MessageKey } from "@/i18n";
import { CommitInput, inputClass, Section } from "@/ui/common/controls";

/** Sections et listes communes à l'inspecteur, aux panneaux d'héritage et aux options. */

/** Tracé d'un lien : aide sur les cassures et suppression de toutes ses cassures. */
export function PathSection({ linkId, bends }: { linkId: string; bends: number }) {
  return (
    <Section title={t("inspector.path")}>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspector.pathHelp")}</p>
      {bends > 0 && (
        <button
          type="button"
          className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => cmd.straightenLink(linkId)}
        >
          {t("inspector.straighten", { n: bends })}
        </button>
      )}
    </Section>
  );
}

export function CommentSection({ value, onCommit }: { value?: string; onCommit: (comment: string | undefined) => void }) {
  return (
    <Section title={t("inspector.comment")}>
      <textarea
        key={value}
        className="min-h-16 w-full rounded border border-neutral-300 bg-white px-1.5 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
        defaultValue={value ?? ""}
        onBlur={(e) => {
          const next = e.target.value.trim() || undefined;
          if (next !== value) onCommit(next);
        }}
      />
    </Section>
  );
}

const PRESETS: Record<PatternKind, KeyPattern[]> = {
  discriminant: DISCRIMINANT_PRESETS,
  primaryKey: PRIMARY_KEY_PRESETS,
  foreignKey: FOREIGN_KEY_PRESETS,
};

/** Valeurs d'exemple des variables, pour l'aperçu d'un schéma. */
const SAMPLE = { entity: "Client", table: "client", column: "id_client", name: "code_client" };

const CUSTOM = "__custom";

/**
 * Schéma de nommage d'un discriminant ou d'une clé (overrides O-13, O-26) : préréglages,
 * ou « Libre… » avec saisie et mini-documentation des variables. Les variables s'écrivent
 * avec les alias de n'importe quelle langue (`<entité>`, `<entity>`…).
 */
export function KeyPatternField({
  kind,
  value,
  onChange,
}: {
  kind: PatternKind;
  value: KeyPattern;
  onChange: (pattern: KeyPattern) => void;
}) {
  const language = getLocale();
  const presets = PRESETS[kind];
  const [custom, setCustom] = useState(!presets.includes(value));
  const variables = PATTERN_VARIABLES[kind];

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        className={inputClass}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return setCustom(true);
          setCustom(false);
          onChange(e.target.value);
        }}
      >
        {presets.map((p) => (
          <option key={p} value={p}>
            {displayPattern(p, language)}
          </option>
        ))}
        <option value={CUSTOM}>{t("pattern.custom")}</option>
      </select>
      {custom && (
        <>
          <CommitInput
            value={displayPattern(value, language)}
            placeholder={t("pattern.customLabel")}
            onCommit={(input) => {
              const parsed = parsePattern(input, kind);
              if (parsed.ok) return void onChange(parsed.pattern);
              return "empty" in parsed ? t("pattern.empty") : t("pattern.unknown", { variables: parsed.unknown.join(", ") });
            }}
          />
          <div className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            <p>{t("pattern.variables")}</p>
            <ul className="mt-0.5">
              {variables.map((variable) => {
                const all = Object.values(PATTERN_ALIASES[variable]).flat();
                const shown = PATTERN_ALIASES[variable][language][0]!;
                const others = [...new Set(all)].filter((a) => a !== shown).map((a) => `<${a}>`);
                return (
                  <li key={variable}>
                    <code className="font-mono">&lt;{shown}&gt;</code> — {t(`pattern.${kind}.${variable}` as MessageKey)}
                    {others.length > 0 && <span className="text-neutral-400"> ({t("pattern.alsoAccepted", { aliases: others.join(", ") })})</span>}
                  </li>
                );
              })}
            </ul>
            {kind === "foreignKey" && <p className="mt-0.5">{t("pattern.compositeNote")}</p>}
            <p className="mt-0.5">{t("pattern.example", { example: applyPattern(value, SAMPLE) })}</p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Texte libre du trait entre tables (MLD / MPD) d'une patte ou d'un lien d'héritage (override O-25).
 * Affiché seulement si ce lien crée effectivement une clé étrangère.
 */
export function RelationTextSection({ linkId, value }: { linkId: string; value?: string }) {
  const logical = useLogicalModel();
  const createsForeignKey = logical.tables.some((table) => table.foreignKeys.some((fk) => fk.relationId === linkId));
  return (
    <Section title={t("inspector.relationText")}>
      {createsForeignKey ? (
        <>
          <CommitInput value={value ?? ""} placeholder={t("inspector.relationTextPlaceholder")} onCommit={(text) => cmd.setRelationLabel(linkId, text)} />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspector.relationTextHelp")}</p>
        </>
      ) : (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspector.relationTextNone")}</p>
      )}
    </Section>
  );
}

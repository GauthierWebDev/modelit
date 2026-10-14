import type { Association, Attribute, CheckConstraint, Entity, KeyMember, ModelDocument } from "@core/index";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import * as cmd from "@/app/commands";
import { t } from "@/i18n";
import { Checkbox, CommitInput, Field, IconButton, Section } from "@/ui/common/controls";

/**
 * Vue avancée (override O-29) : annotations physiques d'une entité ou d'une association, que le
 * MCD n'affiche pas — nom de clé primaire, contraintes CHECK de table, identifiants alternatifs
 * (UNIQUE), index. Le générateur les réapplique quand le SGBD cible le permet.
 */
export function PhysicalSection({ doc, node }: { doc: ModelDocument; node: Entity | Association }) {
  const isEntity = doc.entities.some((e) => e.id === node.id);
  const memberName = (member: KeyMember) => {
    if ("attributeId" in member) return node.attributes.find((a) => a.id === member.attributeId)?.name ?? "?";
    const origin = [...doc.entities, ...doc.associations].flatMap((n) => n.attributes).find((a) => a.id === member.originId);
    return `#${origin?.name ?? "?"}`;
  };
  const edit = (recipe: (n: Entity | Association) => void) => cmd.updatePhysical(node.id, recipe);

  return (
    <Section title={t("physical.title")}>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("physical.help")}</p>
      {isEntity && (
        <Field label={t("physical.primaryKeyName")}>
          <CommitInput
            value={node.primaryKeyName ?? ""}
            placeholder={t("inspector.constraintNamePlaceholder")}
            onCommit={(name) => edit((n) => void (n.primaryKeyName = name.trim() || undefined))}
          />
        </Field>
      )}

      <SubTitle>{t("physical.checks")}</SubTitle>
      {(node.checks ?? []).map((check, i) => (
        <CheckRow
          key={i}
          check={check}
          onChange={(next) => edit((n) => void (next ? (n.checks![i] = next) : n.checks!.splice(i, 1)))}
        />
      ))}
      <AddButton
        label={t("physical.addCheck")}
        onClick={() => edit((n) => void (n.checks ??= []).push({ expression: "1 = 1", dialect: doc.settings.dbms }))}
      />

      <SubTitle>{t("physical.alternateKeys")}</SubTitle>
      {(node.alternateKeys ?? []).map((key, i) => (
        <KeyRow
          key={i}
          name={key.name}
          members={key.members.map(memberName)}
          onRename={(name) => edit((n) => void (n.alternateKeys![i]!.name = name))}
          onDelete={() => edit((n) => void n.alternateKeys!.splice(i, 1))}
        />
      ))}
      <MembersPicker
        label={t("physical.addAlternateKey")}
        attributes={node.attributes}
        onAdd={(ids) => edit((n) => void (n.alternateKeys ??= []).push({ members: ids.map((attributeId) => ({ attributeId })) }))}
      />

      <SubTitle>{t("physical.indexes")}</SubTitle>
      {(node.indexes ?? []).map((index, i) => (
        <KeyRow
          key={i}
          name={index.name}
          members={index.members.map(memberName)}
          onRename={(name) => edit((n) => void (n.indexes![i]!.name = name))}
          onDelete={() => edit((n) => void n.indexes!.splice(i, 1))}
        />
      ))}
      <MembersPicker
        label={t("physical.addIndex")}
        attributes={node.attributes}
        onAdd={(ids) => edit((n) => void (n.indexes ??= []).push({ members: ids.map((attributeId) => ({ attributeId })) }))}
      />
    </Section>
  );
}

function SubTitle({ children }: { children: string }) {
  return <p className="mt-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">{children}</p>;
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 self-start text-xs text-blue-600 hover:underline dark:text-blue-400">
      <Plus size={12} /> {label}
    </button>
  );
}

/** Contrainte CHECK : nom facultatif et expression ; le dialecte d'origine est rappelé. */
export function CheckRow({ check, onChange }: { check: CheckConstraint; onChange: (check: CheckConstraint | null) => void }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-neutral-200 p-1.5 dark:border-neutral-700">
      <div className="flex items-center gap-1">
        <CommitInput
          className="flex-1"
          value={check.name ?? ""}
          placeholder={t("inspector.constraintNamePlaceholder")}
          onCommit={(name) => onChange({ ...check, name: name.trim() || undefined })}
        />
        <IconButton tooltip={t("physical.delete")} onClick={() => onChange(null)}>
          <Trash2 size={14} />
        </IconButton>
      </div>
      <CommitInput
        className="font-mono text-xs"
        value={check.expression}
        onCommit={(expression) => (expression.trim() ? void onChange({ ...check, expression: expression.trim() }) : t("physical.emptyExpression"))}
      />
      <p className="text-[11px] text-neutral-400">{t("physical.dialect", { dialect: check.dialect })}</p>
    </div>
  );
}

function KeyRow({ name, members, onRename, onDelete }: { name?: string; members: string[]; onRename: (name: string | undefined) => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="min-w-0 flex-1 truncate font-mono text-xs">({members.join(", ")})</span>
      <CommitInput
        className="w-32"
        value={name ?? ""}
        placeholder={t("inspector.constraintNamePlaceholder")}
        onCommit={(value) => onRename(value.trim() || undefined)}
      />
      <IconButton tooltip={t("physical.delete")} onClick={onDelete}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

/** Choix des rubriques d'un nouvel identifiant alternatif ou index. */
function MembersPicker({ label, attributes, onAdd }: { label: string; attributes: Attribute[]; onAdd: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  if (!open) return <AddButton label={label} onClick={() => setOpen(true)} />;
  return (
    <div className="flex flex-col gap-1 rounded border border-dashed border-neutral-300 p-1.5 dark:border-neutral-600">
      {attributes.map((a) => (
        <Checkbox
          key={a.id}
          label={a.name}
          checked={chosen.includes(a.id)}
          onChange={(on) => setChosen(on ? [...chosen, a.id] : chosen.filter((id) => id !== a.id))}
        />
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={chosen.length === 0}
          className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
          onClick={() => {
            onAdd(chosen);
            setChosen([]);
            setOpen(false);
          }}
        >
          {t("physical.add")}
        </button>
        <button type="button" className="text-xs hover:underline" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

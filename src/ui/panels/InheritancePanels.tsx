import { bendsOf, type Inheritance, type InheritanceConstraint, type InheritanceLink, type ModelDocument } from "@core/index";
import * as cmd from "@/app/commands";
import { useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { t } from "@/i18n";
import { Section } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { CommentSection, PathSection, RelationTextSection } from "./sections";

/** Panneaux de l'inspecteur pour l'héritage (override O-18). */

const CONSTRAINTS: { id: InheritanceConstraint; symbol: string }[] = [
  { id: "none", symbol: "" },
  { id: "X", symbol: "X" },
  { id: "T", symbol: "T" },
  { id: "XT", symbol: "XT" },
];

export function InheritancePanel({ doc, inheritance }: { doc: ModelDocument; inheritance: Inheritance }) {
  const handle = useDocumentHandle();
  const links = doc.inheritanceLinks.filter((l) => l.inheritanceId === inheritance.id);
  const entityName = (id: string) => doc.entities.find((e) => e.id === id)?.name ?? "?";
  const children = links.filter((l) => l.entityId !== inheritance.parentId);
  const select = useDocumentView((s) => s.select);

  return (
    <>
      <Section title={t("inheritance.title")}>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("inheritance.help")}</p>
      </Section>
      <Section title={t("inheritance.constraint")}>
        <div role="radiogroup" className="grid grid-cols-4 overflow-hidden rounded border border-neutral-300 dark:border-neutral-600">
          {CONSTRAINTS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={inheritance.constraint === c.id}
              {...tip(t(`inheritance.${c.id}`))}
              onClick={() => cmd.setInheritanceConstraint(handle, inheritance.id, c.id)}
              className={`flex flex-col items-center py-1 text-xs ${
                inheritance.constraint === c.id ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
              }`}
            >
              <span className="h-4 font-mono font-bold">{c.symbol || "△"}</span>
              {t(`inheritance.${c.id}`)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("inheritance.target")}>
        {links.length === 0 ? (
          <p className="text-sm text-neutral-500">{t("inheritance.noEntities")}</p>
        ) : (
          <select
            aria-label={t("inheritance.target")}
            className="w-full rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-sm dark:border-neutral-600 dark:bg-neutral-800"
            value={inheritance.parentId ?? ""}
            onChange={(e) => cmd.setInheritanceParent(handle, inheritance.id, e.target.value)}
          >
            {!inheritance.parentId && <option value="">{t("inheritance.choose")}</option>}
            {links.map((l) => (
              <option key={l.id} value={l.entityId}>
                {entityName(l.entityId)}
              </option>
            ))}
          </select>
        )}
      </Section>
      <Section title={t("inheritance.subtypes", { n: children.length })}>
        {children.length < 2 && <p className="text-xs text-amber-700 dark:text-amber-400">{t("inheritance.needTwo")}</p>}
        {children.map((l) => (
          <button
            key={l.id}
            type="button"
            className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => select([l.entityId])}
          >
            {entityName(l.entityId)}
          </button>
        ))}
      </Section>
      <CommentSection value={inheritance.comment} onCommit={(comment) => cmd.updateInheritance(handle, inheritance.id, { comment })} />
    </>
  );
}

export function InheritanceLinkPanel({ doc, link }: { doc: ModelDocument; link: InheritanceLink }) {
  const handle = useDocumentHandle();
  const inheritance = doc.inheritances.find((h) => h.id === link.inheritanceId);
  const entity = doc.entities.find((e) => e.id === link.entityId);
  const isParent = inheritance?.parentId === link.entityId;
  return (
    <>
      <Section title={t("inheritance.link")}>
        <p className="text-sm">
          <strong>{entity?.name}</strong> — {isParent ? t("inheritance.roleTarget") : t("inheritance.roleSubtype")}
        </p>
        {!isParent && inheritance && (
          <button
            type="button"
            className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => cmd.setInheritanceParent(handle, inheritance.id, link.entityId)}
          >
            {t("inheritance.setTarget")}
          </button>
        )}
      </Section>
      <PathSection linkId={link.id} bends={bendsOf(doc.layout, link.id).length} />
      {!isParent && <RelationTextSection linkId={link.id} value={link.relationLabel} />}
    </>
  );
}

import {
  bendsOf,
  REFERENTIAL_ACTIONS,
  type Association,
  type Cardinality,
  type Entity,
  type Link,
  type ModelDocument,
} from "@core/index";
import { ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import * as cmd from "@/app/commands";
import { revealSection } from "@/app/dock/actions";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { Checkbox, CommitInput, ErrorBanner, Field, NumberInput, Section, Select } from "@/ui/common/controls";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { ForeignKeysSection } from "./ForeignKeysSection";
import { InheritanceLinkPanel, InheritancePanel } from "./InheritancePanels";
import { PhysicalSection } from "./PhysicalSection";
import { CommentSection, PathSection, RelationTextSection } from "./sections";

/**
 * Section « Propriétés » (override O-46) : édite l'objet sélectionné. Les paramètres du document
 * sont dans la boîte « Paramètres du modèle » (O-55).
 */
export function PropertiesSection() {
  const doc = useDocument((s) => s.doc);
  const selection = useDocumentView((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [selection]);
  /** Affiche le message d'une commande refusée et le renvoie (pour les champs). */
  const report = (message: string | null) => {
    setError(message);
    return message;
  };

  let content;
  if (selection.length === 0) {
    content = (
      <div className="p-3 text-sm text-neutral-500">
        <p>{t("dock.noSelection")}</p>
        <button type="button" className="mt-1 text-blue-600 hover:underline dark:text-blue-400" onClick={() => useUiStore.getState().setModelSettingsOpen(true)}>
          {t("menu.modelSettings")}
        </button>
      </div>
    );
  } else if (selection.length > 1) {
    content = <p className="p-3 text-sm text-neutral-500">{t("inspector.selectedCount", { n: selection.length })}</p>;
  } else {
    const id = selection[0]!;
    const entity = doc.entities.find((e) => e.id === id);
    const association = doc.associations.find((a) => a.id === id);
    const link = doc.links.find((l) => l.id === id);
    const inheritance = doc.inheritances.find((h) => h.id === id);
    const inheritanceLink = doc.inheritanceLinks.find((l) => l.id === id);
    if (entity) content = <EntityPanel key={id} doc={doc} entity={entity} report={report} />;
    else if (association) content = <AssociationPanel key={id} doc={doc} association={association} report={report} />;
    else if (link) content = <LinkPanel key={id} doc={doc} link={link} report={report} />;
    else if (inheritance) content = <InheritancePanel key={id} doc={doc} inheritance={inheritance} />;
    else if (inheritanceLink) content = <InheritanceLinkPanel key={id} doc={doc} link={inheritanceLink} />;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ErrorBanner message={error} onClose={() => setError(null)} />
      <ReadOnly>{content}</ReadOnly>
    </div>
  );
}

/** Champs désactivés dans l'onglet d'une session en lecture seule (O-05 §4.3). */
export function ReadOnly({ children }: { children: ReactNode }) {
  const readOnly = useSessionReadOnly(useDocumentHandle());
  if (!readOnly) return <>{children}</>;
  return (
    <>
      <p className="mx-3 mt-3 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t("collab.readOnlyNote")}</p>
      <fieldset disabled className="contents [&_:is(input,select,textarea,button)]:cursor-not-allowed [&_:is(input,select,textarea,button)]:opacity-50">
        {children}
      </fieldset>
    </>
  );
}

type Report = (message: string | null) => string | null;

/** Renvoi vers la section Rubriques, où elles s'éditent (O-50). */
function AttributesLink({ count }: { count: number }) {
  return (
    <button
      type="button"
      className="flex items-center gap-0.5 self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
      onClick={() => revealSection("attributes")}
    >
      {t("attributes.link", { n: count })} <ChevronRight size={14} />
    </button>
  );
}

function EntityPanel({ doc, entity, report }: { doc: ModelDocument; entity: Entity; report: Report }) {
  const handle = useDocumentHandle();
  return (
    <>
      <Section title={t("inspector.entity")}>
        <Field label={t("inspector.name")}>
          <CommitInput value={entity.name} onCommit={(name) => report(cmd.renameNode(handle, entity.id, name))} />
        </Field>
        <Field label={t("inspector.logicalName")}>
          <CommitInput
            value={entity.logicalName ?? ""}
            placeholder={t("inspector.logicalPlaceholder")}
            onCommit={(logicalName) => cmd.updateEntity(handle, entity.id, { logicalName: logicalName.trim() || undefined })}
          />
        </Field>
        <Checkbox
          label={t("inspector.fictive")}
          checked={entity.fictive}
          onChange={(fictive) => cmd.updateEntity(handle, entity.id, { fictive })}
        />
        <AttributesLink count={entity.attributes.length} />
      </Section>
      {!entity.fictive && <ForeignKeysSection tableOf={entity.id} />}
      {!entity.fictive && (
        <PhysicalSection doc={doc} node={entity}>
          <Checkbox
            label={t("physical.caseSensitive")}
            checked={Boolean(entity.caseSensitive)}
            onChange={(on) => cmd.updatePhysical(handle, entity.id, (n) => void (n.caseSensitive = on || undefined))}
          />
        </PhysicalSection>
      )}
      <CommentSection value={entity.comment} onCommit={(comment) => cmd.updateEntity(handle, entity.id, { comment })} />
    </>
  );
}

function AssociationPanel({ doc, association, report }: { doc: ModelDocument; association: Association; report: Report }) {
  const handle = useDocumentHandle();
  const links = doc.links.filter((l) => l.associationId === association.id);
  const entityName = (link: Link) => doc.entities.find((e) => e.id === link.entityId)?.name ?? "?";

  return (
    <>
      <Section title={t("inspector.association")}>
        <Field label={t("inspector.name")}>
          <CommitInput value={association.name} onCommit={(name) => report(cmd.renameNode(handle, association.id, name))} />
        </Field>
        <Field label={t("inspector.logicalName")}>
          <CommitInput
            value={association.logicalName ?? ""}
            placeholder={t("inspector.logicalPlaceholder")}
            onCommit={(logicalName) => report(cmd.updateAssociation(handle, association.id, { logicalName: logicalName.trim() || undefined }))}
          />
        </Field>
        <AttributesLink count={association.attributes.length} />
      </Section>
      <Section title={t("inspector.legs", { n: links.length })}>
        {links.length === 0 && <p className="text-sm text-neutral-500">{t("inspector.noLegs")}</p>}
        {links.map((link) => (
          <div key={link.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{entityName(link)}</span>
            <CardinalityButtons link={link} report={report} />
          </div>
        ))}
      </Section>
      <ForeignKeysSection linkIds={links.map((l) => l.id)} />
      <PhysicalSection doc={doc} node={association} />
      <CommentSection value={association.comment} onCommit={(comment) => report(cmd.updateAssociation(handle, association.id, { comment }))} />
    </>
  );
}

const QUICK_CARDINALITIES: Cardinality[] = [
  { min: 0, max: 1 },
  { min: 1, max: 1 },
  { min: 0, max: "n" },
  { min: 1, max: "n" },
];

function CardinalityButtons({ link, report }: { link: Link; report: Report }) {
  const handle = useDocumentHandle();
  return (
    <div className="flex overflow-hidden rounded border border-neutral-300 dark:border-neutral-600">
      {QUICK_CARDINALITIES.map((c) => {
        const active = link.cardinality.min === c.min && link.cardinality.max === c.max;
        return (
          <button
            key={`${c.min},${c.max}`}
            type="button"
            onClick={() => report(cmd.setLinkCardinality(handle, link.id, c))}
            className={`px-2 py-0.5 font-mono text-xs ${
              active ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
            }`}
          >
            {c.min},{c.max}
          </button>
        );
      })}
    </div>
  );
}

function LinkPanel({ doc, link, report }: { doc: ModelDocument; link: Link; report: Report }) {
  const handle = useDocumentHandle();
  const entity = doc.entities.find((e) => e.id === link.entityId);
  const association = doc.associations.find((a) => a.id === link.associationId);
  const parseMax = (v: string) => (v.trim().toLowerCase() === "n" ? "n" : Number(v));
  return (
    <>
      <Section title={t("inspector.link")}>
        <p className="text-sm">
          <strong>{association?.name}</strong> — <strong>{entity?.name}</strong>
        </p>
        <CardinalityButtons link={link} report={report} />
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("inspector.min")}>
            <NumberInput
              min={0}
              value={link.cardinality.min}
              onCommit={(min) => report(cmd.setLinkCardinality(handle, link.id, { ...link.cardinality, min: min ?? 0 }))}
            />
          </Field>
          <Field label={t("inspector.max")}>
            <CommitInput
              value={String(link.cardinality.max)}
              onCommit={(max) => report(cmd.setLinkCardinality(handle, link.id, { ...link.cardinality, max: parseMax(max) }))}
            />
          </Field>
        </div>
        <Checkbox
          label={t("inspector.relativeId")}
          checked={link.relativeId}
          onChange={(relativeId) => cmd.updateLink(handle, link.id, { relativeId })}
        />
      </Section>
      <Section title={t("inspector.advanced")} collapsible="link.advanced">
        {(["onDelete", "onUpdate"] as const).map((event) => (
          <Field key={event} label={event === "onDelete" ? "ON DELETE" : "ON UPDATE"}>
            <Select
              value={link[event] ?? ""}
              options={[{ id: "" as const, label: t("inspector.actionDefault") }, ...REFERENTIAL_ACTIONS.map((a) => ({ id: a, label: a.toUpperCase() }))]}
              onChange={(value) => cmd.updateLink(handle, link.id, { [event]: value || undefined })}
            />
          </Field>
        ))}
        <Field label={t("inspector.constraintName")}>
          <CommitInput
            value={link.foreignKeyConstraintName ?? ""}
            placeholder={t("inspector.constraintNamePlaceholder")}
            onCommit={(name) => cmd.updateLink(handle, link.id, { foreignKeyConstraintName: name.trim() || undefined })}
          />
        </Field>
      </Section>
      <PathSection linkId={link.id} bends={bendsOf(doc.layout, link.id).length} />
      <RelationTextSection linkId={link.id} value={link.relationLabel} />
    </>
  );
}

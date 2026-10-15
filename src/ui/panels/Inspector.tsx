import {
  bendsOf,
  REFERENTIAL_ACTIONS,
  TYPOLOGIES,
  type Association,
  type Cardinality,
  type Entity,
  type Link,
  type ModelDocument,
} from "@core/index";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import * as cmd from "@/app/commands";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { Checkbox, CommitInput, ErrorBanner, Field, NumberInput, Section, Select } from "@/ui/common/controls";
import { AttributesEditor } from "./AttributesEditor";
import { ForeignKeysSection } from "./ForeignKeysSection";
import { InheritanceLinkPanel, InheritancePanel } from "./InheritancePanels";
import { PhysicalSection } from "./PhysicalSection";
import { CommentSection, KeyPatternField, PathSection, RelationTextSection } from "./sections";

/**
 * Panneau de propriétés : édite l'objet sélectionné, ou les paramètres
 * du document quand rien n'est sélectionné.
 */
export function Inspector() {
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
    content = <DocumentSettingsPanel doc={doc} />;
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
      {content}
    </div>
  );
}

type Report = (message: string | null) => string | null;

/** Bascule de la vue avancée (annotations physiques, override O-29). */
function AdvancedToggle() {
  const advanced = useUiStore((s) => s.advanced);
  const setAdvanced = useUiStore((s) => s.setAdvanced);
  return (
    <div className="border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-700">
      <Checkbox label={t("physical.toggle")} checked={advanced} onChange={setAdvanced} />
    </div>
  );
}

function EntityPanel({ doc, entity, report }: { doc: ModelDocument; entity: Entity; report: Report }) {
  const handle = useDocumentHandle();
  const advanced = useUiStore((s) => s.advanced);
  return (
    <>
      <AdvancedToggle />
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
        {advanced && (
          <Checkbox
            label={t("physical.caseSensitive")}
            checked={Boolean(entity.caseSensitive)}
            onChange={(on) => cmd.updatePhysical(handle, entity.id, (n) => void (n.caseSensitive = on || undefined))}
          />
        )}
      </Section>
      <Section
        title={t("inspector.attributes")}
        actions={
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            onClick={() => report(cmd.addAutoIdentifier(handle, entity.id))}
          >
            <KeyRound size={12} /> {t("inspector.autoDiscriminant")}
          </button>
        }
      >
        <AttributesEditor
          attributes={entity.attributes}
          allowIdentifier
          advanced={advanced}
          dialect={doc.settings.dbms}
          onChange={(attributes) => report(cmd.setAttributes(handle, entity.id, attributes))}
        />
      </Section>
      {!entity.fictive && <ForeignKeysSection tableOf={entity.id} />}
      {advanced && !entity.fictive && <PhysicalSection doc={doc} node={entity} />}
      <CommentSection value={entity.comment} onCommit={(comment) => cmd.updateEntity(handle, entity.id, { comment })} />
    </>
  );
}

function AssociationPanel({ doc, association, report }: { doc: ModelDocument; association: Association; report: Report }) {
  const handle = useDocumentHandle();
  const links = doc.links.filter((l) => l.associationId === association.id);
  const entityName = (link: Link) => doc.entities.find((e) => e.id === link.entityId)?.name ?? "?";
  const advanced = useUiStore((s) => s.advanced);

  return (
    <>
      <AdvancedToggle />
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
      <Section title={t("inspector.attributes")}>
        <AttributesEditor
          attributes={association.attributes}
          allowIdentifier={false}
          advanced={advanced}
          dialect={doc.settings.dbms}
          onChange={(attributes) => report(cmd.setAttributes(handle, association.id, attributes))}
        />
      </Section>
      <ForeignKeysSection linkIds={links.map((l) => l.id)} />
      {advanced && <PhysicalSection doc={doc} node={association} />}
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
      <Section title={t("inspector.cascades")}>
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

function DocumentSettingsPanel({ doc }: { doc: ModelDocument }) {
  const handle = useDocumentHandle();
  const s = doc.settings;
  return (
    <>
      <Section title={t("inspector.logicalNames")}>
        <Field label={t("inspector.typology")}>
          <Select
            value={s.naming.typology}
            options={TYPOLOGIES.map((id) => ({ id, label: t(`typology.${id}`) }))}
            onChange={(typology) => cmd.updateSettings(handle, "history.typology", (d) => void (d.naming.typology = typology))}
          />
        </Field>
        <Checkbox
          label={t("inspector.stripAccents")}
          checked={s.naming.stripAccents}
          onChange={(v) => cmd.updateSettings(handle, "history.stripAccents", (d) => void (d.naming.stripAccents = v))}
        />
      </Section>
      <Section title={t("inspector.keys")}>
        <Field label={t("inspector.autoIdMask")}>
          <KeyPatternField
            kind="discriminant"
            value={s.autoIdMask}
            onChange={(pattern) => cmd.updateSettings(handle, "history.autoIdMask", (d) => void (d.autoIdMask = pattern))}
          />
        </Field>
        <Field label={t("inspector.primaryKey")}>
          <KeyPatternField
            kind="primaryKey"
            value={s.keys.primary}
            onChange={(pattern) => cmd.updateSettings(handle, "history.primaryKeyMask", (d) => void (d.keys.primary = pattern))}
          />
        </Field>
        <Field label={t("inspector.foreignKey")}>
          <KeyPatternField
            kind="foreignKey"
            value={s.keys.foreign}
            onChange={(pattern) => cmd.updateSettings(handle, "history.foreignKeyMask", (d) => void (d.keys.foreign = pattern))}
          />
        </Field>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("inspector.keysHelp")}</p>
      </Section>
      <Section title={t("inspector.display")}>
        <Checkbox
          label={t("inspector.showAttributes")}
          checked={s.display.showAttributes}
          onChange={(v) => cmd.updateSettings(handle, "history.showAttributes", (d) => void (d.display.showAttributes = v))}
        />
        <Checkbox
          label={t("inspector.grid")}
          checked={s.grid.enabled}
          onChange={(v) => cmd.updateSettings(handle, "history.grid", (d) => void (d.grid.enabled = v))}
        />
        <Field label={t("inspector.gridSize")}>
          <NumberInput min={2} value={s.grid.size} onCommit={(v) => cmd.updateSettings(handle, "history.gridSize", (d) => void (d.grid.size = v ?? 10))} />
        </Field>
      </Section>
      <Section title={t("ddl.title")}>
        <Checkbox
          label={t("ddl.foreignKeysInAlter")}
          checked={s.ddl.foreignKeysInAlter}
          onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.foreignKeysInAlter = v))}
        />
        <Checkbox
          label={t("ddl.indexes")}
          checked={s.ddl.indexes}
          onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.indexes = v))}
        />
        <Checkbox
          label={t("ddl.sourceColumnOrder")}
          checked={s.ddl.sourceColumnOrder}
          onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.sourceColumnOrder = v))}
        />
        <Checkbox
          label={t("ddl.strictRanges")}
          checked={s.ddl.strictRanges}
          onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.strictRanges = v))}
        />
        <Field label={t("ddl.unsigned")}>
          <Select
            value={s.ddl.unsigned}
            options={(["widen", "check"] as const).map((id) => ({ id, label: t(`ddl.unsigned.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.unsigned = v))}
          />
        </Field>
        <Field label={t("ddl.enums")}>
          <Select
            value={s.ddl.enums}
            options={(["check", "type"] as const).map((id) => ({ id, label: t(`ddl.enums.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.enums = v))}
          />
        </Field>
        <Field label={t("ddl.sets")}>
          <Select
            value={s.ddl.sets}
            options={(["array", "text"] as const).map((id) => ({ id, label: t(`ddl.sets.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.sets = v))}
          />
        </Field>
        <Field label={t("ddl.collations")}>
          <Select
            value={s.ddl.collations}
            options={(["icu", "deterministic"] as const).map((id) => ({ id, label: t(`ddl.collations.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.collations = v))}
          />
        </Field>
        <Field label={t("ddl.oracleDates")}>
          <Select
            value={s.ddl.oracleDates}
            options={(["timestamp", "date"] as const).map((id) => ({ id, label: t(`ddl.oracleDates.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.oracleDates = v))}
          />
        </Field>
        <Field label={t("ddl.emptyStrings")}>
          <Select
            value={s.ddl.emptyStrings}
            options={(["check", "none"] as const).map((id) => ({ id, label: t(`ddl.emptyStrings.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.emptyStrings = v))}
          />
        </Field>
        <Field label={t("ddl.spatial")}>
          <Select
            value={s.ddl.spatial}
            options={(["postgis", "wkb", "wkt"] as const).map((id) => ({ id, label: t(`ddl.spatial.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.spatial = v))}
          />
        </Field>
        <Field label={t("ddl.sqlServerCollation")}>
          <Select
            value={s.ddl.sqlServerCollation}
            options={(["ci_as", "ci_ai", "cs_as"] as const).map((id) => ({ id, label: t(`ddl.sqlServerCollation.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.sqlServerCollation = v))}
          />
        </Field>
        <Field label={t("ddl.dboSchema")}>
          <Select
            value={s.ddl.dboSchema}
            options={(["public", "dbo"] as const).map((id) => ({ id, label: t(`ddl.dboSchema.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.dboSchema = v))}
          />
        </Field>
        <Field label={t("ddl.constraintNaming")}>
          <Select
            value={s.ddl.constraintNaming}
            options={(["none", "prefix", "suffix"] as const).map((id) => ({ id, label: t(`ddl.constraintNaming.${id}`) }))}
            onChange={(v) => cmd.updateSettings(handle, "history.ddlOptions", (d) => void (d.ddl.constraintNaming = v))}
          />
        </Field>
      </Section>
      <Section title={t("inspector.relations")}>
        <Checkbox
          label={t("inspector.relationArrows")}
          checked={s.display.relationArrows}
          onChange={(v) => cmd.updateSettings(handle, "history.relationArrows", (d) => void (d.display.relationArrows = v))}
        />
        <Field label={t("inspector.relationLabels")}>
          <Select
            value={s.display.relationLabels}
            options={(["none", "foreignKey", "text"] as const).map((id) => ({ id, label: t(`inspector.relationLabels.${id}`) }))}
            onChange={(mode) => cmd.updateSettings(handle, "history.relationLabels", (d) => void (d.display.relationLabels = mode))}
          />
        </Field>
      </Section>
    </>
  );
}

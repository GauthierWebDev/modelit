import { formatCardinality, linksOf, type Id, type LogicalColumn, type ModelDocument } from "@core/index";
import { Info } from "lucide-react";
import { renameForeignKey } from "@/app/commands";
import { useLogicalModel } from "@/app/derived";
import { useDocument, useDocumentHandle } from "@/app/document/DocumentContext";
import { t } from "@/i18n";
import { CommitInput, Section } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";

/**
 * Clés étrangères renommables (override O-07), affichées sous les rubriques.
 *  - Entité / association avec table : les clés étrangères de sa table.
 *  - Association (bulle du MCD) : les clés étrangères créées par ses pattes, où qu'elles
 *    arrivent (table de correspondance ou table d'une entité).
 * Un champ vide rétablit le nom par défaut (celui de la colonne référencée).
 * Chaque clé a une infobulle qui détaille la liaison d'où elle vient (override O-20).
 */
export function ForeignKeysSection({ tableOf, linkIds }: { tableOf?: Id; linkIds?: Id[] }) {
  const logical = useLogicalModel();
  const handle = useDocumentHandle();
  const doc = useDocument((s) => s.doc);
  const rows: { table: string; column: LogicalColumn; referenced: string | undefined }[] = [];
  for (const table of logical.tables) {
    table.columns.forEach((column) => {
      if (!column.origin) return;
      if (table.source.id !== tableOf && !linkIds?.includes(column.origin.linkId)) return;
      const fk = table.foreignKeys.find((f) => f.columns.includes(column.name));
      const referenced = fk && `${fk.referencedTable}.${fk.referencedColumns[fk.columns.indexOf(column.name)]}`;
      rows.push({ table: table.name, column, referenced });
    });
  }
  // Depuis la bulle d'association, la clé peut arriver dans la table d'une entité : on la nomme.
  const showTable = linkIds !== undefined;

  return (
    <Section title={t("fk.title")}>
      {rows.length === 0 && <p className="text-sm text-neutral-500">{t("fk.none")}</p>}
      {rows.map(({ table, column, referenced }) => {
        const origin = column.origin!;
        const details = [
          t("fk.linkage", { linkage: describeLinkage(doc, origin.linkId) }),
          referenced && t("fk.target", { table: referenced.split(".")[0]!, column: referenced.split(".")[1]! }),
          t("fk.inTable", { table }),
        ]
          .filter(Boolean)
          .join("\n");
        return (
          <div key={`${table}-${origin.linkId}-${origin.attributeId}`} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <span className="w-3 font-mono text-sm text-pink-700 dark:text-pink-400">{column.foreign ? "#" : ""}</span>
              <CommitInput
                className="flex-1"
                value={column.name}
                placeholder={origin.defaultName}
                onCommit={(name) =>
                  renameForeignKey(handle, origin.linkId, origin.attributeId, name.trim() === origin.defaultName ? "" : name)
                }
              />
              <span
                className="inline-flex cursor-help text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                aria-label={details}
                {...tip(details)}
              >
                <Info size={14} />
              </span>
            </div>
            <p className="pl-4 text-xs text-neutral-500 dark:text-neutral-400">
              {column.name !== origin.defaultName && t("fk.references", { name: origin.defaultName })}
              {column.name !== origin.defaultName && showTable && " · "}
              {showTable && t("fk.table", { name: table })}
            </p>
          </div>
        );
      })}
    </Section>
  );
}

/**
 * Liaison d'où vient une clé étrangère : `<entité 1> (card.) — association — (card.) <entité 2>`,
 * l'entité 1 étant celle que la clé référence. Association n-aire : les autres pattes à la suite.
 */
export function describeLinkage(doc: ModelDocument, linkId: Id): string {
  const reference = doc.links.find((l) => l.id === linkId);
  const association = reference && doc.associations.find((a) => a.id === reference.associationId);
  if (!reference || !association) return "?";
  const entity = (id: Id) => doc.entities.find((e) => e.id === id)?.name ?? "?";
  const others = linksOf(doc, association.id).filter((l) => l.id !== reference.id);
  const tail = others.map((l) => `(${formatCardinality(l.cardinality)}) ${entity(l.entityId)}`).join(", ");
  return `${entity(reference.entityId)} (${formatCardinality(reference.cardinality)}) — ${association.name} — ${tail}`;
}

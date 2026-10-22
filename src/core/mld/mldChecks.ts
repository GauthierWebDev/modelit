import type { Association, Entity, Link } from "../model/document";
import type { ConstraintState, KeyMember } from "../model/physical";
import { MSG } from "../validation/messages";
import { generatesTable } from "../validation/rules";
import type { LogicalTable } from "./logical";
import type { Context } from "./mldContext";

export function checkAssociationModel(ctx: Context, association: Association, links: Link[]): boolean {
  const target = { kind: "association" as const, id: association.id };
  const error = (message: string) => {
    ctx.issues.push({ severity: "error", message, target });
    return false;
  };
  if (links.length < 2) {
    return error(MSG.associationNeedsTwoLegs);
  }
  const oneOne = links.filter((l) => l.cardinality.min === 1 && l.cardinality.max === 1);
  if (links.length === 2 && oneOne.length === 2) {
    return error(MSG.bothSidesOneOne);
  }
  if (association.attributes.length > 0 && !generatesTable(links)) {
    return error(oneOne.length > 0 ? MSG.oneOneForbiddenWithAttributes : MSG.attributesNeedTable);
  }
  return true;
}

/**
 * Contrôles du MCD indépendants du passage en MLD. Normalement empêchés à la saisie, ces défauts
 * peuvent venir d'un fichier modifié à la main (ou, plus tard, d'une édition simultanée) :
 * le panneau Problèmes doit lister tous les défauts (override O-15).
 */
export function checkConceptualModel(ctx: Context) {
  const duplicated = <T extends { name: string }>(items: T[]) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.name.trim(), (counts.get(item.name.trim()) ?? 0) + 1);
    }
    return items.filter((item) => counts.get(item.name.trim())! > 1);
  };
  for (const e of duplicated(ctx.doc.entities)) {
    ctx.issues.push({
      severity: "error",
      message: MSG.duplicateEntityName(e.name),
      target: { kind: "entity", id: e.id },
    });
  }
  for (const a of duplicated(ctx.doc.associations)) {
    ctx.issues.push({
      severity: "error",
      message: MSG.duplicateAssociationName(a.name),
      target: { kind: "association", id: a.id },
    });
  }
  for (const owner of [...ctx.doc.entities, ...ctx.doc.associations]) {
    if (duplicated(owner.attributes).length > 0) {
      ctx.issues.push({
        severity: "error",
        message: MSG.duplicateAttributesIn(owner.name),
        target: { kind: owner.kind, id: owner.id },
      });
    }
    checkAtomicity(ctx, owner);
  }
  // Référence déclarée en ligne, non appliquée par le SGBD d'origine (O-36).
  for (const link of ctx.doc.links) {
    if (!link.sourceNotEnforced) {
      continue;
    }
    const association = ctx.doc.associations.find((a) => a.id === link.associationId);
    if (association) {
      ctx.issues.push({
        severity: "warning",
        message: MSG.referenceNotEnforced(association.name),
        target: { kind: "association", id: association.id },
      });
    }
  }
}

/**
 * Normalisation (O-36) : attribut multivalué (SET) ou non atomique (JSON), contraires à la
 * première forme normale ; identifiant alternatif sur préfixe (unicité partielle).
 */
function checkAtomicity(ctx: Context, owner: Entity | Association) {
  const target = { kind: owner.kind, id: owner.id };
  const warn: Warn = (message) => {
    ctx.issues.push({ severity: "warning", message, target });
  };
  atomicityWarnings(owner, warn);
  // Annotations physiques que le MCD n'exprime pas (O-39).
  stateWarnings(ctx, owner, warn);
  conditionalUniques(ctx, owner, warn);
  if (owner.partition) {
    warn(MSG.partitionDropped(owner.name));
  }
  // O-41 : UNIQUE à un seul NULL admis (SQL Server) sur une colonne facultative ; types spatiaux ; ROWVERSION.
  singleNullUniques(ctx, owner, warn);
  typeWarnings(ctx, owner, warn);
  prefixKeys(owner, warn);
}

type Warn = (message: string) => void;

/** Rubriques multivaluées (SET) ou non atomiques (JSON). */
function atomicityWarnings(owner: Entity | Association, warn: Warn) {
  for (const a of owner.attributes) {
    if (a.domain?.kind === "set") {
      warn(MSG.multivaluedAttribute(owner.name, a.name));
    }
    const json =
      (a.type?.kind === "free" && /^jsonb?$/i.test(a.type.sql.trim())) || /^jsonb?\b/i.test(a.sourceType?.sql ?? "");
    if (json) {
      warn(MSG.nonAtomicAttribute(owner.name, a.name));
    }
  }
}

/** Contraintes désactivées ou non validées : CHECK, UNIQUE, clés étrangères portées. */
function stateWarnings(ctx: Context, owner: Entity | Association, warn: Warn) {
  const disabled = (name: string | undefined, state: ConstraintState | undefined, fallback: string) => {
    if (state?.disabled) {
      warn(MSG.constraintDisabled(owner.name, name ?? fallback, state.dialect));
    }
    if (state?.notValidated) {
      warn(MSG.constraintNotValidated(owner.name, name ?? fallback, state.dialect));
    }
  };
  for (const a of owner.attributes) {
    if (a.check) {
      disabled(a.check.name, a.check.state, `CHECK (${a.check.expression})`);
    }
  }
  for (const check of owner.checks ?? []) {
    disabled(check.name, check.state, `CHECK (${check.expression})`);
  }
  for (const key of owner.alternateKeys ?? []) {
    disabled(key.name, key.state, "UNIQUE");
  }
  for (const link of ctx.doc.links) {
    if (link.entityId === owner.id && link.foreignKeyHolder) {
      disabled(link.foreignKeyConstraintName, link.foreignKeyState, "FOREIGN KEY");
    }
  }
}

function conditionalUniques(ctx: Context, owner: Entity | Association, warn: Warn) {
  for (const key of owner.alternateKeys ?? []) {
    if (!key.where) {
      continue;
    }
    const names = key.members.map(
      (m) =>
        ("attributeId" in m ? owner.attributes.find((a) => a.id === m.attributeId)?.name : keyMemberLabel(ctx, m)) ??
        "?",
    );
    warn(MSG.conditionalUnique(owner.name, names.join(", "), key.where.expression));
  }
}

function singleNullUniques(ctx: Context, owner: Entity | Association, warn: Warn) {
  for (const key of owner.alternateKeys ?? []) {
    if (key.nulls !== "not distinct") {
      continue;
    }
    const optional = key.members.filter((m) => optionalMember(ctx, owner, m));
    if (optional.length > 0) {
      const names = optional.map((m) =>
        "attributeId" in m
          ? owner.attributes.find((a) => a.id === m.attributeId)!.name
          : (keyMemberLabel(ctx, m) ?? "#"),
      );
      warn(MSG.singleNullUnique(owner.name, names.join(", ")));
    }
  }
}

/** Membre facultatif : rubrique ni NOT NULL ni identifiante, ou patte dont l'autre côté est 0,…. */
function optionalMember(ctx: Context, owner: Entity | Association, m: KeyMember) {
  if ("attributeId" in m) {
    const a = owner.attributes.find((x) => x.id === m.attributeId);
    return a && !a.notNull && !a.identifier;
  }
  const link = ctx.doc.links.find((l) => l.id === m.linkId);
  const holder = link && ctx.doc.links.find((l) => l.associationId === link.associationId && l.id !== link.id);
  return holder?.cardinality.min === 0;
}

/** Types spatiaux sans extension native ; ROWVERSION hors SQL Server. */
function typeWarnings(ctx: Context, owner: Entity | Association, warn: Warn) {
  const { dbms } = ctx.doc.settings;
  for (const a of owner.attributes) {
    if (
      (a.type?.kind === "geography" || a.type?.kind === "geometry") &&
      (dbms === "postgresql" || dbms === "sqlite" || dbms === "db2")
    ) {
      warn(MSG.spatialExtension(owner.name, a.name, a.type.kind.toUpperCase(), dbms));
    }
    if (a.type?.kind === "free" && a.type.sql === "ROWVERSION" && dbms !== "sqlserver") {
      warn(MSG.rowversionAttribute(owner.name, a.name));
    }
  }
}

function prefixKeys(owner: Entity | Association, warn: Warn) {
  for (const key of owner.alternateKeys ?? []) {
    if (!key.prefixes?.some((p) => p !== null)) {
      continue;
    }
    const names = key.members.map((m, i) => {
      const attribute = "attributeId" in m ? owner.attributes.find((a) => a.id === m.attributeId)?.name : "#";
      return key.prefixes?.[i] ? `${attribute}(${key.prefixes[i]})` : attribute;
    });
    warn(MSG.prefixAlternateKey(owner.name, names.join(", ")));
  }
}

/** Membre d'une clé venu d'une patte : nom de l'association (ex. « sejour_Patient »). */
function keyMemberLabel(ctx: Context, member: KeyMember): string | undefined {
  if ("attributeId" in member) {
    return undefined;
  }
  const link = ctx.doc.links.find((l) => l.id === member.linkId);
  const association = link && ctx.doc.associations.find((a) => a.id === link.associationId);
  // Nom de la colonne de clé étrangère dans la table (vol_retour), pas celui de la clé référencée (O-41).
  const origin = ctx.entities.get(link?.entityId ?? "")?.attributes.find((a) => a.id === member.originId);
  const column = link?.foreignKeyNames?.[member.originId]?.trim() || origin?.name || "#";
  return association ? `${column} (${association.name})` : undefined;
}

/**
 * Héritages : une entité cible (surtype) et au moins une entité spécialisée (overrides O-18, O-36).
 * Renvoie, pour chaque sous-type, l'héritage valide dont il dépend.
 */
export function checkInheritances(ctx: Context) {
  for (const inheritance of ctx.doc.inheritances) {
    const target = { kind: "inheritance" as const, id: inheritance.id };
    const links = ctx.doc.inheritanceLinks.filter(
      (l) => l.inheritanceId === inheritance.id && ctx.entities.has(l.entityId),
    );
    const entityIds = links.map((l) => l.entityId);
    const parentId =
      inheritance.parentId && entityIds.includes(inheritance.parentId) ? inheritance.parentId : undefined;
    const children = entityIds.filter((id) => id !== parentId);
    if (!parentId) {
      ctx.issues.push({ severity: "error", message: MSG.inheritanceNeedsParent, target });
    }
    if (children.length === 0) {
      ctx.issues.push({ severity: "error", message: MSG.inheritanceNeedsChild, target });
    }
    if (!parentId) {
      continue;
    }
    for (const child of children) {
      if (ctx.parents.has(child)) {
        const entity = ctx.entities.get(child)!;
        ctx.issues.push({
          severity: "error",
          message: MSG.multipleParents(entity.name),
          target: { kind: "entity", id: child },
        });
        continue;
      }
      ctx.parents.set(child, {
        inheritanceId: inheritance.id,
        parentId,
        linkId: links.find((l) => l.entityId === child)!.id,
      });
    }
  }
}

export function checkTables(ctx: Context, tables: LogicalTable[]) {
  const ownerName = (table: LogicalTable) =>
    (table.source.kind === "entity"
      ? ctx.entities.get(table.source.id)
      : ctx.doc.associations.find((a) => a.id === table.source.id)
    )?.name ?? table.name;
  const counts = new Map<string, number>();
  for (const table of tables) {
    counts.set(table.name, (counts.get(table.name) ?? 0) + 1);
  }
  for (const table of tables) {
    if (counts.get(table.name)! > 1) {
      ctx.issues.push({
        severity: "error",
        message: MSG.duplicateTableConceptual(table.name),
        logicalMessage: MSG.duplicateTableLogical(table.name),
        target: table.source,
      });
    }
    const seen = new Set<string>();
    for (const column of table.columns) {
      if (seen.has(column.name)) {
        ctx.issues.push({
          severity: "error",
          message: MSG.duplicateColumnConceptual(ownerName(table), column.name),
          logicalMessage: MSG.duplicateColumnLogical(table.name, column.name),
          target: table.source,
        });
      }
      seen.add(column.name);
    }
  }
}

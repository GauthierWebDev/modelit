import { referencedColumns } from "../ddl/expressions";
import type { Association, Entity } from "../model/document";
import type { AlternateKey, CheckConstraint, KeyMember } from "../model/physical";
import { MSG } from "../validation/messages";
import { type Build, key, keyOptions, originOf, plainKey, sameColumns } from "./buildState";
import type { NamedExpression, ParsedKey, ParsedTable } from "./parse";

type Node = Entity | Association;
/** Membres d'une clé (rubriques ou pattes), ou `null` si une colonne n'a pas d'équivalent. */
type Members = (columns: string[]) => KeyMember[] | null;

/** 7. Annotations de table : nom quoté, nom de clé primaire, UNIQUE, CHECK, index, ordre des colonnes. */
export function annotateTables(b: Build, joinAssociations: Map<ParsedTable, Association>) {
  for (const table of b.schema.tables) {
    const node: Node | undefined = b.entities.get(table) ?? joinAssociations.get(table);
    if (!node) {
      continue;
    }
    tableOptions(b, table, node);
    const members = keyMembers(b, table);
    alternateKeys(b, table, node, members);
    tableIndexes(table, node, members);
    tableChecks(b, table, node);
  }
}

/** Nom quoté, clé primaire, ordre des colonnes, compteur, déclencheurs, stockage, schéma, séquences. */
function tableOptions(b: Build, table: ParsedTable, node: Node) {
  const { dialect } = b;
  node.caseSensitive = table.quoted || undefined;
  node.primaryKeyName = table.primaryKeyName;
  node.columnOrder = table.columns.map((c) => c.name);
  const start = table.autoIncrementStart ?? table.columns.find((c) => c.identityStart !== undefined)?.identityStart;
  if (start !== undefined) {
    node.autoIncrementStart = start;
  }
  const step = table.columns.find((c) => c.identityIncrement !== undefined)?.identityIncrement;
  if (step !== undefined) {
    node.autoIncrementStep = step;
  }
  if (table.triggers.length > 0) {
    node.triggers = table.triggers.map((t) => ({ ...t, dialect }));
  }
  if (table.primaryKeyState) {
    node.primaryKeyState = table.primaryKeyState;
  }
  if (table.storage.length > 0) {
    node.storage = table.storage;
  }
  if (table.partition) {
    node.partition = { sql: table.partition, dialect };
  }
  if (table.schema) {
    node.schema = table.schema;
  }
  // Séquences utilisées par les colonnes de la table (O-39).
  const sequences = table.columns
    .map((c) => c.sequence && b.schema.sequences.get(key(c.sequence.name)))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map(({ ownedBy: _owned, ...definition }) => definition);
  if (sequences.length > 0) {
    node.sequences = sequences;
  }
}

/** Membres d'une clé de la table : rubrique propre, sinon patte de la clé étrangère qui fournit la colonne. */
function keyMembers(b: Build, table: ParsedTable): Members {
  const memberOf = (column: string): KeyMember | undefined => {
    const attribute = b.attributeOf.get(table)?.get(key(column));
    if (attribute) {
      return { attributeId: attribute.id };
    }
    for (const fk of b.fks.get(table)!) {
      const index = fk.columns.findIndex((c) => key(c) === key(column));
      const link = b.referenceLink.get(fk);
      const origin = index >= 0 ? originOf(b, fk.target, fk.referencedColumns[index]!) : undefined;
      if (link && origin) {
        return { linkId: link.id, originId: origin.id };
      }
    }
    return undefined;
  };
  return (columns: string[]) => {
    const list = columns.map(memberOf);
    return list.every((m): m is KeyMember => Boolean(m)) ? list : null;
  };
}

/** UNIQUE : composés, nommés ou portant sur des clés étrangères → identifiants alternatifs. */
function alternateKeys(b: Build, table: ParsedTable, node: Node, members: Members) {
  const { dialect } = b;
  const uniques: ParsedKey[] = [
    ...table.uniques,
    // UNIQUE en ligne nommé, ou sur une colonne facultative SQL Server (un seul NULL admis, O-41).
    ...table.columns
      .filter((c) => c.unique && (c.uniqueName || (dialect === "sqlserver" && !c.notNull)))
      .map((c) => ({ name: c.uniqueName, columns: [c.name] })),
  ];
  for (const unique of uniques) {
    const alternate = alternateKey(b, table, unique, members);
    if (alternate) {
      node.alternateKeys = [...(node.alternateKeys ?? []), alternate];
    }
  }
}

/** Identifiant alternatif d'un UNIQUE, ou `undefined` s'il est déjà exprimé autrement. */
function alternateKey(b: Build, table: ParsedTable, unique: ParsedKey, members: Members): AlternateKey | undefined {
  const { dialect } = b;
  const nulls = uniqueNulls(b, table, unique);
  const single = unique.columns.length === 1 ? b.attributeOf.get(table)?.get(key(unique.columns[0]!)) : undefined;
  const plain = plainKey(unique) && !unique.method && !nulls;
  if (single && !unique.name && plain) {
    return undefined; // déjà porté par la rubrique
  }
  const list = members(unique.columns);
  // UNIQUE anonyme couvrant exactement une clé étrangère : exprimé par la cardinalité 0,1.
  if (
    !unique.name &&
    plainKey(unique) &&
    !nulls &&
    b.fks.get(table)!.some((fk) => sameColumns(fk.columns, unique.columns))
  ) {
    return undefined;
  }
  if (!list) {
    return undefined;
  }
  return {
    name: unique.name,
    members: list,
    ...keyOptions(unique),
    ...(unique.state ? { state: unique.state } : {}),
    ...(unique.expression ? { expression: { expression: unique.expression, dialect } } : {}),
    ...(unique.where ? { where: { expression: unique.where, dialect } } : {}),
    ...(nulls ? { nulls } : {}),
    ...(unique.include && members(unique.include) ? { include: members(unique.include)! } : {}),
  };
}

/** Traitement des NULL d'un UNIQUE (O-39, O-41). */
function uniqueNulls(b: Build, table: ParsedTable, unique: ParsedKey): AlternateKey["nulls"] {
  const { dialect } = b;
  // Clé composée Oracle avec une colonne facultative : les NULL y sont égaux entre eux (O-39).
  const nullable = unique.columns.some(
    (c) =>
      !(
        table.columns.find((col) => key(col.name) === key(c))?.notNull ||
        table.primaryKey.some((p) => key(p) === key(c))
      ),
  );
  // SQL Server : un seul NULL admis par UNIQUE, sauf index filtré « IS NOT NULL » (NULL distincts) (O-41).
  return unique.nullsDistinct
    ? "distinct"
    : unique.nullsNotDistinct || (dialect === "sqlserver" && nullable && !unique.where && !unique.expression)
      ? "not distinct"
      : dialect === "oracle" && unique.columns.length > 1 && nullable && !unique.expression
        ? "oracle"
        : undefined;
}

function tableIndexes(table: ParsedTable, node: Node, members: Members) {
  for (const index of table.indexes) {
    const list = members(index.columns);
    if (list) {
      node.indexes = [
        ...(node.indexes ?? []),
        {
          name: index.name,
          members: list,
          ...keyOptions(index),
          ...(index.kind ? { kind: index.kind } : {}),
          ...(index.include && members(index.include) ? { include: members(index.include)! } : {}),
        },
      ];
    }
  }
}

/** CHECK : sur une seule rubrique → son domaine ; sinon contrainte de la table. */
function tableChecks(b: Build, table: ParsedTable, node: Node) {
  const { dialect } = b;
  const checks: { check: NamedExpression; column?: string }[] = [
    ...table.columns.filter((c) => c.check).map((c) => ({ check: c.check!, column: c.name })),
    ...table.checks.map((check) => ({ check })),
  ];
  for (const { check, column } of checks) {
    const annotation: CheckConstraint = {
      name: check.name,
      expression: check.expression,
      dialect,
      ...(check.state ? { state: check.state } : {}),
    };
    const cited = column
      ? [column]
      : referencedColumns(check.expression).filter((c) => table.columns.some((col) => key(col.name) === key(c)));
    const attribute = cited.length === 1 ? b.attributeOf.get(table)?.get(key(cited[0]!)) : undefined;
    if (attribute && !attribute.check) {
      attribute.check = annotation;
    } else {
      node.checks ??= [];
      node.checks.push(annotation);
    }
  }
}

/** Séquences qu'aucune colonne n'utilise : non rattachées, signalées (O-39). */
export function warnUnusedSequences(b: Build) {
  const { schema } = b;
  const used = new Set(
    schema.tables.flatMap((t) => t.columns.map((c) => c.sequence && key(c.sequence.name)).filter(Boolean)),
  );
  for (const sequence of schema.sequences.values()) {
    if (!(used.has(key(sequence.name)) || sequence.ownedBy)) {
      b.warnings.push(MSG.reverseUnusedSequence(sequence.name));
    }
  }
}

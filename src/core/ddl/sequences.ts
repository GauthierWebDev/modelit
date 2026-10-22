import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { SequenceDefinition } from "../model/physical";
import { MSG } from "../validation/messages";
import type { Context } from "./context";
import { declareSchema, q, qualifiedName, schemaOf, tableName } from "./naming";
import type { SequenceRules } from "./targets/dialect";

/** Compte les colonnes alimentées par chaque séquence, avant la génération. */
export function countSequenceUsers(ctx: Context, tables: LogicalTable[]) {
  const users = ctx.used.sequenceUsers;
  for (const c of tables.flatMap((t) => t.columns)) {
    if (c.sequence) {
      users.set(c.sequence.name.toLowerCase(), (users.get(c.sequence.name.toLowerCase()) ?? 0) + 1);
    }
  }
}

/**
 * Valeur tirée d'une séquence (O-39) : DEFAULT nextval('s') (PostgreSQL), s.NEXTVAL (Oracle),
 * NEXT VALUE FOR s (SQL Server), NEXTVAL(s) (MariaDB) ; la séquence est créée en tête de script.
 * Un déclencheur d'origine (remplaçait un NULL explicite, ou toute valeur) est signalé.
 */
export function sequenceDefault(ctx: Context, table: LogicalTable, column: LogicalColumn): string | null {
  const rules = ctx.dialect.sequences;
  const sequence = column.sequence!;
  const definition = table.sequences?.find((s) => s.name.toLowerCase() === sequence.name.toLowerCase()) ?? {
    name: sequence.name,
  };
  const name = qualifiedName(ctx, definition.schema, definition.name);
  if (!rules) {
    const required = column.notNull || table.primaryKey.includes(column.name);
    ctx.report.add("default", table.name, MSG.lossSequence(sequence.name), column.name, required ? "P0" : undefined);
    return null;
  }
  declareSequence(ctx, rules, definition, table);
  // PostgreSQL : la séquence appartient à la colonne qu'elle seule alimente (supprimée avec elle) (O-40).
  // OWNED BY : séquence et table dans le même schéma (exigence de PostgreSQL) (O-42).
  const sameSchema =
    (schemaOf(ctx, definition.schema) ?? "").toLowerCase() === (schemaOf(ctx, table.schema) ?? "").toLowerCase();
  if (rules.ownedBy && sameSchema && ctx.used.sequenceUsers.get(sequence.name.toLowerCase()) === 1) {
    ctx.script.epilogue.push(
      `ALTER SEQUENCE ${name} OWNED BY ${tableName(ctx, table)}.${q(ctx, column.name, column.caseSensitive)};`,
    );
  }
  if (sequence.trigger) {
    ctx.report.add("default", table.name, MSG.lossSequenceTrigger(sequence.trigger), column.name);
  }
  return `DEFAULT ${rules.next(name)}`;
}

/** CREATE SEQUENCE en tête de script, une fois par séquence. */
function declareSequence(ctx: Context, rules: SequenceRules, s: SequenceDefinition, table: LogicalTable) {
  if (ctx.used.sequences.has(s.name.toLowerCase())) {
    return;
  }
  ctx.used.sequences.add(s.name.toLowerCase());
  const parts = [`CREATE SEQUENCE ${qualifiedName(ctx, s.schema, s.name)}`];
  declareSchema(ctx, s.schema, table);
  if (s.type) {
    parts.push(...sequenceType(ctx, rules, s.type, table));
  }
  parts.push(...sequenceOptions(rules, s));
  ctx.script.preamble.push(`${parts.join(" ")};`);
}

/** Type des valeurs (AS INT), là où la cible l'exprime ; ailleurs, type par défaut (signalé) (O-41). */
function sequenceType(ctx: Context, rules: SequenceRules, valueType: string, table: LogicalTable): string[] {
  const type = { int: "INTEGER", integer: "INTEGER", bigint: "BIGINT", smallint: "SMALLINT", tinyint: "TINYINT" }[
    valueType
  ];
  const emitted = type && rules.valueType(type);
  if (emitted) {
    return [`AS ${emitted}`];
  }
  ctx.report.add("default", table.name, MSG.lossSequenceType(valueType.toUpperCase()));
  return [];
}

function sequenceOptions(rules: SequenceRules, s: SequenceDefinition): string[] {
  const parts: string[] = [];
  if (s.start !== undefined) {
    parts.push(`START WITH ${s.start}`);
  }
  if (s.increment !== undefined) {
    parts.push(`INCREMENT BY ${s.increment}`);
  }
  if (s.min !== undefined) {
    parts.push(`MINVALUE ${s.min}`);
  }
  if (s.max !== undefined) {
    parts.push(`MAXVALUE ${s.max}`);
  }
  if (s.cache !== undefined) {
    parts.push(s.cache <= 1 && rules.noCache ? rules.noCache : `CACHE ${Math.max(1, s.cache)}`);
  }
  if (s.cycle !== undefined) {
    parts.push(s.cycle ? "CYCLE" : rules.noCycle);
  }
  return parts;
}

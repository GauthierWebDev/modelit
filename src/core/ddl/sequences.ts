import type { Dbms } from "../dbms/dbms";
import { isAtLeast } from "../dbms/versions";
import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { SequenceDefinition } from "../model/physical";
import { MSG } from "../validation/messages";
import type { Context } from "./context";
import { declareSchema, q, qualifiedName, schemaOf, tableName } from "./naming";

/** Compte les colonnes alimentées par chaque séquence, avant la génération. */
export function countSequenceUsers(ctx: Context, tables: LogicalTable[]) {
  const users = ctx.used.sequenceUsers;
  for (const c of tables.flatMap((t) => t.columns)) {
    if (c.sequence) users.set(c.sequence.name.toLowerCase(), (users.get(c.sequence.name.toLowerCase()) ?? 0) + 1);
  }
}

/**
 * Valeur tirée d'une séquence (O-39) : DEFAULT nextval('s') (PostgreSQL), s.NEXTVAL (Oracle),
 * NEXT VALUE FOR s (SQL Server), NEXTVAL(s) (MariaDB) ; la séquence est créée en tête de script.
 * Un déclencheur d'origine (remplaçait un NULL explicite, ou toute valeur) est signalé.
 */
export function sequenceDefault(ctx: Context, table: LogicalTable, column: LogicalColumn): string | null {
  const { dbms, version } = ctx.target;
  const sequence = column.sequence!;
  const definition = table.sequences?.find((s) => s.name.toLowerCase() === sequence.name.toLowerCase()) ?? { name: sequence.name };
  const name = qualifiedName(ctx, definition.schema, definition.name);
  const syntax: Partial<Record<Dbms, string>> = {
    postgresql: `nextval('${name.replaceAll("'", "''")}')`,
    oracle: isAtLeast("oracle", version, "12c") ? `${name}.NEXTVAL` : undefined,
    sqlserver: isAtLeast("sqlserver", version, "2012") ? `NEXT VALUE FOR ${name}` : undefined,
    mariadb: isAtLeast("mariadb", version, "10.3") ? `NEXTVAL(${name})` : undefined,
  };
  const expression = syntax[dbms];
  if (!expression) {
    const required = column.notNull || table.primaryKey.includes(column.name);
    ctx.report.add("default", table.name, MSG.lossSequence(sequence.name), column.name, required ? "P0" : undefined);
    return null;
  }
  declareSequence(ctx, definition, table);
  // PostgreSQL : la séquence appartient à la colonne qu'elle seule alimente (supprimée avec elle) (O-40).
  // OWNED BY : séquence et table dans le même schéma (exigence de PostgreSQL) (O-42).
  const sameSchema = (schemaOf(ctx, definition.schema) ?? "").toLowerCase() === (schemaOf(ctx, table.schema) ?? "").toLowerCase();
  if (dbms === "postgresql" && sameSchema && ctx.used.sequenceUsers.get(sequence.name.toLowerCase()) === 1) {
    ctx.script.epilogue.push(`ALTER SEQUENCE ${name} OWNED BY ${tableName(ctx, table)}.${q(ctx, column.name, column.caseSensitive)};`);
  }
  if (sequence.trigger) ctx.report.add("default", table.name, MSG.lossSequenceTrigger(sequence.trigger), column.name);
  return `DEFAULT ${expression}`;
}

/** CREATE SEQUENCE en tête de script, une fois par séquence. */
function declareSequence(ctx: Context, s: SequenceDefinition, table: LogicalTable) {
  if (ctx.used.sequences.has(s.name.toLowerCase())) return;
  ctx.used.sequences.add(s.name.toLowerCase());
  const { dbms } = ctx.target;
  const oracle = dbms === "oracle";
  const parts = [`CREATE SEQUENCE ${qualifiedName(ctx, s.schema, s.name)}`];
  declareSchema(ctx, s.schema, table);
  // Type des valeurs (AS INT) : PostgreSQL et SQL Server ; ailleurs, type par défaut (signalé) (O-41).
  if (s.type) {
    const type = { int: "INTEGER", integer: "INTEGER", bigint: "BIGINT", smallint: "SMALLINT", tinyint: "TINYINT" }[s.type];
    if (type && dbms === "postgresql" && type !== "TINYINT") parts.push(`AS ${type}`);
    else if (type && dbms === "sqlserver") parts.push(`AS ${type === "INTEGER" ? "INT" : type}`);
    else ctx.report.add("default", table.name, MSG.lossSequenceType(s.type.toUpperCase()));
  }
  if (s.start !== undefined) parts.push(`START WITH ${s.start}`);
  if (s.increment !== undefined) parts.push(`INCREMENT BY ${s.increment}`);
  if (s.min !== undefined) parts.push(`MINVALUE ${s.min}`);
  if (s.max !== undefined) parts.push(`MAXVALUE ${s.max}`);
  if (s.cache !== undefined) parts.push(oracle && s.cache <= 1 ? "NOCACHE" : dbms === "sqlserver" && s.cache <= 1 ? "NO CACHE" : `CACHE ${Math.max(1, s.cache)}`);
  if (s.cycle !== undefined) parts.push(s.cycle ? "CYCLE" : oracle ? "NOCYCLE" : "NO CYCLE");
  ctx.script.preamble.push(`${parts.join(" ")};`);
}

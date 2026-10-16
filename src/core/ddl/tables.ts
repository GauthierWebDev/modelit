import type { LogicalForeignKey, LogicalTable } from "../mld/logical";
import { MSG } from "../validation/messages";
import { check } from "./checks";
import { columnLine } from "./columns";
import { foreignKey, foreignKeyLabel, place, placement, stateClause, uniqueLine, type CascadeGraph } from "./constraints";
import { INDENT, sqlString, type Context } from "./context";
import { sameDialect } from "./dialects";
import { columnRef, constraintName, declareSchema, q, tableName } from "./naming";

/** CREATE TABLE, suivi des contraintes émises en commentaire (désactivées, non traduites). */
export function createTable(ctx: Context, tables: LogicalTable[], table: LogicalTable, deferred: Set<LogicalForeignKey>, graph: CascadeGraph | null): string {
  const after: string[] = [];
  const { dbms } = ctx.target;
  const mysql = dbms === "mysql" || dbms === "mariadb";
  const sqlitePk =
    dbms === "sqlite" && table.primaryKey.length === 1 && table.columns.find((c) => c.name === table.primaryKey[0])?.type?.kind === "counter" && !table.primaryKeyName;
  const lines = table.columns.map((c) => columnLine(ctx, table, c, Boolean(sqlitePk && c.name === table.primaryKey[0]), after));
  if (table.primaryKey.length > 0 && !sqlitePk) {
    const name = constraintName(ctx, table, table.primaryKeyName, "PK", []);
    const label = table.primaryKeyName ?? "PRIMARY KEY";
    const where = placement(ctx, table, "primary", label, table.primaryKeyState);
    const columns = table.primaryKey.map((c) => columnRef(ctx, table, c)).join(", ");
    const definition = `${name ? `CONSTRAINT ${q(ctx, name)} ` : ""}PRIMARY KEY(${columns})${stateClause(ctx, table, "primary", label, table.primaryKeyState)}`;
    const line = place(ctx, table, definition, where, after, table.primaryKeyState, () => constraintName(ctx, table, undefined, "PK", [], true)!);
    if (line) lines.push(line);
  }
  for (const unique of table.uniques) {
    const line = uniqueLine(ctx, table, unique, after);
    if (line) lines.push(line);
  }
  table.checks.forEach((c, i) => {
    const expression = check(ctx, table, c);
    if (expression === null) {
      after.push(`-- ${MSG.untranslatedCheck(table.name, c.expression)}`);
      return;
    }
    const label = c.name ?? `CHECK (${c.expression})`;
    const where = placement(ctx, table, "check", label, c.state);
    const name = constraintName(ctx, table, c.name, "CK", [String(i + 1)], where === "after");
    const definition = `${name ? `CONSTRAINT ${q(ctx, name)} ` : ""}CHECK (${expression})${stateClause(ctx, table, "check", label, c.state)}`;
    const line = place(ctx, table, definition, where, after, c.state, () => name!);
    if (line) lines.push(line);
  });
  for (const fk of table.foreignKeys) {
    if (deferred.has(fk)) continue;
    const where = placement(ctx, table, "foreign", foreignKeyLabel(fk), fk.state);
    const definition = foreignKey(ctx, tables, table, fk, graph);
    const line = place(ctx, table, definition, where, after, fk.state, () => constraintName(ctx, table, undefined, "FK", [fk.referencedTable], true)!);
    if (line) lines.push(line);
  }
  // Partitionnement : abandonné, signalé (O-39).
  if (table.partition) ctx.report.add("physical", table.name, MSG.lossPartition(dbms === "postgresql"));
  const options = (ctx.script.tableOptions.get(table) ?? "") + (mysql && table.comment ? ` COMMENT=${sqlString(table.comment)}` : "");
  declareSchema(ctx, table.schema, table);
  const statement = `CREATE TABLE ${tableName(ctx, table)}(\n${lines.map((l) => INDENT + l).join(",\n")}\n)${options};`;
  comments(ctx, table);
  triggers(ctx, table);
  return [statement, ...after].join("\n");
}

/** Commentaires : COMMENT ON (PostgreSQL, Oracle, DB2) ; MySQL les porte en ligne ; ailleurs signalés. */
function comments(ctx: Context, table: LogicalTable) {
  const { dbms } = ctx.target;
  const name = tableName(ctx, table);
  const commented = table.columns.filter((c) => c.comment);
  if (!table.comment && !commented.length) return;
  if (dbms === "mysql" || dbms === "mariadb") return;
  if (dbms === "postgresql" || dbms === "oracle" || dbms === "db2") {
    if (table.comment) ctx.script.epilogue.push(`COMMENT ON TABLE ${name} IS ${sqlString(table.comment)};`);
    for (const c of commented) ctx.script.epilogue.push(`COMMENT ON COLUMN ${name}.${q(ctx, c.name, c.caseSensitive)} IS ${sqlString(c.comment!)};`);
    return;
  }
  ctx.report.add("comment", table.name, MSG.lossComments(Number(Boolean(table.comment)) + commented.length));
}

/** Déclencheurs : réémis vers le même dialecte, signalés sinon (leur code est propre au SGBD). */
function triggers(ctx: Context, table: LogicalTable) {
  const { dbms } = ctx.target;
  for (const trigger of table.triggers ?? []) {
    if (sameDialect(trigger.dialect, dbms) && (dbms === "mysql" || dbms === "mariadb")) {
      ctx.script.epilogue.push(`DELIMITER $$\n${trigger.sql.trim().replace(/;?\s*$/, "")}$$\nDELIMITER ;`);
    } else if (sameDialect(trigger.dialect, dbms)) {
      ctx.script.epilogue.push(`${trigger.sql.trim().replace(/;?\s*$/, "")};`);
    } else {
      ctx.report.add("trigger", table.name, MSG.lossTrigger(trigger.name));
    }
  }
}

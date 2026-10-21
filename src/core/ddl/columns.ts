import type { LogicalColumn, LogicalTable } from "../mld/logical";
import { MSG } from "../validation/messages";
import { check } from "./checks";
import { place, placement, singleNullLoss, stateClause } from "./constraints";
import { type Context, sqlString } from "./context";
import { sameDialect } from "./dialects";
import { parseDefault, renderOperand } from "./expressions";
import { translateGenerated } from "./generatedExpression";
import { columnRef, constraintName, q } from "./naming";
import { sequenceDefault } from "./sequences";
import { typeOf } from "./types";

/** Définition d'une colonne dans le CREATE TABLE. */
export function columnLine(
  ctx: Context,
  table: LogicalTable,
  c: LogicalColumn,
  inlinePk: boolean,
  after: string[],
): string {
  const { dbms } = ctx.target;
  const d = ctx.dialect;
  const parts = [q(ctx, c.name, c.caseSensitive)];
  const generated = c.generated ? generatedClause(ctx, table, c) : null;
  const { sql: type, checks } = typeOf(ctx, table, c, inlinePk);
  if (generated && !d.generated!.typed) {
    // Colonne calculée sans type déclaré (déduit de l'expression).
    if (type) {
      ctx.report.add("generated", table.name, MSG.lossGeneratedType(type), c.name);
    }
    parts.push(generated);
    return parts.join(" ");
  }
  if (type) {
    parts.push(type);
  }
  if (inlinePk) {
    parts.push("PRIMARY KEY AUTOINCREMENT");
  }
  if (generated) {
    parts.push(generated);
  } else {
    const defaultValue = defaultClause(ctx, table, c, type);
    if (defaultValue) {
      parts.push(defaultValue);
    }
  }
  if (c.onUpdate) {
    if (d.columns.onUpdate) {
      parts.push(`ON UPDATE ${c.onUpdate.expression}`);
    } else {
      ctx.report.add("onUpdate", table.name, MSG.lossOnUpdate(c.onUpdate.expression), c.name);
    }
  }
  const nullablePk = d.columns.primaryKeyNotNull && !inlinePk && table.primaryKey.includes(c.name);
  if (c.notNull || nullablePk) {
    parts.push("NOT NULL");
  }
  if (c.unique && !table.uniques.some((u) => u.columns.length === 1 && u.columns[0] === c.name)) {
    parts.push("UNIQUE");
    singleNullLoss(ctx, table, [c.name], `(${c.name})`);
  }
  // YEAR (MySQL) : 1901 à 2155 ; contrainte fusionnée avec le CHECK de la colonne s'il y en a un (O-38).
  const yearRange =
    c.sourceType && /^year\b/i.test(c.sourceType.sql) && !sameDialect(c.sourceType.dialect, dbms) && d.types.yearRange
      ? `${columnRef(ctx, table, c.name)} BETWEEN 1901 AND 2155`
      : null;
  let merged = false;
  if (c.check) {
    const expression = check(ctx, table, c.check, c.name);
    const label = c.check.name ?? `CHECK (${c.check.expression})`;
    const where = placement(ctx, table, "check", label, c.check.state);
    const name = c.check.name ? `CONSTRAINT ${q(ctx, constraintName(ctx, table, c.check.name, "CK", [c.name])!)} ` : "";
    if (expression === null) {
      after.push(`-- ${MSG.untranslatedCheck(`${table.name}.${c.name}`, c.check.expression)}`);
    } else {
      const active = where === "inline";
      const definition = `${name}CHECK (${yearRange && active ? `(${expression}) AND ${yearRange}` : expression})${stateClause(ctx, table, "check", label, c.check.state)}`;
      const line = place(
        ctx,
        table,
        definition,
        where,
        after,
        c.check.state,
        () => constraintName(ctx, table, undefined, "CK", [c.name], true)!,
      );
      if (line) {
        parts.push(line);
      }
      merged = Boolean(yearRange) && active;
    }
  }
  if (yearRange && !merged) {
    checks.push(yearRange);
  }
  for (const condition of checks) {
    parts.push(`CHECK (${condition})`);
  }
  // NOT FOR REPLICATION, ROWGUIDCOL (SQL Server) : réémis vers SQL Server, abandonnés ailleurs (O-42).
  for (const option of c.sqlServerOptions ?? []) {
    if (sameDialect("sqlserver", dbms)) {
      parts.splice(option === "ROWGUIDCOL" ? 2 : parts.length, 0, option);
    } else {
      ctx.report.add("physical", table.name, MSG.lossSqlServerOption(option), c.name);
    }
  }
  if (c.comment && d.comments === "inline") {
    parts.push(`COMMENT ${sqlString(c.comment)}`);
  }
  if (c.complement?.trim()) {
    parts.push(c.complement.trim());
  }
  return parts.join(" ");
}

function defaultClause(ctx: Context, table: LogicalTable, column: LogicalColumn, type: string | null): string | null {
  if (column.sequence) {
    return sequenceDefault(ctx, table, column);
  }
  const value = column.defaultValue;
  if (!value) {
    return null;
  }
  if (sameDialect(value.dialect, ctx.target.dbms)) {
    return `DEFAULT ${value.expression}`;
  }
  const parsed = parseDefault(value.expression);
  let rendered = parsed && renderOperand(parsed, ctx.target);
  // SYSDATE dans une colonne devenue DATE (option) : date du jour (O-39).
  if (
    parsed?.kind === "date" &&
    (parsed.fn === "localtimestamp" || parsed.fn === "localtimestamp_seconds") &&
    /^DATE\b/i.test(type ?? "")
  ) {
    rendered = renderOperand({ kind: "date", fn: "current_date" }, ctx.target);
  }
  // SYS_GUID() (Oracle), NEWSEQUENTIALID() (SQL Server, croissant) → UUID aléatoire : approximation (O-39, O-41).
  // NEWSEQUENTIALID() → uuidv7() (croissant) à partir de PostgreSQL 18 : rien de perdu (O-42).
  const uuidSource = /^\(*\s*(sys_guid|newsequentialid)\s*\(/i.exec(value.expression)?.[1];
  if (
    parsed?.kind === "function" &&
    parsed.fn.startsWith("uuid") &&
    uuidSource &&
    rendered &&
    !/^\(*\s*(sys_guid|newsequentialid|uuidv7)/i.test(rendered)
  ) {
    ctx.report.add("default", table.name, MSG.lossUuidDefault(`${uuidSource.toUpperCase()}()`, rendered), column.name);
  }
  // Booléen (TINYINT(1) MySQL) : 0 / 1 → FALSE / TRUE (O-35).
  if (parsed?.kind === "number" && column.type?.kind === "boolean" && (parsed.value === "0" || parsed.value === "1")) {
    rendered = renderOperand({ kind: "boolean", value: parsed.value === "1" }, ctx.target);
  }
  // SET en tableau PostgreSQL : 'a,b' → ARRAY['a', 'b']::text[].
  if (parsed?.kind === "string" && column.domain?.kind === "set" && type?.startsWith("TEXT[]")) {
    rendered = `ARRAY[${parsed.value.split(",").filter(Boolean).map(sqlString).join(", ")}]::text[]`;
  }
  // Défaut que le type de la colonne n'admet pas tel quel (MySQL : TEXT, BLOB…).
  if (rendered && ctx.dialect.columns.defaultFor) {
    rendered = ctx.dialect.columns.defaultFor(rendered, type ?? "");
  }
  if (rendered) {
    return `DEFAULT ${rendered}`;
  }
  // Colonne NOT NULL : un INSERT sans valeur échouera — entrée P0 explicite (O-42).
  const required = column.notNull || table.primaryKey.includes(column.name);
  const message = required ? MSG.lossDefaultNotNull(value.expression) : MSG.lossDefault(value.expression);
  ctx.report.add("default", table.name, message, column.name, required ? "P0" : undefined);
  return null;
}

/** Colonne calculée : clause pour la cible, ou `null` (colonne ordinaire, perte signalée). */
function generatedClause(ctx: Context, table: LogicalTable, column: LogicalColumn): string | null {
  const generated = column.generated!;
  const rules = ctx.dialect.generated;
  const { dbms } = ctx.target;
  const expression = sameDialect(generated.dialect, dbms)
    ? generated.expression
    : translateGenerated(generated.expression, generated.dialect, {
        target: ctx.target,
        columnType: (name) => table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())?.type,
        caseSensitive: (name) => Boolean(table.columns.find((c) => c.name === name)?.caseSensitive),
      });
  if (expression === null || !rules) {
    ctx.report.add("generated", table.name, MSG.lossGenerated(generated.expression), column.name);
    return null;
  }
  let { stored } = generated;
  if (!(stored || rules.virtual)) {
    stored = true;
    ctx.report.add("generated", table.name, MSG.lossGeneratedMode("VIRTUAL", "STORED"), column.name);
  } else if (stored && !rules.stored) {
    stored = false;
    ctx.report.add("generated", table.name, MSG.lossGeneratedMode("STORED", "VIRTUAL"), column.name);
  }
  return rules.clause(expression, stored);
}

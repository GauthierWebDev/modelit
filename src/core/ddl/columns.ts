import type { LogicalColumn, LogicalTable } from "../mld/logical";
import { MSG } from "../validation/messages";
import { check } from "./checks";
import { place, placement, singleNullLoss, stateClause } from "./constraints";
import { type Context, sqlString } from "./context";
import { sameDialect } from "./dialects";
import { type Operand, parseDefault, renderOperand } from "./expressions";
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
  valueParts(ctx, table, c, { type, generated, inlinePk }, parts);
  // YEAR (MySQL) : 1901 à 2155 ; contrainte fusionnée avec le CHECK de la colonne s'il y en a un (O-38).
  const yearRange = yearRangeOf(ctx, table, c);
  const merged = c.check ? columnCheck(ctx, table, c, yearRange, after, parts) : false;
  if (yearRange && !merged) {
    checks.push(yearRange);
  }
  for (const condition of checks) {
    parts.push(`CHECK (${condition})`);
  }
  sqlServerOptions(ctx, table, c, parts);
  if (c.comment && d.comments === "inline") {
    parts.push(`COMMENT ${sqlString(c.comment)}`);
  }
  if (c.complement?.trim()) {
    parts.push(c.complement.trim());
  }
  return parts.join(" ");
}

/** Type, clé primaire en ligne, expression ou défaut, ON UPDATE, NOT NULL, UNIQUE. */
function valueParts(
  ctx: Context,
  table: LogicalTable,
  c: LogicalColumn,
  column: { type: string | null; generated: string | null; inlinePk: boolean },
  parts: string[],
) {
  const { type, generated, inlinePk } = column;
  if (type) {
    parts.push(type);
  }
  if (inlinePk) {
    parts.push("PRIMARY KEY AUTOINCREMENT");
  }
  const value = generated || defaultClause(ctx, table, c, type);
  if (value) {
    parts.push(value);
  }
  onUpdate(ctx, table, c, parts);
  const nullablePk = ctx.dialect.columns.primaryKeyNotNull && !inlinePk && table.primaryKey.includes(c.name);
  if (c.notNull || nullablePk) {
    parts.push("NOT NULL");
  }
  if (c.unique && !table.uniques.some((u) => u.columns.length === 1 && u.columns[0] === c.name)) {
    parts.push("UNIQUE");
    singleNullLoss(ctx, table, [c.name], `(${c.name})`);
  }
}

function onUpdate(ctx: Context, table: LogicalTable, c: LogicalColumn, parts: string[]) {
  if (!c.onUpdate) {
    return;
  }
  if (ctx.dialect.columns.onUpdate) {
    parts.push(`ON UPDATE ${c.onUpdate.expression}`);
  } else {
    ctx.report.add("onUpdate", table.name, MSG.lossOnUpdate(c.onUpdate.expression), c.name);
  }
}

function yearRangeOf(ctx: Context, table: LogicalTable, c: LogicalColumn): string | null {
  return c.sourceType &&
    /^year\b/i.test(c.sourceType.sql) &&
    !sameDialect(c.sourceType.dialect, ctx.target.dbms) &&
    ctx.dialect.types.yearRange
    ? `${columnRef(ctx, table, c.name)} BETWEEN 1901 AND 2155`
    : null;
}

/** CHECK de la colonne ; vrai si la plage de YEAR y a été fusionnée. */
function columnCheck(
  ctx: Context,
  table: LogicalTable,
  c: LogicalColumn,
  yearRange: string | null,
  after: string[],
  parts: string[],
): boolean {
  const ck = c.check!;
  const expression = check(ctx, table, ck, c.name);
  const label = ck.name ?? `CHECK (${ck.expression})`;
  const where = placement(ctx, table, "check", label, ck.state);
  const name = ck.name ? `CONSTRAINT ${q(ctx, constraintName(ctx, table, ck.name, "CK", [c.name])!)} ` : "";
  if (expression === null) {
    after.push(`-- ${MSG.untranslatedCheck(`${table.name}.${c.name}`, ck.expression)}`);
    return false;
  }
  const active = where === "inline";
  const definition = `${name}CHECK (${yearRange && active ? `(${expression}) AND ${yearRange}` : expression})${stateClause(ctx, table, "check", label, ck.state)}`;
  const line = place(
    ctx,
    table,
    definition,
    where,
    after,
    ck.state,
    () => constraintName(ctx, table, undefined, "CK", [c.name], true)!,
  );
  if (line) {
    parts.push(line);
  }
  return Boolean(yearRange) && active;
}

/** NOT FOR REPLICATION, ROWGUIDCOL (SQL Server) : réémis vers SQL Server, abandonnés ailleurs (O-42). */
function sqlServerOptions(ctx: Context, table: LogicalTable, c: LogicalColumn, parts: string[]) {
  for (const option of c.sqlServerOptions ?? []) {
    if (sameDialect("sqlserver", ctx.target.dbms)) {
      parts.splice(option === "ROWGUIDCOL" ? 2 : parts.length, 0, option);
    } else {
      ctx.report.add("physical", table.name, MSG.lossSqlServerOption(option), c.name);
    }
  }
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
  const rendered = translatedDefault(ctx, table, column, type, value.expression);
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

/** Défaut d'un autre dialecte, transposé pour la cible ; `null` s'il n'a pas d'équivalent. */
function translatedDefault(
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  type: string | null,
  expression: string,
): string | null {
  const parsed = parseDefault(expression);
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
  if (parsed?.kind === "function" && parsed.fn.startsWith("uuid") && rendered) {
    uuidLoss(ctx, table, column, expression, rendered);
  }
  const literal = parsed ? typedLiteral(ctx, column, type, parsed) : undefined;
  if (literal) {
    rendered = literal.sql;
  }
  // Défaut que le type de la colonne n'admet pas tel quel (MySQL : TEXT, BLOB…).
  if (rendered && ctx.dialect.columns.defaultFor) {
    rendered = ctx.dialect.columns.defaultFor(rendered, type ?? "");
  }
  return rendered ?? null;
}

/** Littéral réécrit selon le type de la colonne (`sql` peut être `null` : sans équivalent) ; `undefined` sinon. */
function typedLiteral(
  ctx: Context,
  column: LogicalColumn,
  type: string | null,
  parsed: Operand,
): { sql: string | null } | undefined {
  // Booléen (TINYINT(1) MySQL) : 0 / 1 → FALSE / TRUE (O-35).
  if (parsed.kind === "number" && column.type?.kind === "boolean" && (parsed.value === "0" || parsed.value === "1")) {
    return { sql: renderOperand({ kind: "boolean", value: parsed.value === "1" }, ctx.target) };
  }
  // SET en tableau PostgreSQL : 'a,b' → ARRAY['a', 'b']::text[].
  if (parsed.kind === "string" && column.domain?.kind === "set" && type?.startsWith("TEXT[]")) {
    return { sql: `ARRAY[${parsed.value.split(",").filter(Boolean).map(sqlString).join(", ")}]::text[]` };
  }
  return undefined;
}

function uuidLoss(ctx: Context, table: LogicalTable, column: LogicalColumn, expression: string, rendered: string) {
  const uuidSource = /^\(*\s*(sys_guid|newsequentialid)\s*\(/i.exec(expression)?.[1];
  if (uuidSource && !/^\(*\s*(sys_guid|newsequentialid|uuidv7)/i.test(rendered)) {
    ctx.report.add("default", table.name, MSG.lossUuidDefault(`${uuidSource.toUpperCase()}()`, rendered), column.name);
  }
}

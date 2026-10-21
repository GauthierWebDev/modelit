import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { SqlDialect } from "../model/physical";
import { MSG } from "../validation/messages";
import { collationClass, translateCollation } from "./collation";
import type { Context } from "./context";
import { sameDialect } from "./dialects";

/** Clause COLLATE pour la cible (vide si sans objet) ; une collation intransposable est signalée. */
export function collationClause(
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  source: SqlDialect | undefined,
): string {
  const name = column.type?.kind === "text" ? (column.type.collation ?? assumedCollation(ctx, column)) : undefined;
  if (!name) {
    return "";
  }
  const result = translateCollation(name, source, ctx.target, ctx.options.collations !== "deterministic");
  if (result.kind === "dropped") {
    ctx.report.add("collation", table.name, MSG.lossCollation(name), column.name);
    return "";
  }
  if (result.preamble && !ctx.script.preamble.includes(result.preamble)) {
    ctx.script.preamble.unshift(result.preamble);
  }
  if (result.approximation) {
    ctx.report.add("collation", table.name, MSG.lossCollationApprox(name, result.approximation), column.name);
  }
  if (
    column.domain &&
    ctx.dialect.types.enumTypes &&
    ctx.options.enums === "type" &&
    column.domain.kind === "enum" &&
    result.sql
  ) {
    ctx.report.add("collation", table.name, MSG.lossCollationEnumType(name), column.name);
  }
  return result.sql ? ` ${result.sql}` : "";
}

/**
 * Collation supposée d'un texte SQL Server sans collation déclarée (celle de la base, absente du
 * script) : CI_AS par défaut (option) ; l'hypothèse est rappelée une fois au rapport (O-42).
 */
function assumedCollation(ctx: Context, column: LogicalColumn): string | undefined {
  const source = column.sourceType;
  if (source?.dialect !== "sqlserver" || sameDialect(source.dialect, ctx.target.dbms)) {
    return undefined;
  }
  if (column.type?.kind !== "text" || column.type.encoding === "binary") {
    return undefined;
  }
  const name = { ci_as: "Latin1_General_CI_AS", ci_ai: "Latin1_General_CI_AI", cs_as: "Latin1_General_CS_AS" }[
    ctx.options.sqlServerCollation
  ];
  if (!ctx.report.has(MSG.lossSqlServerCollation(name))) {
    ctx.report.add("collation", "", MSG.lossSqlServerCollation(name));
  }
  return name;
}

/** Collations insensibles émises comme collations ICU non déterministes (PostgreSQL) ? */
export function icuCollations(ctx: Context): boolean {
  return ctx.dialect.types.nondeterministicCollations && ctx.options.collations !== "deterministic";
}

/** Classe de collation effective d'une colonne (déclarée ou supposée) (O-42). */
export function effectiveCollationClass(ctx: Context, column: LogicalColumn) {
  const name = column.type?.kind === "text" ? (column.type.collation ?? assumedCollation(ctx, column)) : undefined;
  return name ? collationClass(name) : undefined;
}

import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import type { SqlDialect } from "../model/physical";
import { MSG } from "../validation/messages";
import { activeConditions, type Context } from "./context";
import { asciiDomain, excludesEmptyString } from "./expressions";
import { columnRef } from "./naming";

/**
 * Écarts propres au dialecte d'origine d'une colonne, vers un autre dialecte : ce que la source
 * garantissait et que le type émis (`sql`) ne garantit plus. Peut ajouter des CHECK à `checks`.
 */
type SourceRule = (
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  sql: string,
  type: DataType,
  checks: string[],
) => void;

/** TIMESTAMP MySQL : stocké en UTC (comme TIMESTAMPTZ), mais sur la plage 1970–2038. */
const mysql: SourceRule = (ctx, table, column, sql) => {
  if (/^timestamp\b/i.test(column.sourceType!.sql)) {
    ctx.report.add("type", table.name, MSG.lossMysqlTimestamp(sql), column.name);
  }
};

/** SQL Server (O-42) : DATETIMEOFFSET perd son décalage ; DATETIME arrondissait au 1/300 s. */
const sqlserver: SourceRule = (ctx, table, column, sql) => {
  const source = column.sourceType!.sql.trim();
  if (/^datetimeoffset\b/i.test(source)) {
    ctx.report.add("type", table.name, MSG.lossDatetimeOffset(sql), column.name);
  }
  if (/^datetime$/i.test(source)) {
    ctx.report.add("type", table.name, MSG.lossSqlServerDatetime(sql), column.name);
  }
};

/**
 * Texte Oracle (O-39) : longueur en octets (BYTE, ou selon NLS_LENGTH_SEMANTICS), et chaîne vide
 * qui vaut NULL — refusée par NOT NULL (CHECK (col <> '') en option), NULL sinon.
 */
const oracle: SourceRule = (ctx, table, column, _sql, type, checks) => {
  if (type.kind !== "text" || type.encoding === "binary") {
    return;
  }
  const loss = (category: "type" | "domain", message: string) =>
    ctx.report.add(category, table.name, message, column.name);
  const source = column.sourceType!.sql.trim();
  const conditions = activeConditions(table, column);
  // Octets ou caractères : sans objet sur une clé étrangère (découle de la clé référencée) ou quand
  // un CHECK IN n'admet que des valeurs ASCII (un octet par caractère) (O-40).
  const lengthMatters = !column.foreign && !conditions.some((c) => asciiDomain(c, column.name));
  if (lengthMatters && /^(var)?char2?\s*\(\s*\d+\s+byte\s*\)/i.test(source)) {
    loss("type", MSG.lossByteSemantics());
  } else if (lengthMatters && /^(varchar2?|char|character)\s*\(\s*\d+\s*\)$/i.test(source)) {
    loss("type", MSG.lossNlsSemantics());
  }
  const notNull = column.notNull || table.primaryKey.includes(column.name);
  const rejected = conditions.some((c) => excludesEmptyString(c, column.name));
  // Facultative : Oracle acceptait '' (devenue NULL) ; ici, stockée telle quelle, ou rejetée par un CHECK existant.
  if (!notNull) {
    loss("domain", rejected ? MSG.lossEmptyStringRejected() : MSG.lossEmptyStringNull());
  } else if (rejected) {
    return;
  } else if (ctx.options.emptyStrings === "check") {
    checks.push(`${columnRef(ctx, table, column.name)} <> ''`);
  } else {
    loss("domain", MSG.lossEmptyStringNotNull());
  }
};

const RULES: Partial<Record<SqlDialect, SourceRule>> = { mysql, mariadb: mysql, sqlserver, oracle };

/** Applique la règle du dialecte d'origine d'une colonne réécrite vers un autre dialecte. */
export function sourceLosses(
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  sql: string,
  type: DataType,
  checks: string[],
) {
  const dialect = column.sourceType?.dialect;
  if (dialect) {
    RULES[dialect]?.(ctx, table, column, sql, type, checks);
  }
}

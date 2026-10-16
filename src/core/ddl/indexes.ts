import { isAtLeast } from "../dbms/versions";
import type { LogicalKey, LogicalTable } from "../mld/logical";
import { MSG } from "../validation/messages";
import { renderStructured } from "./checks";
import { describeKey, type Context } from "./context";
import { sameDialect } from "./dialects";
import { translateGenerated } from "./generatedExpression";
import { columnRef, constraintName, q, tableName } from "./naming";

/** Index unique sur expression (LOWER(email)) ou conditionnel (… WHERE cond) (O-39). */
export function expressionIndex(ctx: Context, table: LogicalTable, key: LogicalKey): string[] {
  const { dbms } = ctx.target;
  const label = key.name ?? describeKey(key);
  const name = tableName(ctx, table);
  const caseSensitive = (n: string) => Boolean(table.columns.find((c) => c.name === n)?.caseSensitive);
  let items: string | null = keyColumns(ctx, table, key);
  if (key.expression) {
    const { expression, dialect } = key.expression;
    // Index sur expression : PostgreSQL, Oracle, SQLite, DB2, MySQL 8.0.13+ ; pas SQL Server ni MariaDB.
    const supported = ["postgresql", "oracle", "sqlite", "db2"].includes(dbms) || (dbms === "mysql" && ctx.target.version !== "5.7");
    items = !supported
      ? null
      : sameDialect(dialect, dbms)
        ? expression
        : translateGenerated(expression, dialect, {
            target: ctx.target,
            columnType: (n) => table.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.type,
            caseSensitive,
          });
    // Élément d'index : appel de fonction tel quel, autre expression entre parenthèses.
    if (items && !sameDialect(dialect, dbms) && !/^\w+\(.*\)$/s.test(items)) items = /^\(.*\)$/s.test(items) ? items : `(${items})`;
    // MySQL : partie de clé fonctionnelle entre parenthèses.
    if (items && dbms === "mysql" && !sameDialect(dialect, dbms)) items = `(${items})`;
    if (!items) {
      ctx.report.add("index", table.name, MSG.lossUniqueExpression(label));
      return [];
    }
  }
  let condition = "";
  if (key.where) {
    const { expression, dialect } = key.where;
    const rendered = sameDialect(dialect, dbms) ? expression : renderStructured(ctx, table, expression, dialect);
    if (!rendered || !["postgresql", "sqlite", "sqlserver", "oracle"].includes(dbms) || (dbms === "oracle" && key.expression)) {
      ctx.report.add("index", table.name, MSG.lossUniqueWhere(label));
      return [];
    }
    // Oracle : pas d'index partiel — motif CASE WHEN cond THEN col END (les clés NULL ne sont pas indexées).
    if (dbms === "oracle") items = key.columns.map((c) => `CASE WHEN ${rendered} THEN ${columnRef(ctx, table, c)} END`).join(", ");
    else condition = ` WHERE ${rendered}`;
  }
  const index = q(ctx, constraintName(ctx, table, key.name, "AK", key.columns, true)!);
  return [`CREATE UNIQUE INDEX ${index} ON ${name}(${items})${include(ctx, table, key)}${condition};`];
}

/** Colonnes d'une clé, avec leurs préfixes MySQL `col(n)`. */
export function keyColumns(ctx: Context, table: LogicalTable, key: LogicalKey): string {
  return key.columns.map((c, i) => `${columnRef(ctx, table, c)}${key.prefixes?.[i] ? `(${key.prefixes[i]})` : ""}`).join(", ");
}

/**
 * CREATE [UNIQUE] INDEX pour la cible : préfixes en index sur expression, plein texte (GIN en
 * PostgreSQL), méthode d'index ; ce qui n'a pas d'équivalent est signalé, rien n'est élargi (O-35).
 */
export function keyIndex(ctx: Context, table: LogicalTable, index: LogicalKey, unique: boolean): string[] {
  const { dbms } = ctx.target;
  const mysql = dbms === "mysql" || dbms === "mariadb";
  const label = describeKey(index);
  const on = tableName(ctx, table);
  const name = q(ctx, constraintName(ctx, table, index.name, unique ? "AK" : "IX", index.columns, true)!);
  if (index.kind) {
    if (mysql) return [`CREATE ${index.kind.toUpperCase()} INDEX ${name} ON ${on}(${keyColumns(ctx, table, index)});`];
    if (dbms === "postgresql" && index.kind === "fulltext") {
      const text = index.columns.map((c) => `coalesce(${columnRef(ctx, table, c)}, '')`).join(" || ' ' || ");
      ctx.report.add("index", table.name, MSG.lossFulltextGin(index.name ?? label));
      return [`CREATE INDEX ${name} ON ${on} USING GIN (to_tsvector('simple', ${index.columns.length === 1 ? columnRef(ctx, table, index.columns[0]!) : text}));`];
    }
    ctx.report.add("index", table.name, MSG.lossIndexKind(index.name ?? label, index.kind.toUpperCase()));
    return [];
  }
  let items = keyColumns(ctx, table, index);
  if (index.prefixes && !mysql) {
    const prefix = (column: string, n: number) => {
      const ref = columnRef(ctx, table, column);
      switch (dbms) {
        case "postgresql":
          return `left(${ref}, ${n})`;
        case "sqlite":
        case "oracle":
          return `substr(${ref}, 1, ${n})`;
        default:
          return null;
      }
    };
    const parts = index.columns.map((c, i) => (index.prefixes![i] ? prefix(c, index.prefixes![i]!) : columnRef(ctx, table, c)));
    if (parts.some((p) => p === null)) {
      // Jamais élargi en UNIQUE / index sur la colonne entière : abandonné, et signalé.
      ctx.report.add("index", table.name, MSG.lossPrefixKey(index.name ?? label, unique));
      return [];
    }
    items = parts.join(", ");
  }
  let method = "";
  if (index.method && index.method !== "btree") {
    if (mysql) method = ` USING ${index.method.toUpperCase()}`;
    else if (dbms === "postgresql" && !unique && ["hash", "gin", "gist", "brin", "spgist"].includes(index.method)) method = ` USING ${index.method.toUpperCase()}`;
    else if (!unique) ctx.report.add("index", table.name, MSG.lossIndexMethod(index.name ?? label, index.method.toUpperCase()));
  }
  const using = dbms === "postgresql" ? method : "";
  const trailing = mysql ? method : "";
  return [`CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON ${on}${using}(${items})${include(ctx, table, index)}${trailing};`];
}

/** INCLUDE (colonnes couvertes) : SQL Server, PostgreSQL 11+ ; ailleurs signalé (O-42). */
export function include(ctx: Context, table: LogicalTable, key: LogicalKey): string {
  if (!key.include?.length) return "";
  const { dbms, version } = ctx.target;
  if (dbms === "sqlserver" || (dbms === "postgresql" && isAtLeast("postgresql", version, "11"))) {
    return ` INCLUDE (${key.include.map((c) => columnRef(ctx, table, c)).join(", ")})`;
  }
  ctx.report.add("index", table.name, MSG.lossInclude(key.name ?? describeKey(key)));
  return "";
}

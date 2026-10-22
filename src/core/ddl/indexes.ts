import type { LogicalKey, LogicalTable } from "../mld/logical";
import { MSG } from "../validation/messages";
import { renderStructured } from "./checks";
import { type Context, describeKey } from "./context";
import { sameDialect } from "./dialects";
import { translateGenerated } from "./generatedExpression";
import { columnRef, constraintName, q, tableName } from "./naming";

/** Index unique sur expression (LOWER(email)) ou conditionnel (… WHERE cond) (O-39). */
export function expressionIndex(ctx: Context, table: LogicalTable, key: LogicalKey): string[] {
  const label = key.name ?? describeKey(key);
  const name = tableName(ctx, table);
  let items: string | null = keyColumns(ctx, table, key);
  if (key.expression) {
    items = indexExpression(ctx, table, key.expression);
    if (!items) {
      ctx.report.add("index", table.name, MSG.lossUniqueExpression(label));
      return [];
    }
  }
  let condition = "";
  if (key.where) {
    const partial = partialIndex(ctx, table, key, key.where);
    if (!partial) {
      ctx.report.add("index", table.name, MSG.lossUniqueWhere(label));
      return [];
    }
    items = partial.items ?? items;
    ({ condition } = partial);
  }
  const index = q(ctx, constraintName(ctx, table, key.name, "AK", key.columns, true)!);
  return [`CREATE UNIQUE INDEX ${index} ON ${name}(${items})${include(ctx, table, key)}${condition};`];
}

/** Expression de l'index pour la cible, ou `null` (non traduisible). */
function indexExpression(
  ctx: Context,
  table: LogicalTable,
  source: NonNullable<LogicalKey["expression"]>,
): string | null {
  const { dbms } = ctx.target;
  const rules = ctx.dialect.indexes;
  const { expression, dialect } = source;
  const caseSensitive = (n: string) => Boolean(table.columns.find((c) => c.name === n)?.caseSensitive);
  let items = rules.expressions
    ? sameDialect(dialect, dbms)
      ? expression
      : translateGenerated(expression, dialect, {
          target: ctx.target,
          columnType: (n) => table.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.type,
          caseSensitive,
        })
    : null;
  // Élément d'index : appel de fonction tel quel, autre expression entre parenthèses.
  if (items && !sameDialect(dialect, dbms) && !/^\w+\(.*\)$/s.test(items)) {
    items = /^\(.*\)$/s.test(items) ? items : `(${items})`;
  }
  if (items && rules.parenthesizedExpressions && !sameDialect(dialect, dbms)) {
    items = `(${items})`;
  }
  return items;
}

/**
 * Condition d'un index partiel : WHERE, ou motif CASE WHEN cond THEN col END (les clés NULL ne sont
 * pas indexées) qui remplace les éléments ; `null` si la cible ne sait pas l'exprimer.
 */
function partialIndex(
  ctx: Context,
  table: LogicalTable,
  key: LogicalKey,
  where: NonNullable<LogicalKey["where"]>,
): { items?: string; condition: string } | null {
  const rules = ctx.dialect.indexes;
  const { expression, dialect } = where;
  const rendered = sameDialect(dialect, ctx.target.dbms)
    ? expression
    : renderStructured(ctx, table, expression, dialect);
  if (!(rendered && rules.partial) || (rules.partial === "case" && key.expression)) {
    return null;
  }
  if (rules.partial === "case") {
    return {
      items: key.columns.map((c) => `CASE WHEN ${rendered} THEN ${columnRef(ctx, table, c)} END`).join(", "),
      condition: "",
    };
  }
  return { condition: ` WHERE ${rendered}` };
}

/** Colonnes d'une clé, avec leurs préfixes MySQL `col(n)`. */
export function keyColumns(ctx: Context, table: LogicalTable, key: LogicalKey): string {
  return key.columns
    .map((c, i) => `${columnRef(ctx, table, c)}${key.prefixes?.[i] ? `(${key.prefixes[i]})` : ""}`)
    .join(", ");
}

/**
 * CREATE [UNIQUE] INDEX pour la cible : préfixes en index sur expression, plein texte (GIN en
 * PostgreSQL), méthode d'index ; ce qui n'a pas d'équivalent est signalé, rien n'est élargi (O-35).
 */
export function keyIndex(ctx: Context, table: LogicalTable, index: LogicalKey, unique: boolean): string[] {
  const rules = ctx.dialect.indexes;
  const label = describeKey(index);
  const on = tableName(ctx, table);
  const name = q(ctx, constraintName(ctx, table, index.name, unique ? "AK" : "IX", index.columns, true)!);
  if (index.kind) {
    return kindIndex(ctx, table, index, name, label);
  }
  const items = prefixedItems(ctx, table, index);
  if (items === null) {
    // Jamais élargi en UNIQUE / index sur la colonne entière : abandonné, et signalé.
    ctx.report.add("index", table.name, MSG.lossPrefixKey(index.name ?? label, unique));
    return [];
  }
  const method = methodClause(ctx, table, index, unique, label);
  const using = rules.method?.position === "before" ? method : "";
  const trailing = rules.method?.position === "after" ? method : "";
  return [
    `CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON ${on}${using}(${items})${include(ctx, table, index)}${trailing};`,
  ];
}

/** Index plein texte / spatial : natif, GIN (PostgreSQL), ou abandonné et signalé. */
function kindIndex(ctx: Context, table: LogicalTable, index: LogicalKey, name: string, label: string): string[] {
  const rules = ctx.dialect.indexes;
  const on = tableName(ctx, table);
  const kind = index.kind!;
  if (rules.nativeKinds) {
    return [`CREATE ${kind.toUpperCase()} INDEX ${name} ON ${on}(${keyColumns(ctx, table, index)});`];
  }
  if (rules.fulltextGin && kind === "fulltext") {
    const text = index.columns.map((c) => `coalesce(${columnRef(ctx, table, c)}, '')`).join(" || ' ' || ");
    ctx.report.add("index", table.name, MSG.lossFulltextGin(index.name ?? label));
    return [
      `CREATE INDEX ${name} ON ${on} USING GIN (to_tsvector('simple', ${index.columns.length === 1 ? columnRef(ctx, table, index.columns[0]!) : text}));`,
    ];
  }
  ctx.report.add("index", table.name, MSG.lossIndexKind(index.name ?? label, kind.toUpperCase()));
  return [];
}

/** Éléments de l'index ; préfixes en index sur expression sans préfixes natifs ; `null` s'ils sont inexprimables. */
function prefixedItems(ctx: Context, table: LogicalTable, index: LogicalKey): string | null {
  const rules = ctx.dialect.indexes;
  if (!(index.prefixes && !rules.nativePrefixes)) {
    return keyColumns(ctx, table, index);
  }
  const prefix = (column: string, n: number) => rules.prefix(columnRef(ctx, table, column), n);
  const parts = index.columns.map((c, i) =>
    index.prefixes![i] ? prefix(c, index.prefixes![i]!) : columnRef(ctx, table, c),
  );
  return parts.some((p) => p === null) ? null : parts.join(", ");
}

/** USING méthode, si la cible l'accepte ; sinon signalé (sauf pour un UNIQUE, déjà signalé). */
function methodClause(ctx: Context, table: LogicalTable, index: LogicalKey, unique: boolean, label: string): string {
  if (!index.method || index.method === "btree") {
    return "";
  }
  if (ctx.dialect.indexes.method?.accepts(index.method, unique)) {
    return ` USING ${index.method.toUpperCase()}`;
  }
  if (!unique) {
    ctx.report.add("index", table.name, MSG.lossIndexMethod(index.name ?? label, index.method.toUpperCase()));
  }
  return "";
}

/** INCLUDE (colonnes couvertes), là où la cible l'exprime ; ailleurs signalé (O-42). */
export function include(ctx: Context, table: LogicalTable, key: LogicalKey): string {
  if (!key.include?.length) {
    return "";
  }
  if (ctx.dialect.indexes.include) {
    return ` INCLUDE (${key.include.map((c) => columnRef(ctx, table, c)).join(", ")})`;
  }
  ctx.report.add("index", table.name, MSG.lossInclude(key.name ?? describeKey(key)));
  return "";
}

import { Cursor, isName, isPunct, isWord, joinRaw, splitCommas } from "../sql/cursor";
import type { Token } from "../sql/tokenize";
import type { ParsedKey, ParsedTable } from "./parse";
import { constraintState, references } from "./parseConstraints";

/**
 * Éléments d'un index : colonnes, préfixes (`c(10)`, `left(c, 10)`, `substr(c, 1, 10)`) et
 * index plein texte PostgreSQL (`to_tsvector('cfg', c)`). `null` si un élément sort de ces formes.
 */
function keyItems(tokens: Token[]): KeyItems | null {
  const columns: string[] = [];
  const prefixes: (number | null)[] = [];
  let fulltext = false;
  for (const part of splitCommas(tokens)) {
    const item = keyItem(part);
    if (!item) {
      return null;
    }
    columns.push(...item.columns);
    prefixes.push(...item.prefixes);
    fulltext ||= item.fulltext;
  }
  return { columns, prefixes, fulltext };
}

interface KeyItems {
  columns: string[];
  prefixes: (number | null)[];
  fulltext: boolean;
}

/** Un élément d'index, ou `null` s'il sort des formes reconnues. */
function keyItem(part: Token[]): KeyItems | null {
  const items = part.filter((t) => !isWord(t, "asc", "desc"));
  const c = new Cursor(items);
  const first = c.peek();
  // c ou c(10)
  if (
    isName(first) &&
    (items.length === 1 ||
      (isPunct(items[1], "(") && items[2]?.type === "number" && isPunct(items[3], ")") && items.length === 4))
  ) {
    return {
      columns: [first!.value],
      prefixes: [items.length === 4 ? Number(items[2]!.value) : null],
      fulltext: false,
    };
  }
  // left(c, n) / substr(c, 1, n) / substring(c, 1, n)
  if (isWord(first, "left", "substr", "substring") && isPunct(items[1], "(")) {
    return prefixItem(c, first!);
  }
  // to_tsvector('cfg', a [|| ' ' || b…]) : plein texte
  if (isWord(first, "to_tsvector") && isPunct(items[1], "(")) {
    return fullTextItem(c);
  }
  return null;
}

function prefixItem(c: Cursor, first: Token): KeyItems | null {
  c.next();
  const args = splitCommas(c.group() ?? []);
  const name = args[0]?.length === 1 && isName(args[0][0]) ? args[0][0]!.value : null;
  const n = isWord(first, "left") ? args[1] : args[1]?.[0]?.value === "1" ? args[2] : undefined;
  if (!name || n?.length !== 1 || n[0]!.type !== "number" || !c.done()) {
    return null;
  }
  return { columns: [name], prefixes: [Number(n[0]!.value)], fulltext: false };
}

function fullTextItem(c: Cursor): KeyItems | null {
  c.next();
  const args = splitCommas(c.group() ?? []);
  const names = (args.at(-1) ?? [])
    .filter(isName)
    .filter((t) => !isWord(t, "coalesce"))
    .map((t) => t.value);
  if (names.length === 0) {
    return null;
  }
  return { columns: names, prefixes: names.map(() => null), fulltext: true };
}

const anyPrefix = (prefixes: (number | null)[]) => prefixes.some((p) => p !== null);

/** Liste de colonnes `(a, b DESC, c(10))` → noms. */
export function columnList(tokens: Token[] | null): string[] {
  if (!tokens) {
    return [];
  }
  return splitCommas(tokens)
    .map((part) => part.find(isName)?.value)
    .filter((name): name is string => Boolean(name));
}

/**
 * Index sur expression (O-39) : motif Oracle d'unicité conditionnelle — chaque élément
 * `CASE WHEN cond THEN col END`, même condition — lu comme index partiel `(col…) WHERE cond` ;
 * sinon expression telle qu'écrite, avec les colonnes qu'elle cite.
 */
function expressionItems(tokens: Token[], tableColumns: string[]): Omit<ParsedKey, "name"> | null {
  const parts = splitCommas(tokens);
  const conditional = parts.map((part) => {
    const items = part.filter((t) => !isWord(t, "asc", "desc"));
    if (!(isWord(items[0], "case") && isWord(items[1], "when") && isWord(items.at(-1), "end"))) {
      return null;
    }
    const then = items.findIndex((t) => isWord(t, "then"));
    const column = items.slice(then + 1, -1);
    if (
      then < 0 ||
      column.length !== 1 ||
      !isName(column[0]) ||
      items.slice(2, then).some((t) => isWord(t, "case", "when", "else"))
    ) {
      return null;
    }
    return { column: column[0]!.value, condition: joinRaw(items.slice(2, then)) };
  });
  if (conditional.every((x) => x !== null) && new Set(conditional.map((x) => x!.condition.toLowerCase())).size === 1) {
    return { columns: conditional.map((x) => x!.column), where: conditional[0]!.condition };
  }
  const expression = joinRaw(tokens);
  const cited = tokens.filter((t, k) => isName(t) && !isPunct(tokens[k + 1], "(")).map((t) => t.value);
  const columns = tableColumns.filter((name) => cited.some((c) => c.toLowerCase() === name.toLowerCase()));
  return columns.length > 0 ? { columns, expression } : null;
}

/** `[USING m] (éléments) [USING m]` d'un index ou d'une contrainte UNIQUE. */
export function indexBody(c: Cursor, tableColumns?: string[]): Omit<ParsedKey, "name"> | null {
  let method: string | undefined;
  if (c.accept("using")) {
    method = c.next()?.value.toLowerCase();
  }
  const group = c.group() ?? [];
  const items = keyItems(group);
  // USING INDEX (Oracle) : état / stockage de la contrainte, pas une méthode d'index.
  if (isWord(c.peek(), "using") && !isWord(c.peek(1), "index")) {
    c.next();
    method = c.next()?.value.toLowerCase();
  }
  const nullsNotDistinct = c.accept("nulls", "not", "distinct");
  if (!items) {
    return expressionBody(group, tableColumns, method, nullsNotDistinct);
  }
  return {
    columns: items.columns,
    ...(anyPrefix(items.prefixes) ? { prefixes: items.prefixes } : {}),
    ...(method ? { method } : {}),
    ...(items.fulltext ? { kind: "fulltext" as const } : {}),
    ...(nullsNotDistinct ? { nullsNotDistinct } : {}),
  };
}

/** Index sur expression (si les colonnes de la table sont connues). */
function expressionBody(
  group: Token[],
  tableColumns: string[] | undefined,
  method: string | undefined,
  nullsNotDistinct: boolean,
): Omit<ParsedKey, "name"> | null {
  const expression = tableColumns ? expressionItems(group, tableColumns) : null;
  return (
    expression && { ...expression, ...(method ? { method } : {}), ...(nullsNotDistinct ? { nullsNotDistinct } : {}) }
  );
}

/** Contrainte de table ; renvoie faux si l'élément n'en est pas une. */
export function tableConstraint(tokens: Token[], table: ParsedTable): boolean {
  const c = new Cursor(tokens);
  let name: string | undefined;
  if (c.accept("constraint")) {
    name = c.qualifiedName() ?? undefined;
  }
  if (c.accept("primary", "key")) {
    primaryKey(c, table, name);
    return true;
  }
  if (isWord(c.peek(), "unique")) {
    uniqueConstraint(c, table, name);
    return true;
  }
  if (c.accept("foreign", "key")) {
    foreignKey(c, table, name);
    return true;
  }
  if (c.accept("check")) {
    checkConstraint(c, table, name);
    return true;
  }
  // Index MySQL déclarés dans la table : [FULLTEXT | SPATIAL] KEY / INDEX [nom] [USING …] (colonnes)
  const kind = isWord(c.peek(), "fulltext", "spatial")
    ? (c.next()!.value.toLowerCase() as "fulltext" | "spatial")
    : undefined;
  if (!name && (isWord(c.peek(), "key", "index") || kind)) {
    inlineIndex(c, table, kind);
    return true;
  }
  // Ignorés : FULLTEXT / SPATIAL, EXCLUDE, LIKE, PERIOD, contraintes nommées inconnues…
  return Boolean(name) || isWord(c.peek(), "fulltext", "spatial", "exclude", "like", "period", "foreign", "primary");
}

function checkConstraint(c: Cursor, table: ParsedTable, name: string | undefined) {
  const expression = c.group();
  const state = constraintState(c, table);
  if (expression) {
    table.checks.push({ name, expression: joinRaw(expression), ...(state ? { state } : {}) });
  }
}

function primaryKey(c: Cursor, table: ParsedTable, name: string | undefined) {
  while (isWord(c.peek(), "clustered", "nonclustered") || (isWord(c.peek(), "using") && !isWord(c.peek(1), "index"))) {
    c.next();
  }
  table.primaryKey = columnList(c.group());
  table.primaryKeyName = name;
  const state = constraintState(c, table);
  if (state) {
    table.primaryKeyState = state;
  }
}

function uniqueConstraint(c: Cursor, table: ParsedTable, constraint: string | undefined) {
  let name = constraint;
  c.next();
  if (isWord(c.peek(), "key", "index")) {
    c.next();
  }
  const nullsNotDistinct = c.accept("nulls", "not", "distinct");
  while (isWord(c.peek(), "clustered", "nonclustered", "nulls", "distinct", "not")) {
    if (isWord(c.next(), "clustered") && !table.storage.includes("CLUSTERED")) {
      table.storage.push("CLUSTERED");
    }
  }
  if (isName(c.peek()) && !isWord(c.peek(), "using") && !isPunct(c.peek(), "(")) {
    name = c.qualifiedName() ?? name;
  }
  const key = indexBody(c);
  const state = constraintState(c, table);
  if (key?.columns.length) {
    table.uniques.push({
      name,
      ...key,
      ...(nullsNotDistinct ? { nullsNotDistinct } : {}),
      ...(state ? { state } : {}),
    });
  }
}

function foreignKey(c: Cursor, table: ParsedTable, name: string | undefined) {
  // MySQL : FOREIGN KEY nom_index (…) — c'est le nom de l'index, pas celui de la contrainte.
  if (isName(c.peek())) {
    c.qualifiedName();
  }
  const columns = columnList(c.group());
  if (!c.accept("references")) {
    return;
  }
  const fk = references(c, columns, name, table);
  if (fk) {
    table.foreignKeys.push(fk);
  }
}

function inlineIndex(c: Cursor, table: ParsedTable, kind: "fulltext" | "spatial" | undefined) {
  if (isWord(c.peek(), "key", "index")) {
    c.next();
  }
  const indexName = isPunct(c.peek(), "(") || isWord(c.peek(), "using") ? undefined : (c.qualifiedName() ?? undefined);
  const key = indexBody(c);
  if (key?.columns.length) {
    table.indexes.push({ name: indexName, ...key, ...(kind ? { kind } : {}) });
  }
}

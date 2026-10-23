import { type Cursor, isName, isPunct, isWord, joinRaw, splitCommas } from "../sql/cursor";
import type { Token } from "../sql/tokenize";
import type { ParsedSchema, ParsedTable } from "./parse";
import { columnDefinition } from "./parseColumns";
import { tableConstraint } from "./parseKeys";

export const findTable = (schema: ParsedSchema, name: string | null | undefined) =>
  name ? schema.tables.find((t) => t.name.toLowerCase() === name.toLowerCase()) : undefined;

export function createTable(c: Cursor, schema: ParsedSchema): void {
  while (isWord(c.peek(), "if", "not", "exists")) {
    c.next();
  }
  const qualified = c.qualified();
  const body = c.group();
  if (!(qualified && body)) {
    schema.ignored += 1; // CREATE TABLE … AS SELECT, LIKE… : sans définition de colonnes
    return;
  }
  const table: ParsedTable = {
    name: qualified.name,
    quoted: qualified.quoted,
    ...(qualified.schema ? { schema: qualified.schema } : {}),
    columns: [],
    primaryKey: [],
    uniques: [],
    foreignKeys: [],
    checks: [],
    indexes: [],
    triggers: [],
    storage: [],
  };
  tableElements(body, table);
  // Options de table retenues : commentaire, premier numéro d'auto-incrément (MySQL).
  while (!c.done()) {
    if (!(namedOption(c, table) || storageOption(c, table))) {
      c.next();
    }
  }
  // Le compteur de la table commence à cette valeur.
  if (table.autoIncrementStart !== undefined) {
    const counter = table.columns.find((col) => col.autoIncrement);
    if (counter) {
      counter.identityStart = table.autoIncrementStart;
    }
  }
  register(schema, table);
}

/** Table ajoutée au schéma ; une table de même nom est remplacée. */
function register(schema: ParsedSchema, table: ParsedTable) {
  const existing = schema.tables.findIndex((t) => t.name.toLowerCase() === table.name.toLowerCase());
  if (existing >= 0) {
    schema.tables[existing] = table;
  } else {
    schema.tables.push(table);
  }
}

/** Colonnes et contraintes de la définition (entre parenthèses). */
function tableElements(body: Token[], table: ParsedTable) {
  for (const element of splitCommas(body)) {
    if (element.length === 0 || tableConstraint(element, table)) {
      continue;
    }
    const column = columnDefinition(element, table);
    if (column) {
      table.columns.push(column);
    }
  }
}

/** COMMENT, AUTO_INCREMENT, COLLATE [=] valeur. */
function namedOption(c: Cursor, table: ParsedTable): boolean {
  if (c.accept("comment")) {
    const t = optionValue(c);
    if (t?.type === "string" || t?.type === "quoted") {
      table.comment = t.value;
    }
    return true;
  }
  if (c.accept("auto_increment")) {
    const t = optionValue(c);
    if (t?.type === "number") {
      table.autoIncrementStart = Number(t.value);
    }
    return true;
  }
  if (c.accept("collate")) {
    table.collation = optionValue(c)?.value;
    return true;
  }
  return false;
}

/** Valeur d'une option de table, après un « = » facultatif. */
function optionValue(c: Cursor) {
  if (isPunct(c.peek(), "=")) {
    c.next();
  }
  return c.next();
}

/** Groupes de fichiers, partitionnement, clauses de stockage. */
function storageOption(c: Cursor, table: ParsedTable): boolean {
  if ((isWord(c.peek(), "on") && isName(c.peek(1))) || isWord(c.peek(), "textimage_on", "filestream_on")) {
    // SQL Server : ON [PRIMARY], TEXTIMAGE_ON [PRIMARY] — groupes de fichiers (O-41).
    const label = isWord(c.next(), "on") ? "ON [groupe de fichiers]" : "TEXTIMAGE_ON";
    c.qualifiedName();
    if (!table.storage.includes(label)) {
      table.storage.push(label);
    }
    return true;
  }
  if (isWord(c.peek(), "partition") && isWord(c.peek(1), "by")) {
    // Partitionnement : conservé tel qu'écrit, jusqu'à la fin de l'instruction (O-39).
    table.partition = joinRaw(c.tokens.slice(c.i));
    c.i = c.tokens.length;
    return true;
  }
  if (STORAGE_CLAUSES.has(c.peek()?.value.toLowerCase() ?? "") && c.peek()?.type === "word") {
    storageClause(c, table);
    return true;
  }
  return false;
}

/** Clauses de stockage Oracle / PostgreSQL : notées par mot-clé, sans effet sur les données (O-39). */
function storageClause(c: Cursor, table: ParsedTable) {
  const word = c.next()!.value.toUpperCase();
  const label = word === "NOLOGGING" ? "LOGGING" : word === "NOCOMPRESS" ? "COMPRESS" : word;
  if (!table.storage.includes(label)) {
    table.storage.push(label);
  }
  if (label === "LOB") {
    c.skipGroup();
    while (
      !(
        c.done() ||
        isPunct(c.peek(), "(") ||
        (STORAGE_CLAUSES.has(c.peek()!.value.toLowerCase()) && c.peek()!.type === "word")
      )
    ) {
      c.next();
    }
    c.skipGroup();
  } else if (label === "STORAGE") {
    c.skipGroup();
  } else if (["TABLESPACE", "PCTFREE", "PCTUSED", "INITRANS", "MAXTRANS"].includes(label)) {
    c.next();
  }
}

/** Clauses de stockage (Oracle, PostgreSQL) reconnues après la définition d'une table ou d'un index. */
export const STORAGE_CLAUSES = new Set([
  "tablespace",
  "pctfree",
  "pctused",
  "initrans",
  "maxtrans",
  "storage",
  "logging",
  "nologging",
  "compress",
  "nocompress",
  "lob",
  "cache",
  "nocache",
  "parallel",
  "noparallel",
  "monitoring",
  "nomonitoring",
  "segment",
  "organization",
]);

import { type Cursor, isName, isPunct, isWord, splitCommas } from "../sql/cursor";
import type { ParsedSchema } from "./parse";
import { sequenceTrigger } from "./parseSequences";
import { findTable } from "./parseTables";

export function commentOn(c: Cursor, schema: ParsedSchema): void {
  const kind = c.next()?.value.toLowerCase();
  const parts: string[] = [];
  while (isName(c.peek())) {
    parts.push(c.next()!.value);
    if (!isPunct(c.peek(), ".")) {
      break;
    }
    c.next();
  }
  if (!c.accept("is")) {
    schema.ignored += 1;
    return;
  }
  const text = c.next();
  const comment = text?.type === "string" ? text.value : undefined;
  if (kind === "table") {
    const table = findTable(schema, parts.at(-1));
    if (table) {
      table.comment = comment;
    }
  } else if (kind === "column") {
    const table = findTable(schema, parts.at(-2));
    const column = table?.columns.find((col) => col.name.toLowerCase() === parts.at(-1)?.toLowerCase());
    if (column) {
      column.comment = comment;
    }
  } else {
    schema.ignored += 1;
  }
}

/**
 * EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'…', @level1name = N'table'
 * [, @level2type = N'COLUMN', @level2name = N'colonne'] (SQL Server) : commentaire (O-41).
 */
export function extendedProperty(c: Cursor, schema: ParsedSchema): void {
  const procedure = c.qualifiedName();
  if (procedure?.toLowerCase() !== "sp_addextendedproperty") {
    schema.ignored += 1;
    return;
  }
  const parameters = new Map<string, string>();
  for (const part of splitCommas(c.tokens.slice(c.i))) {
    const [key, equal, value] = part;
    if (key?.type === "word" && key.value.startsWith("@") && isPunct(equal, "=") && value) {
      parameters.set(key.value.slice(1).toLowerCase(), value.value);
    }
  }
  const table = findTable(schema, parameters.get("level1name"));
  if (parameters.get("name")?.toLowerCase() !== "ms_description" || !table) {
    schema.ignored += 1;
    return;
  }
  const level2 = parameters.get("level2type")?.toLowerCase();
  const column =
    level2 === "column"
      ? table.columns.find((col) => col.name.toLowerCase() === parameters.get("level2name")?.toLowerCase())
      : undefined;
  if (column) {
    column.comment = parameters.get("value");
  } else if (level2) {
    schema.ignored += 1;
  } else {
    table.comment = parameters.get("value");
  }
}

/**
 * CREATE TRIGGER nom … ON table … : conservé tel qu'écrit (texte d'origine) ; un déclencheur qui ne
 * fait qu'alimenter une colonne par une séquence devient la valeur par défaut de la colonne (O-39).
 */
export function createTrigger(c: Cursor, schema: ParsedSchema, raw: string): void {
  const pattern = sequenceTrigger(c.tokens.slice(c.i - 1));
  const target =
    pattern &&
    findTable(schema, pattern.table)?.columns.find((col) => col.name.toLowerCase() === pattern.column.toLowerCase());
  if (pattern && target && !target.sequence && !target.autoIncrement) {
    target.sequence = { name: pattern.sequence, trigger: pattern.trigger };
    return;
  }
  const name = c.qualifiedName();
  while (!(c.done() || isWord(c.peek(), "on"))) {
    c.next();
  }
  c.accept("on");
  const table = findTable(schema, c.qualifiedName());
  if (!(name && table)) {
    schema.ignored += 1;
    return;
  }
  table.triggers.push({ name, sql: raw });
}

/** CREATE DATABASE / SCHEMA … [DEFAULT] COLLATE [=] x : collation par défaut des colonnes de texte. */
export function createDatabase(c: Cursor, schema: ParsedSchema): void {
  schema.ignored += 1;
  while (!c.done()) {
    if (c.accept("collate")) {
      if (isPunct(c.peek(), "=")) {
        c.next();
      }
      schema.defaultCollation = c.next()?.value;
    } else {
      c.next();
    }
  }
}

/** CREATE COLLATION nom (provider = icu, locale = '…', deterministic = false) (PostgreSQL). */
export function createCollation(c: Cursor, schema: ParsedSchema): void {
  while (isWord(c.peek(), "if", "not", "exists")) {
    c.next();
  }
  const name = c.qualifiedName();
  const options: Record<string, string> = {};
  for (const part of splitCommas(c.group() ?? [])) {
    const [k, , v] = part;
    if (k && v) {
      options[k.value.toLowerCase()] = v.value.toLowerCase();
    }
  }
  if (name) {
    schema.collations.set(name.toLowerCase(), options);
  }
}

/** CREATE TYPE nom AS ENUM ('a', 'b') (PostgreSQL). */
export function createType(c: Cursor, schema: ParsedSchema): void {
  const name = c.qualifiedName();
  if (!(name && c.accept("as", "enum"))) {
    schema.ignored += 1;
    return;
  }
  const values = (c.group() ?? []).filter((t) => t.type === "string").map((t) => t.value);
  schema.enumTypes.set(name.toLowerCase(), values);
}

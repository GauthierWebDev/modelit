import { Cursor, isName, isPunct, isWord, joinRaw, splitCommas } from "./cursor";
import type { ParsedSchema, ParsedTable } from "./parse";
import { columnDefinition } from "./parseColumns";
import { tableConstraint } from "./parseKeys";
import { sequenceOfDefault } from "./parseSequences";
import type { Token } from "./tokenize";

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
  for (const element of splitCommas(body)) {
    if (element.length === 0 || tableConstraint(element, table)) {
      continue;
    }
    const column = columnDefinition(element, table);
    if (column) {
      table.columns.push(column);
    }
  }
  // Options de table retenues : commentaire, premier numéro d'auto-incrément (MySQL).
  while (!c.done()) {
    if (c.accept("comment")) {
      if (isPunct(c.peek(), "=")) {
        c.next();
      }
      const t = c.next();
      if (t?.type === "string" || t?.type === "quoted") {
        table.comment = t.value;
      }
    } else if (c.accept("auto_increment")) {
      if (isPunct(c.peek(), "=")) {
        c.next();
      }
      const t = c.next();
      if (t?.type === "number") {
        table.autoIncrementStart = Number(t.value);
      }
    } else if (c.accept("collate")) {
      if (isPunct(c.peek(), "=")) {
        c.next();
      }
      table.collation = c.next()?.value;
    } else if ((isWord(c.peek(), "on") && isName(c.peek(1))) || isWord(c.peek(), "textimage_on", "filestream_on")) {
      // SQL Server : ON [PRIMARY], TEXTIMAGE_ON [PRIMARY] — groupes de fichiers (O-41).
      const label = isWord(c.next(), "on") ? "ON [groupe de fichiers]" : "TEXTIMAGE_ON";
      c.qualifiedName();
      if (!table.storage.includes(label)) {
        table.storage.push(label);
      }
    } else if (isWord(c.peek(), "partition") && isWord(c.peek(1), "by")) {
      // Partitionnement : conservé tel qu'écrit, jusqu'à la fin de l'instruction (O-39).
      table.partition = joinRaw(c.tokens.slice(c.i));
      c.i = c.tokens.length;
    } else if (STORAGE_CLAUSES.has(c.peek()?.value.toLowerCase() ?? "") && c.peek()?.type === "word") {
      // Clauses de stockage Oracle / PostgreSQL : notées par mot-clé, sans effet sur les données (O-39).
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
    } else {
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
  const existing = schema.tables.findIndex((t) => t.name.toLowerCase() === table.name.toLowerCase());
  if (existing >= 0) {
    schema.tables[existing] = table;
  } else {
    schema.tables.push(table);
  }
}

export function alterTable(c: Cursor, schema: ParsedSchema, statement: Token[]): void {
  while (isWord(c.peek(), "only", "if", "exists")) {
    c.next();
  }
  const name = c.qualifiedName();
  const table = findTable(schema, name);
  if (!table) {
    if (name) {
      schema.skipped.push(joinRaw(statement.slice(0, 8)));
    } else {
      schema.ignored += 1;
    }
    return;
  }
  let used = false;
  const columnNamed = (n: string | undefined) =>
    table.columns.find((col) => col.name.toLowerCase() === n?.toLowerCase());
  for (const action of splitCommas(c.tokens.slice(c.i))) {
    const a = new Cursor(action);
    // SQL Server (O-41) : [NO]CHECK CONSTRAINT nom|ALL — active ou désactive une contrainte existante.
    const toggle = a.accept("nocheck", "constraint") ? true : a.accept("check", "constraint") ? false : undefined;
    if (toggle !== undefined) {
      const target = a.next()?.value.toLowerCase();
      const all = target === "all";
      const states = [
        ...table.checks,
        ...table.columns.flatMap((col) => (col.check ? [col.check] : [])),
        ...table.foreignKeys,
      ].filter((x) => all || x.name?.toLowerCase() === target);
      for (const x of states) {
        const { disabled: _d, ...rest } = x.state ?? {};
        x.state = toggle ? { ...rest, disabled: true } : Object.keys(rest).length > 0 ? rest : undefined;
        if (!x.state) {
          delete x.state;
        }
      }
      used ||= states.length > 0;
      continue;
    }
    // WITH NOCHECK ADD … : contrainte ajoutée sans vérifier les lignes existantes (non « trusted »).
    const unchecked = a.accept("with", "nocheck");
    a.accept("with", "check");
    // ADD [CONSTRAINT nom] DEFAULT expr FOR colonne
    const defaultFor = action.slice(a.i);
    const forIndex = defaultFor.findIndex((t) => isWord(t, "for"));
    const defaultIndex = defaultFor.findIndex((t) => isWord(t, "default"));
    if (isWord(defaultFor[0], "add") && defaultIndex > 0 && forIndex > defaultIndex) {
      const target = columnNamed(defaultFor[forIndex + 1]?.value);
      if (target) {
        const text = joinRaw(defaultFor.slice(defaultIndex + 1, forIndex));
        const sequence = sequenceOfDefault(text);
        if (sequence) {
          target.sequence = { name: sequence };
        } else {
          target.default = text;
        }
        used = true;
      }
      continue;
    }
    if (unchecked || isWord(action[0], "with")) {
      const before = { checks: table.checks.length, fks: table.foreignKeys.length };
      if (a.accept("add") && tableConstraint(action.slice(a.i), table)) {
        used = true;
        if (unchecked) {
          for (const x of [...table.checks.slice(before.checks), ...table.foreignKeys.slice(before.fks)]) {
            x.state = { ...x.state, notValidated: true };
          }
        }
      }
      continue;
    }
    // MySQL : MODIFY [COLUMN] définition ; CHANGE [COLUMN] ancien définition
    if (a.accept("modify") || a.accept("change")) {
      const renaming = isWord(action[0], "change");
      a.accept("column");
      const old = renaming ? a.next()?.value : undefined;
      const definition = columnDefinition(action.slice(a.i), table);
      const target = columnNamed(old ?? definition?.name);
      if (definition && target) {
        Object.assign(target, definition);
        used = true;
      }
      continue;
    }
    // PostgreSQL / SQL Server : ALTER [COLUMN] nom …
    if (a.accept("alter")) {
      a.accept("column");
      const target = columnNamed(a.next()?.value);
      if (!target) {
        continue;
      }
      used = true;
      if (a.accept("set", "not", "null")) {
        target.notNull = true;
      } else if (a.accept("drop", "not", "null")) {
        target.notNull = false;
      } else if (a.accept("set", "default")) {
        const text = joinRaw(action.slice(a.i));
        const sequence = sequenceOfDefault(text);
        if (sequence) {
          target.sequence = { name: sequence };
        } else {
          target.default = text;
        }
      } else if (a.accept("add", "generated")) {
        target.autoIncrement = true;
      } else if (a.accept("set", "data", "type") || a.accept("type")) {
        const definition = columnDefinition(
          [{ type: "word", value: target.name, raw: target.name }, ...action.slice(a.i)],
          table,
        );
        if (definition) {
          target.type = definition.type;
        }
      } else {
        used = false;
      }
      continue;
    }
    if (!a.accept("add")) {
      continue;
    }
    if (tableConstraint(action.slice(1), table)) {
      used = true;
      continue;
    }
    a.accept("column");
    while (isWord(a.peek(), "if", "not", "exists")) {
      a.next();
    }
    // Oracle : ADD (col1 …, col2 …)
    const group = isPunct(a.peek(), "(") ? a.group() : null;
    for (const definition of group ? splitCommas(group) : [action.slice(a.i)]) {
      if (tableConstraint(definition, table)) {
        used = true;
        continue;
      }
      const column = columnDefinition(definition, table);
      if (column) {
        table.columns.push(column);
        used = true;
      }
    }
  }
  if (!used) {
    schema.ignored += 1;
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

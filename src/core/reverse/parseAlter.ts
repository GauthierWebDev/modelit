import { Cursor, isPunct, isWord, joinRaw, splitCommas } from "../sql/cursor";
import type { Token } from "../sql/tokenize";
import type { ParsedColumn, ParsedSchema, ParsedTable } from "./parse";
import { columnDefinition } from "./parseColumns";
import { tableConstraint } from "./parseKeys";
import { sequenceOfDefault } from "./parseSequences";
import { findTable } from "./parseTables";

/**
 * Effet d'une action d'ALTER TABLE sur l'indicateur « instruction utilisée » : reconnue et
 * appliquée (`used`), reconnue sans effet (`unchanged`), ou ALTER COLUMN non compris (`unused`).
 */
type Outcome = "used" | "unchanged" | "unused";

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
  for (const action of splitCommas(c.tokens.slice(c.i))) {
    const outcome = alterAction(table, action);
    if (outcome === "used") {
      used = true;
    } else if (outcome === "unused") {
      used = false;
    }
  }
  if (!used) {
    schema.ignored += 1;
  }
}

const columnNamed = (table: ParsedTable, n: string | undefined) =>
  table.columns.find((col) => col.name.toLowerCase() === n?.toLowerCase());

function alterAction(table: ParsedTable, action: Token[]): Outcome {
  const a = new Cursor(action);
  const toggled = toggleConstraints(a, table);
  if (toggled) {
    return toggled;
  }
  // WITH NOCHECK ADD … : contrainte ajoutée sans vérifier les lignes existantes (non « trusted »).
  const unchecked = a.accept("with", "nocheck");
  a.accept("with", "check");
  const defaulted = addDefaultFor(a, action, table);
  if (defaulted) {
    return defaulted;
  }
  if (unchecked || isWord(action[0], "with")) {
    return addChecked(a, action, table, unchecked);
  }
  // MySQL : MODIFY [COLUMN] définition ; CHANGE [COLUMN] ancien définition
  if (a.accept("modify") || a.accept("change")) {
    return modifyColumn(a, action, table);
  }
  // PostgreSQL / SQL Server : ALTER [COLUMN] nom …
  if (a.accept("alter")) {
    return alterColumn(a, action, table);
  }
  if (!a.accept("add")) {
    return "unchanged";
  }
  return addColumns(a, action, table);
}

/** SQL Server (O-41) : [NO]CHECK CONSTRAINT nom|ALL — active ou désactive une contrainte existante. */
function toggleConstraints(a: Cursor, table: ParsedTable): Outcome | undefined {
  const toggle = a.accept("nocheck", "constraint") ? true : a.accept("check", "constraint") ? false : undefined;
  if (toggle === undefined) {
    return undefined;
  }
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
  return states.length > 0 ? "used" : "unchanged";
}

/** ADD [CONSTRAINT nom] DEFAULT expr FOR colonne */
function addDefaultFor(a: Cursor, action: Token[], table: ParsedTable): Outcome | undefined {
  const defaultFor = action.slice(a.i);
  const forIndex = defaultFor.findIndex((t) => isWord(t, "for"));
  const defaultIndex = defaultFor.findIndex((t) => isWord(t, "default"));
  if (!(isWord(defaultFor[0], "add") && defaultIndex > 0 && forIndex > defaultIndex)) {
    return undefined;
  }
  const target = columnNamed(table, defaultFor[forIndex + 1]?.value);
  if (!target) {
    return "unchanged";
  }
  setDefault(target, joinRaw(defaultFor.slice(defaultIndex + 1, forIndex)));
  return "used";
}

/** Valeur par défaut, ou séquence qui l'alimente (O-39). */
function setDefault(target: ParsedColumn, text: string) {
  const sequence = sequenceOfDefault(text);
  if (sequence) {
    target.sequence = { name: sequence };
  } else {
    target.default = text;
  }
}

/** WITH [NO]CHECK ADD contrainte : non validée si NOCHECK. */
function addChecked(a: Cursor, action: Token[], table: ParsedTable, unchecked: boolean): Outcome {
  const before = { checks: table.checks.length, fks: table.foreignKeys.length };
  if (!(a.accept("add") && tableConstraint(action.slice(a.i), table))) {
    return "unchanged";
  }
  if (unchecked) {
    for (const x of [...table.checks.slice(before.checks), ...table.foreignKeys.slice(before.fks)]) {
      x.state = { ...x.state, notValidated: true };
    }
  }
  return "used";
}

function modifyColumn(a: Cursor, action: Token[], table: ParsedTable): Outcome {
  const renaming = isWord(action[0], "change");
  a.accept("column");
  const old = renaming ? a.next()?.value : undefined;
  const definition = columnDefinition(action.slice(a.i), table);
  const target = columnNamed(table, old ?? definition?.name);
  if (!(definition && target)) {
    return "unchanged";
  }
  Object.assign(target, definition);
  return "used";
}

function alterColumn(a: Cursor, action: Token[], table: ParsedTable): Outcome {
  a.accept("column");
  const target = columnNamed(table, a.next()?.value);
  if (!target) {
    return "unchanged";
  }
  if (a.accept("set", "not", "null")) {
    target.notNull = true;
  } else if (a.accept("drop", "not", "null")) {
    target.notNull = false;
  } else if (a.accept("set", "default")) {
    setDefault(target, joinRaw(action.slice(a.i)));
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
    return "unused";
  }
  return "used";
}

/** ADD [COLUMN] [IF NOT EXISTS] définition, ou contrainte ; Oracle : ADD (col1 …, col2 …). */
function addColumns(a: Cursor, action: Token[], table: ParsedTable): Outcome {
  if (tableConstraint(action.slice(1), table)) {
    return "used";
  }
  a.accept("column");
  while (isWord(a.peek(), "if", "not", "exists")) {
    a.next();
  }
  let outcome: Outcome = "unchanged";
  const group = isPunct(a.peek(), "(") ? a.group() : null;
  for (const definition of group ? splitCommas(group) : [action.slice(a.i)]) {
    if (tableConstraint(definition, table)) {
      outcome = "used";
      continue;
    }
    const column = columnDefinition(definition, table);
    if (column) {
      table.columns.push(column);
      outcome = "used";
    }
  }
  return outcome;
}

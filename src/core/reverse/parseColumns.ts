import { Cursor, isName, isPunct, isWord, joinRaw } from "./cursor";
import type { ParsedColumn, ParsedTable } from "./parse";
import { counterOption, otherOption } from "./parseColumnOptions";
import { constraintState, references } from "./parseConstraints";
import { sequenceOfDefault } from "./parseSequences";
import type { Token } from "./tokenize";

/** Mots qui terminent le type d'une colonne. */
const AFTER_TYPE = new Set([
  "not",
  "null",
  "primary",
  "unique",
  "default",
  "references",
  "check",
  "constraint",
  "auto_increment",
  "autoincrement",
  "identity",
  "generated",
  "collate",
  "comment",
  "on",
  "as",
  "key",
  "charset",
  "encode",
  "sparse",
  "rowguidcol",
  "masked",
  "storage",
  "compression",
  "invisible",
  "visible",
  "enable",
  "disable",
  "filestream",
  "encrypted",
  "column_format",
  "srid",
  "using",
]);

export function columnDefinition(tokens: Token[], table: ParsedTable): ParsedColumn | null {
  const c = new Cursor(tokens);
  if (!isName(c.peek())) {
    return null;
  }
  const nameToken = c.next()!;
  const column: ParsedColumn = {
    name: nameToken.value,
    quoted: nameToken.type === "quoted",
    type: "",
    notNull: false,
    unique: false,
    autoIncrement: false,
  };
  column.type = columnType(c);

  // Contraintes et options de colonne ; CONSTRAINT nom s'applique à la contrainte suivante.
  let name: string | undefined;
  while (!c.done()) {
    if (c.accept("constraint")) {
      name = c.qualifiedName() ?? undefined;
      continue;
    }
    const read =
      keyOption(c, column, table, name) ||
      valueOption(c, column, table, name) ||
      counterOption(c, column) ||
      otherOption(c, column);
    if (!read) {
      c.next(); // option inconnue : ignorée
    }
    name = undefined;
  }
  return column;
}

/** Type : jusqu'au premier mot de contrainte (« CHARACTER SET » compris). */
function columnType(c: Cursor): string {
  const typeTokens: Token[] = [];
  while (!c.done()) {
    const t = c.peek()!;
    if (t.type === "word" && AFTER_TYPE.has(t.value.toLowerCase())) {
      break;
    }
    if (isWord(t, "character") && isWord(c.peek(1), "set")) {
      break;
    }
    if (isPunct(t, "(")) {
      const group = c.group() ?? [];
      typeTokens.push({ type: "punct", value: "(", raw: "(" }, ...group, { type: "punct", value: ")", raw: ")" });
      continue;
    }
    const token = c.next()!;
    // Type entre délimiteurs (SQL Server : [int]) : lu sans eux.
    typeTokens.push(token.type === "quoted" ? { type: "word", value: token.value, raw: token.value } : token);
  }
  return joinRaw(typeTokens);
}

/** NOT NULL, NULL, PRIMARY KEY, UNIQUE [KEY], KEY. */
function keyOption(c: Cursor, column: ParsedColumn, table: ParsedTable, name: string | undefined): boolean {
  if (c.accept("not", "null")) {
    column.notNull = true;
    return true;
  }
  if (c.accept("null")) {
    column.notNull = false;
    return true;
  }
  if (c.accept("primary", "key")) {
    table.primaryKey = [column.name];
    table.primaryKeyName = name;
    while (isWord(c.peek(), "asc", "desc", "clustered", "nonclustered")) {
      c.next();
    }
    if (c.accept("autoincrement")) {
      column.autoIncrement = true;
    }
    return true;
  }
  if (c.accept("unique")) {
    if (isWord(c.peek(), "key")) {
      c.next();
    }
    column.unique = true;
    column.uniqueName = name;
    return true;
  }
  if (c.accept("key")) {
    table.primaryKey = [column.name];
    return true;
  }
  return false;
}

/** DEFAULT, REFERENCES, CHECK. */
function valueOption(c: Cursor, column: ParsedColumn, table: ParsedTable, name: string | undefined): boolean {
  if (c.accept("default")) {
    defaultValue(c, column);
    return true;
  }
  if (c.accept("references")) {
    const fk = references(c, [column.name], name, table);
    if (fk) {
      table.foreignKeys.push({ ...fk, inline: true });
    }
    return true;
  }
  if (c.accept("check")) {
    const expression = c.group();
    const state = constraintState(c, table);
    if (expression) {
      column.check = { name, expression: joinRaw(expression), ...(state ? { state } : {}) };
    }
    return true;
  }
  return false;
}

/** Valeur par défaut, ou séquence qui l'alimente. */
function defaultValue(c: Cursor, column: ParsedColumn) {
  const expression: Token[] = [];
  while (!c.done()) {
    const t = c.peek()!;
    if (t.type === "word" && AFTER_TYPE.has(t.value.toLowerCase()) && !isWord(t, "null") && expression.length > 0) {
      break;
    }
    if (isPunct(t, "(")) {
      const group = c.group() ?? [];
      expression.push({ type: "punct", value: "(", raw: "(" }, ...group, { type: "punct", value: ")", raw: ")" });
      continue;
    }
    expression.push(c.next()!);
  }
  const text = joinRaw(expression);
  // Séquence : compteur (SERIAL) ou valeur de séquence, décidé en fin de lecture (O-39).
  const sequence = sequenceOfDefault(text);
  if (sequence) {
    column.sequence = { name: sequence };
  } else {
    column.default = text;
  }
}

import { Cursor, isName, isPunct, isWord, joinRaw } from "./cursor";
import type { ParsedColumn, ParsedTable } from "./parse";
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

  // Type : jusqu'au premier mot de contrainte (« CHARACTER SET » compris).
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
  column.type = joinRaw(typeTokens);

  // Contraintes et options de colonne ; CONSTRAINT nom s'applique à la contrainte suivante.
  let name: string | undefined;
  while (!c.done()) {
    if (c.accept("constraint")) {
      name = c.qualifiedName() ?? undefined;
      continue;
    }
    if (c.accept("not", "null")) {
      column.notNull = true;
    } else if (c.accept("null")) {
      column.notNull = false;
    } else if (c.accept("primary", "key")) {
      table.primaryKey = [column.name];
      table.primaryKeyName = name;
      while (isWord(c.peek(), "asc", "desc", "clustered", "nonclustered")) {
        c.next();
      }
      if (c.accept("autoincrement")) {
        column.autoIncrement = true;
      }
    } else if (c.accept("unique")) {
      if (isWord(c.peek(), "key")) {
        c.next();
      }
      column.unique = true;
      column.uniqueName = name;
    } else if (c.accept("key")) {
      table.primaryKey = [column.name];
    } else if (c.accept("default")) {
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
    } else if (c.accept("references")) {
      const fk = references(c, [column.name], name, table);
      if (fk) {
        table.foreignKeys.push({ ...fk, inline: true });
      }
    } else if (c.accept("check")) {
      const expression = c.group();
      const state = constraintState(c, table);
      if (expression) {
        column.check = { name, expression: joinRaw(expression), ...(state ? { state } : {}) };
      }
    } else if (c.accept("auto_increment") || c.accept("autoincrement")) {
      column.autoIncrement = true;
    } else if (c.accept("identity")) {
      column.autoIncrement = true;
      // SQL Server : IDENTITY refuse une valeur fournie (sauf IDENTITY_INSERT) — GENERATED ALWAYS (O-42).
      column.identity = "always";
      // SQL Server : IDENTITY(début, pas)
      const seed = c.group();
      if (seed?.[0]?.type === "number") {
        column.identityStart = Number(seed[0].value);
      }
      if (seed?.[2]?.type === "number" && Number(seed[2].value) !== 1) {
        column.identityIncrement = Number(seed[2].value);
      }
      if (c.accept("not", "for", "replication")) {
        addSqlServerOption(column, "NOT FOR REPLICATION");
      }
    } else if (c.accept("generated")) {
      let mode: "always" | "on null" | undefined;
      if (c.accept("always")) {
        mode = "always";
      } else if (c.accept("by", "default", "on", "null")) {
        mode = "on null";
      } else {
        c.accept("by", "default");
      }
      c.accept("as");
      if (c.accept("identity")) {
        column.autoIncrement = true;
        if (mode) {
          column.identity = mode;
        }
        identityOptions(c.group(), column);
      } else {
        generatedColumn(c, column);
      }
    } else if (c.accept("as")) {
      generatedColumn(c, column); // colonne calculée (MySQL, SQL Server)
    } else if (c.accept("collate")) {
      column.collation = c.next()?.value;
    } else if (c.accept("comment")) {
      // MySQL accepte aussi "…" pour une chaîne.
      const t = c.next();
      if (t?.type === "string" || t?.type === "quoted") {
        column.comment = t.value;
      }
    } else if (c.accept("on", "update")) {
      // ON UPDATE CURRENT_TIMESTAMP[(n)] (MySQL)
      const t = c.next();
      const precision = c.group();
      if (t) {
        column.onUpdate = precision ? `${t.raw}(${joinRaw(precision)})` : t.raw;
      }
    } else if (c.accept("on", "delete")) {
      c.next();
      c.skipGroup();
    } else if (c.accept("rowguidcol")) {
      addSqlServerOption(column, "ROWGUIDCOL");
    } else if (c.accept("not", "for", "replication")) {
      addSqlServerOption(column, "NOT FOR REPLICATION");
    } else if (c.accept("character", "set") || c.accept("charset")) {
      c.next();
    } else {
      c.next(); // option inconnue : ignorée
    }
    name = undefined;
  }
  return column;
}

/** Option de colonne SQL Server (ROWGUIDCOL, NOT FOR REPLICATION), réémise vers SQL Server (O-42). */
function addSqlServerOption(column: ParsedColumn, option: string) {
  column.sqlServerOptions ??= [];
  column.sqlServerOptions.push(option);
}

/** Expression d'une colonne calculée, puis STORED / VIRTUAL / PERSISTED. */
function generatedColumn(c: Cursor, column: ParsedColumn) {
  // Expression jusqu'au premier mot d'option ; SQL Server l'écrit sans parenthèses (`AS DATEDIFF(…)`) (O-41).
  const tokens: Token[] = [];
  let groups = 0;
  while (!(c.done() || (c.peek()!.type === "word" && GENERATED_STOP.has(c.peek()!.value.toLowerCase())))) {
    if (isPunct(c.peek(), "(")) {
      const group = c.group() ?? [];
      tokens.push({ type: "punct", value: "(", raw: "(" }, ...group, { type: "punct", value: ")", raw: ")" });
      groups += 1;
    } else {
      tokens.push(c.next()!);
    }
  }
  // (expr) : parenthèses englobantes retirées.
  const wrapped =
    groups === 1 &&
    isPunct(tokens[0], "(") &&
    isPunct(tokens.at(-1), ")") &&
    tokens.filter((t) => t.type === "punct" && t.value === "(").length > 0 &&
    tokens.length >= 2 &&
    wrapsAll(tokens);
  const expression = tokens.length > 0 ? (wrapped ? tokens.slice(1, -1) : tokens) : null;
  let stored = false;
  while (isWord(c.peek(), "stored", "virtual", "persisted")) {
    stored = !isWord(c.next(), "virtual") || stored;
  }
  if (expression) {
    column.generated = { expression: joinRaw(expression), stored };
  }
}

const GENERATED_STOP = new Set([
  "stored",
  "virtual",
  "persisted",
  "not",
  "null",
  "constraint",
  "primary",
  "unique",
  "check",
  "references",
  "default",
  "comment",
]);

/** La première parenthèse ferme-t-elle à la fin ? */
function wrapsAll(tokens: Token[]): boolean {
  let depth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    if (isPunct(tokens[k], "(")) {
      depth += 1;
    } else if (isPunct(tokens[k], ")")) {
      depth -= 1;
      if (depth === 0) {
        return k === tokens.length - 1;
      }
    }
  }
  return false;
}

/** Options d'une identité : (START WITH n INCREMENT BY m …). */
function identityOptions(options: Token[] | null, column: ParsedColumn) {
  if (!options) {
    return;
  }
  const c = new Cursor(options);
  while (!c.done()) {
    if (c.accept("start", "with") || c.accept("start")) {
      const t = c.next();
      if (t?.type === "number") {
        column.identityStart = Number(t.value);
      }
    } else if (c.accept("increment", "by") || c.accept("increment")) {
      const t = c.next();
      if (t?.type === "number" && Number(t.value) !== 1) {
        column.identityIncrement = Number(t.value);
      }
    } else {
      c.next();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Instructions

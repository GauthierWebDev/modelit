import type { SequenceDefinition } from "../model/physical";
import { type Cursor, isName, isPunct, isWord } from "../sql/cursor";
import type { Token } from "../sql/tokenize";
import type { ParsedSchema } from "./parse";

/** Nom de la séquence d'un DEFAULT : nextval('s'), s.NEXTVAL (Oracle), NEXT VALUE FOR s ; sinon `undefined`. */
export function sequenceOfDefault(source: string): string | undefined {
  let text = source;
  // (NEXT VALUE FOR s) : parenthèses englobantes (SQL Server) (O-41).
  while (/^\(.*\)$/s.test(text.trim())) {
    text = text.trim().slice(1, -1);
  }
  const last = (name: string) =>
    name
      .split(".")
      .at(-1)!
      .replace(/^"|"$/g, "")
      .replace(/^\[|\]$/g, "");
  const pg = /^nextval\s*\(\s*'([^']+)'(?:\s*::\s*regclass)?\s*\)$/i.exec(text.trim());
  if (pg) {
    return last(pg[1]!);
  }
  const oracle = /^((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s*\.\s*nextval$/i.exec(text.trim());
  if (oracle) {
    return last(oracle[1]!.replace(/\s+/g, ""));
  }
  const standard = /^next\s+value\s+for\s+((?:"[^"]+"|[\w$#[\]]+)(?:\.(?:"[^"]+"|[\w$#[\]]+))?)$/i.exec(text.trim());
  if (standard) {
    return last(standard[1]!).replace(/^\[|\]$/g, "");
  }
  return undefined;
}

/** CREATE SEQUENCE nom [START WITH n] [INCREMENT BY n] [MINVALUE n] [MAXVALUE n] [CACHE n | NOCACHE] [[NO]CYCLE]… */
export function createSequence(c: Cursor, schema: ParsedSchema): void {
  while (isWord(c.peek(), "if", "not", "exists")) {
    c.next();
  }
  const qualified = c.qualified();
  const name = qualified?.name;
  if (!name) {
    schema.ignored += 1;
    return;
  }
  const sequence: Sequence = {
    name,
    ...(qualified.schema ? { schema: qualified.schema } : {}),
  };
  while (!c.done()) {
    if (!sequenceOption(c, sequence)) {
      c.next(); // NOMINVALUE, NOMAXVALUE, ORDER, AS bigint… : défauts ou sans effet sur les valeurs
    }
  }
  schema.sequences.set(name.toLowerCase(), sequence);
}

type Sequence = SequenceDefinition & { ownedBy?: { table: string; column: string } };

function sequenceOption(c: Cursor, sequence: Sequence): boolean {
  if (c.accept("start", "with") || c.accept("start")) {
    sequence.start = signedNumber(c);
  } else if (c.accept("increment", "by") || c.accept("increment")) {
    sequence.increment = signedNumber(c);
  } else if (c.accept("minvalue")) {
    sequence.min = signedNumber(c);
  } else if (c.accept("maxvalue")) {
    sequence.max = signedNumber(c);
  } else if (c.accept("cache")) {
    sequence.cache = signedNumber(c);
  } else {
    return sequenceFlag(c, sequence);
  }
  return true;
}

function sequenceFlag(c: Cursor, sequence: Sequence): boolean {
  if (c.accept("nocache") || c.accept("no", "cache")) {
    sequence.cache = 1;
  } else if (c.accept("cycle")) {
    sequence.cycle = true;
  } else if (c.accept("nocycle") || c.accept("no", "cycle")) {
    sequence.cycle = false;
  } else if (c.accept("owned", "by")) {
    sequence.ownedBy = ownedBy(c);
  } else if (c.accept("as")) {
    sequence.type = c.next()?.value.toLowerCase();
  } else {
    return false;
  }
  return true;
}

/** Nombre, éventuellement précédé d'un signe moins. */
function signedNumber(c: Cursor): number | undefined {
  const negative = isPunct(c.peek(), "-") ? -1 : 1;
  if (negative < 0) {
    c.next();
  }
  const t = c.next();
  return t?.type === "number" ? negative * Number(t.value) : undefined;
}

/** OWNED BY table.colonne (PostgreSQL). */
export function ownedBy(c: Cursor): { table: string; column: string } | undefined {
  const parts: string[] = [];
  while (isName(c.peek())) {
    parts.push(c.next()!.value);
    if (!isPunct(c.peek(), ".")) {
      break;
    }
    c.next();
  }
  return parts.length >= 2 ? { table: parts.at(-2)!, column: parts.at(-1)! } : undefined;
}

/** ALTER SEQUENCE nom OWNED BY table.colonne (pg_dump). */
export function alterSequence(c: Cursor, schema: ParsedSchema): void {
  const name = c.qualifiedName();
  const sequence = name ? schema.sequences.get(name.toLowerCase()) : undefined;
  if (sequence && c.accept("owned", "by")) {
    sequence.ownedBy = ownedBy(c);
  } else {
    schema.ignored += 1;
  }
}

/**
 * Déclencheur Oracle qui alimente une colonne par une séquence (O-39) :
 *   BEFORE INSERT ON t FOR EACH ROW [WHEN (NEW.col IS NULL)]
 *   BEGIN { :NEW.col := seq.NEXTVAL; | SELECT seq.NEXTVAL INTO :NEW.col FROM dual; }
 *         (éventuellement dans IF :NEW.col IS NULL THEN … END IF;) END;
 * Rien d'autre dans le corps. Renvoie la colonne, la séquence et le mode, ou `null`.
 */
export function sequenceTrigger(
  tokens: Token[],
): { table: string; column: string; sequence: string; trigger: "on null" | "always" } | null {
  const text = tokens
    .map((t) => (t.type === "word" ? t.value.toLowerCase() : t.type === "quoted" ? `"${t.value}"` : t.raw))
    .join(" ");
  const name = `(?:"[^"]+"|[\\w$#]+)`;
  const qualified = `(?:${name} \\. )?(${name})`;
  const head = new RegExp(
    `^trigger ${qualified} before insert on ${qualified} for each row(?: when \\( new \\. (${name}) is null \\))? begin (.*) end(?: ${name})?$`,
  ).exec(text);
  if (!head) {
    return null;
  }
  const unquote = (n: string) => n.replace(/^"|"$/g, "");
  let body = head[4]!;
  let conditional = Boolean(head[3]);
  const guard = new RegExp(`^if : new \\. (${name}) is null then (.*) end if ;$`).exec(body);
  if (guard) {
    body = guard[2]!;
    conditional = true;
  }
  const assign = new RegExp(`^: new \\. (${name}) := ${qualified} \\. nextval ;$`).exec(body);
  const select = new RegExp(`^select ${qualified} \\. nextval into : new \\. (${name}) from (?:sys \\. )?dual ;$`).exec(
    body,
  );
  const column = assign?.[1] ?? select?.[2];
  const sequence = assign?.[2] ?? select?.[1];
  if (!(column && sequence)) {
    return null;
  }
  const condition = guard?.[1] ?? head[3];
  if (condition && unquote(condition).toLowerCase() !== unquote(column).toLowerCase()) {
    return null;
  }
  return {
    table: unquote(head[2]!),
    column: unquote(column),
    sequence: unquote(sequence),
    trigger: conditional ? "on null" : "always",
  };
}

/**
 * Valeur de séquence ou compteur (O-39) : une séquence non déclarée dans le script, ou nommée
 * table_colonne_seq (pg_dump, SERIAL), fait de la colonne un compteur. OWNED BY seul n'en fait pas un
 * compteur : une séquence nommée peut appartenir à la colonne qu'elle alimente (O-40).
 */
export function resolveSequences(schema: ParsedSchema) {
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (!column.sequence || column.sequence.trigger) {
        continue;
      }
      const declared = schema.sequences.get(column.sequence.name.toLowerCase());
      if (!declared || column.sequence.name.toLowerCase() === `${table.name}_${column.name}_seq`.toLowerCase()) {
        column.autoIncrement = true;
        delete column.sequence;
        // Séquence absorbée par le compteur (SERIAL) : elle appartient à la colonne.
        if (declared) {
          declared.ownedBy ??= { table: table.name, column: column.name };
        }
      }
    }
  }
}

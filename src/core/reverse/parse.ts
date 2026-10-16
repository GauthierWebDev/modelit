import type { ConstraintState, ReferentialAction, SequenceDefinition, SqlDialect } from "../model/physical";
import { splitStatements, type Token, tokenize } from "./tokenize";

/**
 * Lecture d'un script SQL de création (overrides O-28, O-29), quel que soit le SGBD et sa version.
 *
 * Tout ce qui décrit les tables est conservé : colonnes, types exacts, NOT NULL, DEFAULT,
 * auto-incrément, clés primaires, UNIQUE, clés étrangères (toutes actions), CHECK, index,
 * noms de contraintes, noms entre guillemets, commentaires ; ALTER TABLE … ADD / MODIFY / CHANGE
 * / ALTER COLUMN (formes de pg_dump et mysqldump) ; CREATE [UNIQUE] INDEX ; COMMENT ON.
 * Ignoré sans erreur : le reste (vues, fonctions, déclencheurs, séquences, droits, données…).
 */

export interface NamedExpression {
  name?: string;
  expression: string;
  state?: ConstraintState;
}

export interface ParsedColumn {
  name: string;
  /** Nom entre guillemets dans le script : sa casse est significative. */
  quoted: boolean;
  /** Type tel qu'écrit (ex. `VARCHAR(50)`, `NUMBER(10,2)`, `timestamp with time zone`). */
  type: string;
  notNull: boolean;
  unique: boolean;
  uniqueName?: string;
  autoIncrement: boolean;
  default?: string;
  collation?: string;
  comment?: string;
  /** CHECK déclaré sur la colonne. */
  check?: NamedExpression;
  /** Colonne calculée : expression telle qu'écrite, stockée ou virtuelle (O-35). */
  generated?: { expression: string; stored: boolean };
  /** MySQL ON UPDATE CURRENT_TIMESTAMP. */
  onUpdate?: string;
  /** Première valeur du compteur (IDENTITY (START WITH n), IDENTITY(n, pas)). */
  identityStart?: number;
  /** Pas du compteur (INCREMENT BY m, IDENTITY(n, m)) (O-41). */
  identityIncrement?: number;
  /** Identité GENERATED ALWAYS, ou BY DEFAULT ON NULL (Oracle) ; absente : BY DEFAULT / auto-incrément (O-39). */
  identity?: "always" | "on null";
  /**
   * Valeur tirée d'une séquence (O-39) : DEFAULT seq.NEXTVAL / nextval('seq') / NEXT VALUE FOR seq,
   * ou déclencheur Oracle `:NEW.col := seq.NEXTVAL` (`trigger` : sans WHEN … IS NULL, il écrase
   * toute valeur fournie ; avec, il remplace aussi un NULL explicite).
   */
  sequence?: { name: string; trigger?: "on null" | "always" };
  /** Options SQL Server sans effet sur les données : NOT FOR REPLICATION, ROWGUIDCOL (O-42). */
  sqlServerOptions?: string[];
}

export interface ParsedForeignKey {
  name?: string;
  columns: string[];
  table: string;
  /** Vide : la clé primaire de la table référencée. */
  referencedColumns: string[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  /** Déclarée en ligne, dans la définition de la colonne (MySQL : analysée mais non appliquée). */
  inline?: boolean;
  state?: ConstraintState;
}

export interface ParsedKey {
  name?: string;
  columns: string[];
  /** Longueur de préfixe par colonne (MySQL `email(100)`, PostgreSQL `left(email, 100)`). */
  prefixes?: (number | null)[];
  /** Méthode d'index (USING HASH, BTREE, GIN…). */
  method?: string;
  kind?: "fulltext" | "spatial";
  state?: ConstraintState;
  /** Index sur expression : éléments tels qu'écrits ; `columns` : colonnes citées (O-39). */
  expression?: string;
  /** Index partiel : condition (WHERE …, ou motif Oracle CASE WHEN cond THEN col END) (O-39). */
  where?: string;
  /** NULLS NOT DISTINCT (PostgreSQL 15+). */
  nullsNotDistinct?: boolean;
  /**
   * Index filtré SQL Server `WHERE c IS NOT NULL` sur chaque colonne : UNIQUE ordinaire, dont les NULL
   * restent distincts (plusieurs NULL admis) (O-41).
   */
  nullsDistinct?: boolean;
  /** Colonnes couvertes (INCLUDE, SQL Server / PostgreSQL 11+), sans effet sur l'unicité (O-42). */
  include?: string[];
}

export interface ParsedTable {
  name: string;
  quoted: boolean;
  columns: ParsedColumn[];
  primaryKey: string[];
  primaryKeyName?: string;
  uniques: ParsedKey[];
  foreignKeys: ParsedForeignKey[];
  /** CHECK de niveau table. */
  checks: NamedExpression[];
  /** Index non uniques. */
  indexes: ParsedKey[];
  comment?: string;
  /** MySQL AUTO_INCREMENT = n (option de table). */
  autoIncrementStart?: number;
  /** Collation par défaut de la table (MySQL : [DEFAULT] COLLATE = …). */
  collation?: string;
  /** Déclencheurs, tels qu'écrits. */
  triggers: { name: string; sql: string }[];
  primaryKeyState?: ConstraintState;
  /** Clauses de stockage (TABLESPACE, STORAGE, PCTFREE, LOB, USING INDEX…), par mot-clé (O-39). */
  storage: string[];
  /** Partitionnement (PARTITION BY …), tel qu'écrit (O-39). */
  partition?: string;
  /** Schéma de la table (ref.aeroport), tel qu'écrit (O-42). */
  schema?: string;
}

export interface ParsedSchema {
  tables: ParsedTable[];
  /** Types énumérés (PostgreSQL CREATE TYPE … AS ENUM) : nom → valeurs. */
  enumTypes: Map<string, string[]>;
  /** Collation par défaut de la base (CREATE DATABASE … COLLATE …). */
  defaultCollation?: string;
  /** Collations déclarées (PostgreSQL CREATE COLLATION) : nom → paramètres (locale, deterministic…). */
  collations: Map<string, Record<string, string>>;
  /** Séquences (CREATE SEQUENCE), par nom en minuscules ; `ownedBy` : colonne propriétaire (PostgreSQL). */
  sequences: Map<string, SequenceDefinition & { ownedBy?: { table: string; column: string } }>;
  /** Instructions sans rapport avec la structure des tables, ignorées. */
  ignored: number;
  /** Instructions de table qui n'ont pas pu être lues entièrement. */
  skipped: string[];
  /** Avertissements de lecture : fin de commentaire *\\/ orpheline (O-41). */
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Outils

const isWord = (t: Token | undefined, ...words: string[]) =>
  t?.type === "word" && words.includes(t.value.toLowerCase());
const isPunct = (t: Token | undefined, value: string) => t?.type === "punct" && t.value === value;
const isName = (t: Token | undefined) => t?.type === "word" || t?.type === "quoted";

class Cursor {
  constructor(
    readonly tokens: Token[],
    public i = 0,
  ) {}
  peek(offset = 0) {
    return this.tokens[this.i + offset];
  }
  next() {
    return this.tokens[this.i++];
  }
  done() {
    return this.i >= this.tokens.length;
  }
  /** Consomme les mots donnés s'ils se suivent ; renvoie vrai si c'est le cas. */
  accept(...words: string[]) {
    for (let k = 0; k < words.length; k++) if (!isWord(this.peek(k), words[k]!)) return false;
    this.i += words.length;
    return true;
  }
  /** Nom éventuellement qualifié (schema.table) : renvoie la dernière partie. */
  qualifiedName(): string | null {
    return this.qualified()?.name ?? null;
  }
  /** Idem, en indiquant si la dernière partie était entre guillemets, et le schéma (avant-dernière partie) (O-42). */
  qualified(): { name: string; quoted: boolean; schema?: string } | null {
    if (!isName(this.peek())) return null;
    const parts = [this.next()!];
    while (isPunct(this.peek(), ".") && isName(this.peek(1))) {
      this.i++;
      parts.push(this.next()!);
    }
    const token = parts.at(-1)!;
    return {
      name: token.value,
      quoted: token.type === "quoted",
      ...(parts.length > 1 ? { schema: parts.at(-2)!.value } : {}),
    };
  }
  /** Groupe entre parenthèses commençant ici : renvoie son contenu (sans les parenthèses). */
  group(): Token[] | null {
    if (!isPunct(this.peek(), "(")) return null;
    let depth = 0;
    const start = this.i;
    while (!this.done()) {
      const t = this.next()!;
      if (isPunct(t, "(")) depth++;
      else if (isPunct(t, ")") && --depth === 0) return this.tokens.slice(start + 1, this.i - 1);
    }
    return this.tokens.slice(start + 1);
  }
  skipGroup() {
    this.group();
  }
}

/** Découpe une liste aux virgules de premier niveau. */
function splitCommas(tokens: Token[]): Token[][] {
  const parts: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (isPunct(t, "(")) depth++;
    if (isPunct(t, ")")) depth--;
    if (depth === 0 && isPunct(t, ",")) {
      parts.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length) parts.push(current);
  return parts;
}

/** Texte SQL reconstitué à partir des lexèmes. */
export function joinRaw(tokens: Token[]): string {
  let out = "";
  tokens.forEach((t, k) => {
    const previous = tokens[k - 1];
    // Moins unaire collé au nombre : NUMBER(12,-3), BETWEEN -3 AND 20 (O-39).
    const before = tokens[k - 2];
    const unary =
      t.type === "number" &&
      isPunct(previous, "-") &&
      (k === 1 ||
        (before?.type === "punct" && before.value !== ")") ||
        isWord(
          before,
          "between",
          "and",
          "or",
          "not",
          "in",
          "then",
          "else",
          "when",
          "default",
          "by",
          "with",
          "values",
          "is",
          "like",
          "return",
        ));
    const tight =
      k === 0 ||
      unary ||
      isPunct(t, ")") ||
      isPunct(t, ",") ||
      isPunct(t, "(") ||
      isPunct(previous, "(") ||
      isPunct(t, ".") ||
      isPunct(previous, ".") ||
      isPunct(t, "::") ||
      isPunct(previous, "::");
    out +=
      (tight && !(isPunct(t, "(") && previous?.type === "word" && isWord(previous, "in", "and", "or", "not"))
        ? ""
        : " ") + t.raw;
  });
  return out.trim();
}

/**
 * Éléments d'un index : colonnes, préfixes (`c(10)`, `left(c, 10)`, `substr(c, 1, 10)`) et
 * index plein texte PostgreSQL (`to_tsvector('cfg', c)`). `null` si un élément sort de ces formes.
 */
function keyItems(tokens: Token[]): { columns: string[]; prefixes: (number | null)[]; fulltext: boolean } | null {
  const columns: string[] = [];
  const prefixes: (number | null)[] = [];
  let fulltext = false;
  for (const part of splitCommas(tokens)) {
    const items = part.filter((t) => !isWord(t, "asc", "desc"));
    const c = new Cursor(items);
    const first = c.peek();
    // c ou c(10)
    if (
      isName(first) &&
      (items.length === 1 ||
        (isPunct(items[1], "(") && items[2]?.type === "number" && isPunct(items[3], ")") && items.length === 4))
    ) {
      columns.push(first!.value);
      prefixes.push(items.length === 4 ? Number(items[2]!.value) : null);
      continue;
    }
    // left(c, n) / substr(c, 1, n) / substring(c, 1, n)
    if (isWord(first, "left", "substr", "substring") && isPunct(items[1], "(")) {
      c.next();
      const args = splitCommas(c.group() ?? []);
      const name = args[0]?.length === 1 && isName(args[0][0]) ? args[0][0]!.value : null;
      const n = isWord(first, "left") ? args[1] : args[1]?.[0]?.value === "1" ? args[2] : undefined;
      if (!name || n?.length !== 1 || n[0]!.type !== "number" || !c.done()) return null;
      columns.push(name);
      prefixes.push(Number(n[0]!.value));
      continue;
    }
    // to_tsvector('cfg', a [|| ' ' || b…]) : plein texte
    if (isWord(first, "to_tsvector") && isPunct(items[1], "(")) {
      c.next();
      const args = splitCommas(c.group() ?? []);
      const names = (args.at(-1) ?? [])
        .filter(isName)
        .filter((t) => !isWord(t, "coalesce"))
        .map((t) => t.value);
      if (!names.length) return null;
      fulltext = true;
      for (const name of names) {
        columns.push(name);
        prefixes.push(null);
      }
      continue;
    }
    return null;
  }
  return { columns, prefixes, fulltext };
}

const anyPrefix = (prefixes: (number | null)[]) => prefixes.some((p) => p !== null);

/** Liste de colonnes `(a, b DESC, c(10))` → noms. */
function columnList(tokens: Token[] | null): string[] {
  if (!tokens) return [];
  return splitCommas(tokens)
    .map((part) => part.find(isName)?.value)
    .filter((name): name is string => Boolean(name));
}

// ---------------------------------------------------------------------------------------------
// Contraintes

function readAction(c: Cursor): ReferentialAction | undefined {
  for (const words of [["cascade"], ["set", "null"], ["set", "default"], ["restrict"], ["no", "action"]]) {
    if (c.accept(...words)) return words.join(" ") as ReferentialAction;
  }
  c.next();
  return undefined;
}

/**
 * État d'une contrainte, après sa définition (O-39) : [NOT] DEFERRABLE, INITIALLY DEFERRED |
 * IMMEDIATE, ENABLE | DISABLE, VALIDATE | NOVALIDATE, NOT VALID (PostgreSQL), RELY… ;
 * `USING INDEX …` (Oracle) est noté comme clause de stockage de la table.
 */
function constraintState(c: Cursor, table?: ParsedTable): ConstraintState | undefined {
  const state: ConstraintState = {};
  let deferrable = false;
  let deferred = false;
  while (!c.done()) {
    if (c.accept("not", "deferrable")) deferrable = false;
    else if (c.accept("deferrable")) deferrable = true;
    else if (c.accept("initially", "deferred")) deferred = true;
    else if (c.accept("initially", "immediate")) deferred = false;
    else if (c.accept("disable")) state.disabled = true;
    else if (c.accept("enable")) state.disabled = undefined;
    else if (c.accept("novalidate") || c.accept("not", "valid")) state.notValidated = true;
    else if (c.accept("validate")) state.notValidated = undefined;
    else if (isWord(c.peek(), "rely", "norely", "no") && !isWord(c.peek(1), "action")) {
      c.next();
      if (isWord(c.peek(), "inherit")) c.next();
    } else if (isWord(c.peek(), "with") && isPunct(c.peek(1), "(")) {
      // SQL Server : WITH (PAD_INDEX = OFF, …) — options de l'index de la contrainte (O-41).
      c.next();
      c.skipGroup();
      if (table && !table.storage.includes("WITH (options d'index)")) table.storage.push("WITH (options d'index)");
    } else if (isWord(c.peek(), "on") && isName(c.peek(1)) && !isWord(c.peek(1), "delete", "update")) {
      // SQL Server : ON [PRIMARY] — groupe de fichiers.
      c.next();
      c.qualifiedName();
      if (table && !table.storage.includes("ON [groupe de fichiers]")) table.storage.push("ON [groupe de fichiers]");
    } else if (c.accept("using", "index")) {
      if (table && !table.storage.includes("USING INDEX")) table.storage.push("USING INDEX");
      // USING INDEX [nom | (CREATE INDEX …)] [TABLESPACE t] [PCTFREE n]… : jusqu'au mot d'état suivant.
      while (
        !c.done() &&
        !isWord(
          c.peek(),
          "deferrable",
          "not",
          "initially",
          "enable",
          "disable",
          "validate",
          "novalidate",
          "rely",
          "norely",
        )
      ) {
        if (isPunct(c.peek(), "(")) c.skipGroup();
        else c.next();
      }
    } else break;
  }
  if (deferrable) state.deferrable = deferred ? "deferred" : "immediate";
  return Object.values(state).some((v) => v !== undefined)
    ? Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined))
    : undefined;
}

/** Actions référentielles (toutes conservées) et état de la contrainte. */
function referentialActions(c: Cursor, fk: ParsedForeignKey, table?: ParsedTable) {
  while (!c.done()) {
    if (c.accept("on", "delete")) fk.onDelete = readAction(c);
    else if (c.accept("on", "update")) fk.onUpdate = readAction(c);
    else if (c.accept("match")) c.next();
    else if (isWord(c.peek(), "for", "replication")) c.next();
    else {
      const state = constraintState(c, table);
      if (!state) break;
      fk.state = { ...fk.state, ...state };
    }
  }
}

function references(c: Cursor, columns: string[], name?: string, owner?: ParsedTable): ParsedForeignKey | null {
  const table = c.qualifiedName();
  if (!table) return null;
  const fk: ParsedForeignKey = { name, columns, table, referencedColumns: columnList(c.group()) };
  referentialActions(c, fk, owner);
  return fk;
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
    if (!isWord(items[0], "case") || !isWord(items[1], "when") || !isWord(items.at(-1), "end")) return null;
    const then = items.findIndex((t) => isWord(t, "then"));
    const column = items.slice(then + 1, -1);
    if (
      then < 0 ||
      column.length !== 1 ||
      !isName(column[0]) ||
      items.slice(2, then).some((t) => isWord(t, "case", "when", "else"))
    )
      return null;
    return { column: column[0]!.value, condition: joinRaw(items.slice(2, then)) };
  });
  if (conditional.every((x) => x !== null) && new Set(conditional.map((x) => x!.condition.toLowerCase())).size === 1) {
    return { columns: conditional.map((x) => x!.column), where: conditional[0]!.condition };
  }
  const expression = joinRaw(tokens);
  const cited = tokens.filter((t, k) => isName(t) && !isPunct(tokens[k + 1], "(")).map((t) => t.value);
  const columns = tableColumns.filter((name) => cited.some((c) => c.toLowerCase() === name.toLowerCase()));
  return columns.length ? { columns, expression } : null;
}

/** `[USING m] (éléments) [USING m]` d'un index ou d'une contrainte UNIQUE. */
function indexBody(c: Cursor, tableColumns?: string[]): Omit<ParsedKey, "name"> | null {
  let method: string | undefined;
  if (c.accept("using")) method = c.next()?.value.toLowerCase();
  const group = c.group() ?? [];
  const items = keyItems(group);
  // USING INDEX (Oracle) : état / stockage de la contrainte, pas une méthode d'index.
  if (isWord(c.peek(), "using") && !isWord(c.peek(1), "index")) {
    c.next();
    method = c.next()?.value.toLowerCase();
  }
  const nullsNotDistinct = c.accept("nulls", "not", "distinct");
  if (!items) {
    const expression = tableColumns ? expressionItems(group, tableColumns) : null;
    return (
      expression && { ...expression, ...(method ? { method } : {}), ...(nullsNotDistinct ? { nullsNotDistinct } : {}) }
    );
  }
  return {
    columns: items.columns,
    ...(anyPrefix(items.prefixes) ? { prefixes: items.prefixes } : {}),
    ...(method ? { method } : {}),
    ...(items.fulltext ? { kind: "fulltext" as const } : {}),
    ...(nullsNotDistinct ? { nullsNotDistinct } : {}),
  };
}

/** Contrainte de table ; renvoie faux si l'élément n'en est pas une. */
function tableConstraint(tokens: Token[], table: ParsedTable): boolean {
  const c = new Cursor(tokens);
  let name: string | undefined;
  if (c.accept("constraint")) name = c.qualifiedName() ?? undefined;
  if (c.accept("primary", "key")) {
    while (isWord(c.peek(), "clustered", "nonclustered") || (isWord(c.peek(), "using") && !isWord(c.peek(1), "index")))
      c.next();
    table.primaryKey = columnList(c.group());
    table.primaryKeyName = name;
    const state = constraintState(c, table);
    if (state) table.primaryKeyState = state;
    return true;
  }
  if (isWord(c.peek(), "unique")) {
    c.next();
    if (isWord(c.peek(), "key", "index")) c.next();
    const nullsNotDistinct = c.accept("nulls", "not", "distinct");
    while (isWord(c.peek(), "clustered", "nonclustered", "nulls", "distinct", "not")) {
      if (isWord(c.next(), "clustered") && !table.storage.includes("CLUSTERED")) table.storage.push("CLUSTERED");
    }
    if (isName(c.peek()) && !isWord(c.peek(), "using") && !isPunct(c.peek(), "(")) name = c.qualifiedName() ?? name;
    const key = indexBody(c);
    const state = constraintState(c, table);
    if (key?.columns.length)
      table.uniques.push({
        name,
        ...key,
        ...(nullsNotDistinct ? { nullsNotDistinct } : {}),
        ...(state ? { state } : {}),
      });
    return true;
  }
  if (c.accept("foreign", "key")) {
    // MySQL : FOREIGN KEY nom_index (…) — c'est le nom de l'index, pas celui de la contrainte.
    if (isName(c.peek())) c.qualifiedName();
    const columns = columnList(c.group());
    if (!c.accept("references")) return true;
    const fk = references(c, columns, name, table);
    if (fk) table.foreignKeys.push(fk);
    return true;
  }
  if (c.accept("check")) {
    const expression = c.group();
    const state = constraintState(c, table);
    if (expression) table.checks.push({ name, expression: joinRaw(expression), ...(state ? { state } : {}) });
    return true;
  }
  // Index MySQL déclarés dans la table : [FULLTEXT | SPATIAL] KEY / INDEX [nom] [USING …] (colonnes)
  const kind = isWord(c.peek(), "fulltext", "spatial")
    ? (c.next()!.value.toLowerCase() as "fulltext" | "spatial")
    : undefined;
  if (!name && (isWord(c.peek(), "key", "index") || kind)) {
    if (isWord(c.peek(), "key", "index")) c.next();
    const indexName =
      isPunct(c.peek(), "(") || isWord(c.peek(), "using") ? undefined : (c.qualifiedName() ?? undefined);
    const key = indexBody(c);
    if (key?.columns.length) table.indexes.push({ name: indexName, ...key, ...(kind ? { kind } : {}) });
    return true;
  }
  // Ignorés : FULLTEXT / SPATIAL, EXCLUDE, LIKE, PERIOD, contraintes nommées inconnues…
  return Boolean(name) || isWord(c.peek(), "fulltext", "spatial", "exclude", "like", "period", "foreign", "primary");
}

// ---------------------------------------------------------------------------------------------
// Séquences (O-39)

/** Nom de la séquence d'un DEFAULT : nextval('s'), s.NEXTVAL (Oracle), NEXT VALUE FOR s ; sinon `undefined`. */
export function sequenceOfDefault(text: string): string | undefined {
  // (NEXT VALUE FOR s) : parenthèses englobantes (SQL Server) (O-41).
  while (/^\(.*\)$/s.test(text.trim())) text = text.trim().slice(1, -1);
  const last = (name: string) =>
    name
      .split(".")
      .at(-1)!
      .replace(/^"|"$/g, "")
      .replace(/^\[|\]$/g, "");
  const pg = /^nextval\s*\(\s*'([^']+)'(?:\s*::\s*regclass)?\s*\)$/i.exec(text.trim());
  if (pg) return last(pg[1]!);
  const oracle = /^((?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?)\s*\.\s*nextval$/i.exec(text.trim());
  if (oracle) return last(oracle[1]!.replace(/\s+/g, ""));
  const standard = /^next\s+value\s+for\s+((?:"[^"]+"|[\w$#\[\]]+)(?:\.(?:"[^"]+"|[\w$#\[\]]+))?)$/i.exec(text.trim());
  if (standard) return last(standard[1]!).replace(/^\[|\]$/g, "");
  return undefined;
}

/** CREATE SEQUENCE nom [START WITH n] [INCREMENT BY n] [MINVALUE n] [MAXVALUE n] [CACHE n | NOCACHE] [[NO]CYCLE]… */
function createSequence(c: Cursor, schema: ParsedSchema): void {
  while (isWord(c.peek(), "if", "not", "exists")) c.next();
  const qualified = c.qualified();
  const name = qualified?.name;
  if (!name) return void schema.ignored++;
  const sequence: SequenceDefinition & { ownedBy?: { table: string; column: string } } = {
    name,
    ...(qualified.schema ? { schema: qualified.schema } : {}),
  };
  const number = () => {
    const negative = isPunct(c.peek(), "-") ? -1 : 1;
    if (negative < 0) c.next();
    const t = c.next();
    return t?.type === "number" ? negative * Number(t.value) : undefined;
  };
  while (!c.done()) {
    if (c.accept("start", "with") || c.accept("start")) sequence.start = number();
    else if (c.accept("increment", "by") || c.accept("increment")) sequence.increment = number();
    else if (c.accept("minvalue")) sequence.min = number();
    else if (c.accept("maxvalue")) sequence.max = number();
    else if (c.accept("cache")) sequence.cache = number();
    else if (c.accept("nocache") || c.accept("no", "cache")) sequence.cache = 1;
    else if (c.accept("cycle")) sequence.cycle = true;
    else if (c.accept("nocycle") || c.accept("no", "cycle")) sequence.cycle = false;
    else if (c.accept("owned", "by")) sequence.ownedBy = ownedBy(c);
    else if (c.accept("as")) sequence.type = c.next()?.value.toLowerCase();
    else c.next(); // NOMINVALUE, NOMAXVALUE, ORDER, AS bigint… : défauts ou sans effet sur les valeurs
  }
  schema.sequences.set(name.toLowerCase(), sequence);
}

/** OWNED BY table.colonne (PostgreSQL). */
function ownedBy(c: Cursor): { table: string; column: string } | undefined {
  const parts: string[] = [];
  while (isName(c.peek())) {
    parts.push(c.next()!.value);
    if (!isPunct(c.peek(), ".")) break;
    c.next();
  }
  return parts.length >= 2 ? { table: parts.at(-2)!, column: parts.at(-1)! } : undefined;
}

/** ALTER SEQUENCE nom OWNED BY table.colonne (pg_dump). */
function alterSequence(c: Cursor, schema: ParsedSchema): void {
  const name = c.qualifiedName();
  const sequence = name ? schema.sequences.get(name.toLowerCase()) : undefined;
  if (sequence && c.accept("owned", "by")) sequence.ownedBy = ownedBy(c);
  else schema.ignored++;
}

/**
 * Déclencheur Oracle qui alimente une colonne par une séquence (O-39) :
 *   BEFORE INSERT ON t FOR EACH ROW [WHEN (NEW.col IS NULL)]
 *   BEGIN { :NEW.col := seq.NEXTVAL; | SELECT seq.NEXTVAL INTO :NEW.col FROM dual; }
 *         (éventuellement dans IF :NEW.col IS NULL THEN … END IF;) END;
 * Rien d'autre dans le corps. Renvoie la colonne, la séquence et le mode, ou `null`.
 */
function sequenceTrigger(
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
  if (!head) return null;
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
  if (!column || !sequence) return null;
  const condition = guard?.[1] ?? head[3];
  if (condition && unquote(condition).toLowerCase() !== unquote(column).toLowerCase()) return null;
  return {
    table: unquote(head[2]!),
    column: unquote(column),
    sequence: unquote(sequence),
    trigger: conditional ? "on null" : "always",
  };
}

// ---------------------------------------------------------------------------------------------
// Colonnes

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

function columnDefinition(tokens: Token[], table: ParsedTable): ParsedColumn | null {
  const c = new Cursor(tokens);
  if (!isName(c.peek())) return null;
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
    if (t.type === "word" && AFTER_TYPE.has(t.value.toLowerCase())) break;
    if (isWord(t, "character") && isWord(c.peek(1), "set")) break;
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
    if (c.accept("not", "null")) column.notNull = true;
    else if (c.accept("null")) column.notNull = false;
    else if (c.accept("primary", "key")) {
      table.primaryKey = [column.name];
      table.primaryKeyName = name;
      while (isWord(c.peek(), "asc", "desc", "clustered", "nonclustered")) c.next();
      if (c.accept("autoincrement")) column.autoIncrement = true;
    } else if (c.accept("unique")) {
      if (isWord(c.peek(), "key")) c.next();
      column.unique = true;
      column.uniqueName = name;
    } else if (c.accept("key")) {
      table.primaryKey = [column.name];
    } else if (c.accept("default")) {
      const expression: Token[] = [];
      while (!c.done()) {
        const t = c.peek()!;
        if (t.type === "word" && AFTER_TYPE.has(t.value.toLowerCase()) && !isWord(t, "null") && expression.length)
          break;
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
      if (sequence) column.sequence = { name: sequence };
      else column.default = text;
    } else if (c.accept("references")) {
      const fk = references(c, [column.name], name, table);
      if (fk) table.foreignKeys.push({ ...fk, inline: true });
    } else if (c.accept("check")) {
      const expression = c.group();
      const state = constraintState(c, table);
      if (expression) column.check = { name, expression: joinRaw(expression), ...(state ? { state } : {}) };
    } else if (c.accept("auto_increment") || c.accept("autoincrement")) {
      column.autoIncrement = true;
    } else if (c.accept("identity")) {
      column.autoIncrement = true;
      // SQL Server : IDENTITY refuse une valeur fournie (sauf IDENTITY_INSERT) — GENERATED ALWAYS (O-42).
      column.identity = "always";
      // SQL Server : IDENTITY(début, pas)
      const seed = c.group();
      if (seed?.[0]?.type === "number") column.identityStart = Number(seed[0].value);
      if (seed?.[2]?.type === "number" && Number(seed[2].value) !== 1) column.identityIncrement = Number(seed[2].value);
      if (c.accept("not", "for", "replication")) addSqlServerOption(column, "NOT FOR REPLICATION");
    } else if (c.accept("generated")) {
      let mode: "always" | "on null" | undefined;
      if (c.accept("always")) mode = "always";
      else if (c.accept("by", "default", "on", "null")) mode = "on null";
      else c.accept("by", "default");
      c.accept("as");
      if (c.accept("identity")) {
        column.autoIncrement = true;
        if (mode) column.identity = mode;
        identityOptions(c.group(), column);
      } else generatedColumn(c, column);
    } else if (c.accept("as")) {
      generatedColumn(c, column); // colonne calculée (MySQL, SQL Server)
    } else if (c.accept("collate")) {
      column.collation = c.next()?.value;
    } else if (c.accept("comment")) {
      // MySQL accepte aussi "…" pour une chaîne.
      const t = c.next();
      if (t?.type === "string" || t?.type === "quoted") column.comment = t.value;
    } else if (c.accept("on", "update")) {
      // ON UPDATE CURRENT_TIMESTAMP[(n)] (MySQL)
      const t = c.next();
      const precision = c.group();
      if (t) column.onUpdate = precision ? `${t.raw}(${joinRaw(precision)})` : t.raw;
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
  while (!c.done() && !(c.peek()!.type === "word" && GENERATED_STOP.has(c.peek()!.value.toLowerCase()))) {
    if (isPunct(c.peek(), "(")) {
      const group = c.group() ?? [];
      tokens.push({ type: "punct", value: "(", raw: "(" }, ...group, { type: "punct", value: ")", raw: ")" });
      groups++;
    } else tokens.push(c.next()!);
  }
  // (expr) : parenthèses englobantes retirées.
  const wrapped =
    groups === 1 &&
    isPunct(tokens[0], "(") &&
    isPunct(tokens.at(-1), ")") &&
    tokens.filter((t) => t.type === "punct" && t.value === "(").length >= 1 &&
    tokens.length >= 2 &&
    wrapsAll(tokens);
  const expression = tokens.length ? (wrapped ? tokens.slice(1, -1) : tokens) : null;
  let stored = false;
  while (isWord(c.peek(), "stored", "virtual", "persisted")) stored = !isWord(c.next(), "virtual") || stored;
  if (expression) column.generated = { expression: joinRaw(expression), stored };
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
  for (let k = 0; k < tokens.length; k++) {
    if (isPunct(tokens[k], "(")) depth++;
    else if (isPunct(tokens[k], ")") && --depth === 0) return k === tokens.length - 1;
  }
  return false;
}

/** Options d'une identité : (START WITH n INCREMENT BY m …). */
function identityOptions(options: Token[] | null, column: ParsedColumn) {
  if (!options) return;
  const c = new Cursor(options);
  while (!c.done()) {
    if (c.accept("start", "with") || c.accept("start")) {
      const t = c.next();
      if (t?.type === "number") column.identityStart = Number(t.value);
    } else if (c.accept("increment", "by") || c.accept("increment")) {
      const t = c.next();
      if (t?.type === "number" && Number(t.value) !== 1) column.identityIncrement = Number(t.value);
    } else c.next();
  }
}

// ---------------------------------------------------------------------------------------------
// Instructions

const findTable = (schema: ParsedSchema, name: string | null | undefined) =>
  name ? schema.tables.find((t) => t.name.toLowerCase() === name.toLowerCase()) : undefined;

function createTable(c: Cursor, schema: ParsedSchema): void {
  while (isWord(c.peek(), "if", "not", "exists")) c.next();
  const qualified = c.qualified();
  const body = c.group();
  if (!qualified || !body) {
    schema.ignored++; // CREATE TABLE … AS SELECT, LIKE… : sans définition de colonnes
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
    if (!element.length || tableConstraint(element, table)) continue;
    const column = columnDefinition(element, table);
    if (column) table.columns.push(column);
  }
  // Options de table retenues : commentaire, premier numéro d'auto-incrément (MySQL).
  while (!c.done()) {
    if (c.accept("comment")) {
      if (isPunct(c.peek(), "=")) c.next();
      const t = c.next();
      if (t?.type === "string" || t?.type === "quoted") table.comment = t.value;
    } else if (c.accept("auto_increment")) {
      if (isPunct(c.peek(), "=")) c.next();
      const t = c.next();
      if (t?.type === "number") table.autoIncrementStart = Number(t.value);
    } else if (c.accept("collate")) {
      if (isPunct(c.peek(), "=")) c.next();
      table.collation = c.next()?.value;
    } else if ((isWord(c.peek(), "on") && isName(c.peek(1))) || isWord(c.peek(), "textimage_on", "filestream_on")) {
      // SQL Server : ON [PRIMARY], TEXTIMAGE_ON [PRIMARY] — groupes de fichiers (O-41).
      const label = isWord(c.next(), "on") ? "ON [groupe de fichiers]" : "TEXTIMAGE_ON";
      c.qualifiedName();
      if (!table.storage.includes(label)) table.storage.push(label);
    } else if (isWord(c.peek(), "partition") && isWord(c.peek(1), "by")) {
      // Partitionnement : conservé tel qu'écrit, jusqu'à la fin de l'instruction (O-39).
      table.partition = joinRaw(c.tokens.slice(c.i));
      c.i = c.tokens.length;
    } else if (STORAGE_CLAUSES.has(c.peek()?.value.toLowerCase() ?? "") && c.peek()?.type === "word") {
      // Clauses de stockage Oracle / PostgreSQL : notées par mot-clé, sans effet sur les données (O-39).
      const word = c.next()!.value.toUpperCase();
      const label = word === "NOLOGGING" ? "LOGGING" : word === "NOCOMPRESS" ? "COMPRESS" : word;
      if (!table.storage.includes(label)) table.storage.push(label);
      if (label === "LOB") {
        c.skipGroup();
        while (
          !c.done() &&
          !isPunct(c.peek(), "(") &&
          !(STORAGE_CLAUSES.has(c.peek()!.value.toLowerCase()) && c.peek()!.type === "word")
        )
          c.next();
        c.skipGroup();
      } else if (label === "STORAGE") c.skipGroup();
      else if (["TABLESPACE", "PCTFREE", "PCTUSED", "INITRANS", "MAXTRANS"].includes(label)) c.next();
    } else c.next();
  }
  // Le compteur de la table commence à cette valeur.
  if (table.autoIncrementStart !== undefined) {
    const counter = table.columns.find((col) => col.autoIncrement);
    if (counter) counter.identityStart = table.autoIncrementStart;
  }
  const existing = schema.tables.findIndex((t) => t.name.toLowerCase() === table.name.toLowerCase());
  if (existing >= 0) schema.tables[existing] = table;
  else schema.tables.push(table);
}

function alterTable(c: Cursor, schema: ParsedSchema, statement: Token[]): void {
  while (isWord(c.peek(), "only", "if", "exists")) c.next();
  const name = c.qualifiedName();
  const table = findTable(schema, name);
  if (!table) {
    if (name) schema.skipped.push(joinRaw(statement.slice(0, 8)));
    else schema.ignored++;
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
        x.state = toggle ? { ...rest, disabled: true } : Object.keys(rest).length ? rest : undefined;
        if (!x.state) delete x.state;
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
        if (sequence) target.sequence = { name: sequence };
        else target.default = text;
        used = true;
      }
      continue;
    }
    if (unchecked || isWord(action[0], "with")) {
      const before = { checks: table.checks.length, fks: table.foreignKeys.length };
      if (a.accept("add") && tableConstraint(action.slice(a.i), table)) {
        used = true;
        if (unchecked)
          for (const x of [...table.checks.slice(before.checks), ...table.foreignKeys.slice(before.fks)])
            x.state = { ...x.state, notValidated: true };
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
      if (!target) continue;
      used = true;
      if (a.accept("set", "not", "null")) target.notNull = true;
      else if (a.accept("drop", "not", "null")) target.notNull = false;
      else if (a.accept("set", "default")) {
        const text = joinRaw(action.slice(a.i));
        const sequence = sequenceOfDefault(text);
        if (sequence) target.sequence = { name: sequence };
        else target.default = text;
      } else if (a.accept("add", "generated")) target.autoIncrement = true;
      else if (a.accept("set", "data", "type") || a.accept("type")) {
        const definition = columnDefinition(
          [{ type: "word", value: target.name, raw: target.name }, ...action.slice(a.i)],
          table,
        );
        if (definition) target.type = definition.type;
      } else used = false;
      continue;
    }
    if (!a.accept("add")) continue;
    if (tableConstraint(action.slice(1), table)) {
      used = true;
      continue;
    }
    a.accept("column");
    while (isWord(a.peek(), "if", "not", "exists")) a.next();
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
  if (!used) schema.ignored++;
}

/** CREATE [UNIQUE] INDEX nom ON table (colonnes) : index, ou identifiant alternatif si UNIQUE. */
function createIndex(c: Cursor, schema: ParsedSchema, unique: boolean, kind?: "fulltext" | "spatial"): void {
  let clustered = false;
  while (isWord(c.peek(), "clustered", "nonclustered")) clustered = isWord(c.next(), "clustered") || clustered;
  if (!c.accept("index")) return void schema.ignored++;
  c.accept("concurrently");
  while (isWord(c.peek(), "if", "not", "exists")) c.next();
  const name = isWord(c.peek(), "on") ? undefined : (c.qualifiedName() ?? undefined);
  if (!c.accept("on")) return void schema.ignored++;
  c.accept("only");
  const table = findTable(schema, c.qualifiedName());
  // Colonnes, préfixes (left / substr), plein texte (to_tsvector), expression, index partiel
  // (WHERE ; motif Oracle CASE WHEN … THEN col END) (O-39).
  const key = table
    ? indexBody(
        c,
        table.columns.map((col) => col.name),
      )
    : null;
  // SQL Server : INCLUDE (colonnes couvertes) — sans effet sur l'unicité (O-41).
  // INCLUDE (colonnes couvertes) : conservé (SQL Server, PostgreSQL 11+), sans effet sur l'unicité (O-42).
  if (key && c.accept("include")) key.include = columnList(c.group());
  if (table && clustered && !table.storage.includes("CLUSTERED")) table.storage.push("CLUSTERED");
  if (key && c.accept("where")) {
    const rest = c.tokens.slice(c.i);
    const end = rest.findIndex((t) => isWord(t, "tablespace", "with"));
    key.where = joinRaw(end < 0 ? rest : rest.slice(0, end));
    c.i += end < 0 ? rest.length : end;
    // Idiome SQL Server « UNIQUE avec plusieurs NULL » : WHERE c IS NOT NULL pour chaque colonne
    // indexée, et rien d'autre → UNIQUE ordinaire (NULL distincts), pas une unicité conditionnelle (O-41).
    const conjuncts = joinRaw(end < 0 ? rest : rest.slice(0, end))
      .split(/\s+and\s+/i)
      .map((p) => /^\(?\s*\[?"?([\w$#]+)"?\]?\s+is\s+not\s+null\s*\)?$/i.exec(p.trim())?.[1]?.toLowerCase());
    if (
      unique &&
      conjuncts.every(Boolean) &&
      conjuncts.length === key.columns.length &&
      key.columns.every((col) => conjuncts.includes(col.toLowerCase())) &&
      !key.expression
    ) {
      delete key.where;
      key.nullsDistinct = true;
    }
  }
  // Options physiques de l'index (Oracle, PostgreSQL) : sans effet sur l'unicité ; les clauses de
  // stockage sont notées sur la table (rapport) (O-39).
  while (
    !c.done() &&
    (STORAGE_CLAUSES.has(c.peek()!.value.toLowerCase()) ||
      c.peek()!.type === "number" ||
      isWord(
        c.peek(),
        "online",
        "compute",
        "statistics",
        "local",
        "global",
        "reverse",
        "visible",
        "invisible",
        "nosort",
        "parallel",
        "noparallel",
        "with",
        "on",
      ))
  ) {
    // SQL Server : WITH (options) / ON [groupe de fichiers].
    if (isWord(c.peek(), "with", "on") && table) {
      const label = isWord(c.next(), "with") ? "WITH (options d'index)" : "ON [groupe de fichiers]";
      if (label.startsWith("WITH")) c.skipGroup();
      else c.qualifiedName();
      if (!table.storage.includes(label)) table.storage.push(label);
      continue;
    }
    const word = c.next()!;
    if (table && word.type === "word" && STORAGE_CLAUSES.has(word.value.toLowerCase())) {
      const label = `INDEX ${word.value.toUpperCase()}`;
      if (!table.storage.includes(label)) table.storage.push(label);
    }
    if (isWord(word, "storage", "with")) c.skipGroup();
    else if (isWord(word, "tablespace")) c.next(); // nom du tablespace
  }
  if (!table || !key || !c.done()) return void schema.ignored++;
  if (kind) key.kind = kind;
  if (key.method === "gin" && key.kind === "fulltext") delete key.method;
  if (unique) table.uniques.push({ name, ...key });
  else table.indexes.push({ name, ...key });
}

function commentOn(c: Cursor, schema: ParsedSchema): void {
  const kind = c.next()?.value.toLowerCase();
  const parts: string[] = [];
  while (isName(c.peek())) {
    parts.push(c.next()!.value);
    if (!isPunct(c.peek(), ".")) break;
    c.next();
  }
  if (!c.accept("is")) return void schema.ignored++;
  const text = c.next();
  const comment = text?.type === "string" ? text.value : undefined;
  if (kind === "table") {
    const table = findTable(schema, parts.at(-1));
    if (table) table.comment = comment;
  } else if (kind === "column") {
    const table = findTable(schema, parts.at(-2));
    const column = table?.columns.find((col) => col.name.toLowerCase() === parts.at(-1)?.toLowerCase());
    if (column) column.comment = comment;
  } else schema.ignored++;
}

/**
 * EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'…', @level1name = N'table'
 * [, @level2type = N'COLUMN', @level2name = N'colonne'] (SQL Server) : commentaire (O-41).
 */
function extendedProperty(c: Cursor, schema: ParsedSchema): void {
  const procedure = c.qualifiedName();
  if (procedure?.toLowerCase() !== "sp_addextendedproperty") return void schema.ignored++;
  const parameters = new Map<string, string>();
  for (const part of splitCommas(c.tokens.slice(c.i))) {
    const [key, equal, value] = part;
    if (key?.type === "word" && key.value.startsWith("@") && isPunct(equal, "=") && value)
      parameters.set(key.value.slice(1).toLowerCase(), value.value);
  }
  const table = findTable(schema, parameters.get("level1name"));
  if (parameters.get("name")?.toLowerCase() !== "ms_description" || !table) return void schema.ignored++;
  const level2 = parameters.get("level2type")?.toLowerCase();
  const column =
    level2 === "column"
      ? table.columns.find((col) => col.name.toLowerCase() === parameters.get("level2name")?.toLowerCase())
      : undefined;
  if (column) column.comment = parameters.get("value");
  else if (!level2) table.comment = parameters.get("value");
  else schema.ignored++;
}

/**
 * CREATE TRIGGER nom … ON table … : conservé tel qu'écrit (texte d'origine) ; un déclencheur qui ne
 * fait qu'alimenter une colonne par une séquence devient la valeur par défaut de la colonne (O-39).
 */
function createTrigger(c: Cursor, schema: ParsedSchema, raw: string): void {
  const pattern = sequenceTrigger(c.tokens.slice(c.i - 1));
  const target =
    pattern &&
    findTable(schema, pattern.table)?.columns.find((col) => col.name.toLowerCase() === pattern.column.toLowerCase());
  if (pattern && target && !target.sequence && !target.autoIncrement) {
    target.sequence = { name: pattern.sequence, trigger: pattern.trigger };
    return;
  }
  const name = c.qualifiedName();
  while (!c.done() && !isWord(c.peek(), "on")) c.next();
  c.accept("on");
  const table = findTable(schema, c.qualifiedName());
  if (!name || !table) return void schema.ignored++;
  table.triggers.push({ name, sql: raw });
}

/** CREATE DATABASE / SCHEMA … [DEFAULT] COLLATE [=] x : collation par défaut des colonnes de texte. */
function createDatabase(c: Cursor, schema: ParsedSchema): void {
  schema.ignored++;
  while (!c.done()) {
    if (c.accept("collate")) {
      if (isPunct(c.peek(), "=")) c.next();
      schema.defaultCollation = c.next()?.value;
    } else c.next();
  }
}

/** CREATE COLLATION nom (provider = icu, locale = '…', deterministic = false) (PostgreSQL). */
function createCollation(c: Cursor, schema: ParsedSchema): void {
  while (isWord(c.peek(), "if", "not", "exists")) c.next();
  const name = c.qualifiedName();
  const options: Record<string, string> = {};
  for (const part of splitCommas(c.group() ?? [])) {
    const [k, , v] = part;
    if (k && v) options[k.value.toLowerCase()] = v.value.toLowerCase();
  }
  if (name) schema.collations.set(name.toLowerCase(), options);
}

/** CREATE TYPE nom AS ENUM ('a', 'b') (PostgreSQL). */
function createType(c: Cursor, schema: ParsedSchema): void {
  const name = c.qualifiedName();
  if (!name || !c.accept("as", "enum")) return void schema.ignored++;
  const values = (c.group() ?? []).filter((t) => t.type === "string").map((t) => t.value);
  schema.enumTypes.set(name.toLowerCase(), values);
}

export function parseSql(sql: string, dialect?: SqlDialect): ParsedSchema {
  const schema: ParsedSchema = {
    tables: [],
    enumTypes: new Map(),
    collations: new Map(),
    sequences: new Map(),
    ignored: 0,
    skipped: [],
    warnings: [],
  };
  for (const statement of splitStatements(tokenize(sql, { dialect, warnings: schema.warnings }))) {
    const c = new Cursor(statement);
    const first = statement[0]!;
    const last = statement.at(-1)!;
    const raw =
      first.pos !== undefined && last.pos !== undefined
        ? sql.slice(first.pos, last.pos + last.raw.length)
        : joinRaw(statement);
    try {
      if (c.accept("create")) {
        c.accept("or", "replace");
        // MySQL : CREATE DEFINER = utilisateur TRIGGER …
        if (c.accept("definer")) {
          if (isPunct(c.peek(), "=")) c.next();
          while (!c.done() && !isWord(c.peek(), "trigger", "procedure", "function", "view", "event")) c.next();
        }
        const unique = c.accept("unique");
        const kind = isWord(c.peek(), "fulltext", "spatial")
          ? (c.next()!.value.toLowerCase() as "fulltext" | "spatial")
          : undefined;
        while (isWord(c.peek(), "global", "local", "temporary", "temp", "unlogged", "virtual", "external", "transient"))
          c.next();
        if (!unique && !kind && c.accept("table")) createTable(c, schema);
        else if (isWord(c.peek(), "index", "clustered", "nonclustered")) createIndex(c, schema, unique, kind);
        else if (c.accept("trigger")) createTrigger(c, schema, raw);
        else if (c.accept("type")) createType(c, schema);
        else if (c.accept("database") || c.accept("schema")) createDatabase(c, schema);
        else if (c.accept("collation")) createCollation(c, schema);
        else if (c.accept("sequence")) createSequence(c, schema);
        else schema.ignored++;
      } else if (c.accept("alter", "table")) {
        alterTable(c, schema, statement);
      } else if (c.accept("alter", "sequence")) {
        alterSequence(c, schema);
      } else if (c.accept("comment", "on")) {
        commentOn(c, schema);
      } else if (c.accept("exec") || c.accept("execute")) {
        extendedProperty(c, schema);
      } else {
        schema.ignored++;
      }
    } catch {
      schema.skipped.push(joinRaw(statement.slice(0, 8)));
    }
  }
  resolveSequences(schema);
  return schema;
}

/**
 * Valeur de séquence ou compteur (O-39) : une séquence non déclarée dans le script, ou nommée
 * table_colonne_seq (pg_dump, SERIAL), fait de la colonne un compteur. OWNED BY seul n'en fait pas un
 * compteur : une séquence nommée peut appartenir à la colonne qu'elle alimente (O-40).
 */
function resolveSequences(schema: ParsedSchema) {
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (!column.sequence || column.sequence.trigger) continue;
      const declared = schema.sequences.get(column.sequence.name.toLowerCase());
      if (!declared || column.sequence.name.toLowerCase() === `${table.name}_${column.name}_seq`.toLowerCase()) {
        column.autoIncrement = true;
        delete column.sequence;
        // Séquence absorbée par le compteur (SERIAL) : elle appartient à la colonne.
        if (declared) declared.ownedBy ??= { table: table.name, column: column.name };
      }
    }
  }
}

/** Clauses de stockage (Oracle, PostgreSQL) reconnues après la définition d'une table ou d'un index. */
const STORAGE_CLAUSES = new Set([
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

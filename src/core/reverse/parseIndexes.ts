import { type Cursor, isWord, joinRaw } from "./cursor";
import type { ParsedSchema } from "./parse";
import { columnList, indexBody } from "./parseKeys";
import { findTable, STORAGE_CLAUSES } from "./parseTables";

/** CREATE [UNIQUE] INDEX nom ON table (colonnes) : index, ou identifiant alternatif si UNIQUE. */
export function createIndex(c: Cursor, schema: ParsedSchema, unique: boolean, kind?: "fulltext" | "spatial"): void {
  let clustered = false;
  while (isWord(c.peek(), "clustered", "nonclustered")) {
    clustered = isWord(c.next(), "clustered") || clustered;
  }
  if (!c.accept("index")) {
    schema.ignored += 1;
    return;
  }
  c.accept("concurrently");
  while (isWord(c.peek(), "if", "not", "exists")) {
    c.next();
  }
  const name = isWord(c.peek(), "on") ? undefined : (c.qualifiedName() ?? undefined);
  if (!c.accept("on")) {
    schema.ignored += 1;
    return;
  }
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
  if (key && c.accept("include")) {
    key.include = columnList(c.group());
  }
  if (table && clustered && !table.storage.includes("CLUSTERED")) {
    table.storage.push("CLUSTERED");
  }
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
      if (label.startsWith("WITH")) {
        c.skipGroup();
      } else {
        c.qualifiedName();
      }
      if (!table.storage.includes(label)) {
        table.storage.push(label);
      }
      continue;
    }
    const word = c.next()!;
    if (table && word.type === "word" && STORAGE_CLAUSES.has(word.value.toLowerCase())) {
      const label = `INDEX ${word.value.toUpperCase()}`;
      if (!table.storage.includes(label)) {
        table.storage.push(label);
      }
    }
    if (isWord(word, "storage", "with")) {
      c.skipGroup();
    } else if (isWord(word, "tablespace")) {
      c.next(); // nom du tablespace
    }
  }
  if (!(table && key && c.done())) {
    schema.ignored += 1;
    return;
  }
  if (kind) {
    key.kind = kind;
  }
  if (key.method === "gin" && key.kind === "fulltext") {
    delete key.method;
  }
  if (unique) {
    table.uniques.push({ name, ...key });
  } else {
    table.indexes.push({ name, ...key });
  }
}

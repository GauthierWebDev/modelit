import { sqlType } from "../dbms/typeMapping";
import type { LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import { MSG } from "../validation/messages";
import type { Context } from "./context";
import { referencedColumns } from "./expressions";
import type { Usage } from "./targets";

/**
 * Deux types équivalents pour le catalogue : ni la collation ni le jeu de caractères (ASCII ou
 * Unicode, propriété de la base plus que de la colonne) ne sont une perte de structure.
 */
export function sameType(a: DataType | undefined, b: DataType | undefined) {
  // MONEY ≡ DECIMAL(19,4) (O-42).
  const strip = (t: DataType | undefined) =>
    t && t.kind === "text"
      ? { ...t, collation: undefined, encoding: t.encoding === "binary" ? "binary" : "char" }
      : t?.kind === "money"
        ? { kind: "decimal", precision: 19, scale: 4 }
        : t;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/** Emplois d'une colonne : comparée dans un CHECK, ou membre d'une clé ou d'un index. */
export function usage(table: LogicalTable, column: string): Usage {
  const lower = column.toLowerCase();
  const cites = (expression: string) => referencedColumns(expression).some((c) => c.toLowerCase() === lower);
  const self = table.columns.find((c) => c.name === column);
  const keys = [
    table.primaryKey,
    ...table.uniques.map((u) => u.columns),
    ...table.indexes.map((i) => i.columns),
    ...table.foreignKeys.map((fk) => fk.columns),
  ];
  return {
    compared: Boolean(self?.check && cites(self.check.expression)) || table.checks.some((c) => cites(c.expression)),
    keyed: Boolean(self?.unique) || keys.some((k) => k.some((c) => c.toLowerCase() === lower)),
  };
}

/** Équivalents des types libres courants (UUID, JSON, INTERVAL) ; sinon texte, avec perte. */
export function freeTypeFallback(ctx: Context, sql: string): { sql: string; lossy: boolean; loss?: string } {
  const base = sql
    .trim()
    .toLowerCase()
    .replace(/\(.*\)/, "");
  const { free } = ctx.dialect.types;
  // ROWVERSION / TIMESTAMP SQL Server : numéro de version automatique, sans équivalent (O-41).
  if (base === "rowversion" && free.rowversion) {
    return { sql: free.rowversion, lossy: false, loss: MSG.lossRowversion(free.rowversion) };
  }
  // INTERVAL Oracle → PostgreSQL : la précision du premier champ (jours, années) n'y existe pas (O-39).
  const interval = /^interval\s+(day|year)\s*(?:\(\s*(\d+)\s*\))?\s+to\s+(second|month)\s*(?:\(\s*(\d+)\s*\))?$/i.exec(
    sql.trim(),
  );
  if (interval && free.intervals) {
    const [, first, , last, fraction] = interval;
    const emitted = `INTERVAL ${first!.toUpperCase()} TO ${last!.toUpperCase()}${fraction === undefined ? "" : `(${fraction})`}`;
    return { sql: emitted, lossy: false, loss: MSG.lossIntervalDays(sql.trim(), emitted) };
  }
  const known =
    base === "uuid" || base === "uniqueidentifier"
      ? free.uuid
      : base === "json" || base === "jsonb"
        ? free.json
        : undefined;
  if (known) {
    return { sql: known, lossy: !["uuid", "json", "jsonb", "uniqueidentifier"].includes(known.toLowerCase()) };
  }
  const { dbms, version, custom } = ctx.target;
  const text = sqlType({ kind: "text", encoding: "unicode", length: "large" }, dbms, version, custom?.types) ?? "TEXT";
  return { sql: text, lossy: true };
}

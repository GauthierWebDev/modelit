import { tokenize } from "../reverse/tokenize";
import type { DateFunction, SpecialFunction } from "./dialects";
import { KEYWORDS, operand, Reader } from "./expressionOperands";
import { orExpression } from "./expressionParser";

/**
 * Expressions SQL simples des CHECK et des DEFAULT (override O-29) : lues sous forme structurée
 * pour être réécrites dans un autre dialecte.
 *
 * Forme structurée reconnue : comparaisons à une constante ou à une colonne, IN (liste),
 * BETWEEN, IS [NOT] NULL, LIKE, combinées par AND / OR / NOT et parenthèses ; littéraux
 * (nombres, chaînes, booléens, NULL) et fonctions de date courantes. Toute autre expression
 * (fonctions, calculs…) reste brute : réémise telle quelle vers le même dialecte seulement.
 */

export {
  asciiDomain,
  excludesEmptyString,
  impliesNonNegative,
  type TypeFamily,
  typeConflict,
  type ValueBounds,
  valueBounds,
} from "./expressionAnalysis";
export { renderCondition, renderOperand } from "./expressionRender";

export type Operand =
  | { kind: "column"; name: string; quoted: boolean }
  | { kind: "number"; value: string }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "date"; fn: DateFunction }
  /** Utilisateur courant, identifiant universel (O-39). */
  | { kind: "function"; fn: SpecialFunction }
  /** Longueur en caractères : LEN (SQL Server), LENGTH, CHAR_LENGTH (O-42). */
  | { kind: "length"; arg: Operand };

export type Condition =
  | { kind: "and" | "or"; items: Condition[] }
  | { kind: "not"; item: Condition }
  | { kind: "compare"; left: Operand; op: string; right: Operand }
  | { kind: "in"; operand: Operand; values: Operand[]; negated: boolean }
  | { kind: "between"; operand: Operand; low: Operand; high: Operand; negated: boolean }
  | { kind: "isNull"; operand: Operand; negated: boolean }
  | { kind: "like"; operand: Operand; pattern: Operand; negated: boolean }
  /**
   * Expression rationnelle ancrée (PostgreSQL ~, ~*), traduction d'un LIKE SQL Server à classes
   * [..] / [^..] ; `insensitive` : sous collation insensible à la casse (~*) (O-42).
   */
  | { kind: "regex"; operand: Operand; pattern: string; negated: boolean; insensitive: boolean; collateC?: boolean }
  /** ISJSON(x) = 1 (SQL Server), x IS JSON (PostgreSQL 16+, Oracle) (O-42). */
  | { kind: "isJson"; operand: Operand; negated: boolean };

/**
 * Motif LIKE SQL Server à classes ([A-Z], [^A-Z]) → expression rationnelle ancrée équivalente :
 * % → .*, _ → ., classes recopiées, autres caractères spéciaux échappés. `null` sans classe (O-42).
 */
export function likeToRegex(pattern: string): string | null {
  if (!/\[[^\]]*\]/.test(pattern)) {
    return null;
  }
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === "%") {
      out += ".*";
    } else if (ch === "_") {
      out += ".";
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) {
        return null;
      }
      out += `[${pattern.slice(i + 1, end).replace(/\\/g, "\\\\")}]`;
      i = end;
    } else {
      out += /[.^$*+?(){}|\\]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return `${out}$`;
}

/** Forme structurée d'une condition CHECK, ou `null` si elle sort du sous-ensemble reconnu. */
export function parseCondition(expression: string): Condition | null {
  try {
    const r = new Reader(tokenize(expression).filter((t) => t.type !== "end"));
    const condition = orExpression(r);
    return r.i === r.tokens.length ? condition : null;
  } catch {
    return null;
  }
}

/** Forme structurée d'une valeur par défaut (littéral ou fonction de date), ou `null`. */
export function parseDefault(expression: string): Operand | null {
  // (now() AT TIME ZONE 'UTC') / CURRENT_TIMESTAMP AT TIME ZONE 'UTC' : heure UTC (O-42).
  if (/^\(*\s*(now\s*\(\s*\)|current_timestamp)\s+at\s+time\s+zone\s+'utc'\s*\)*$/i.test(expression.trim())) {
    return { kind: "date", fn: "utc_timestamp" };
  }
  try {
    let tokens = tokenize(expression).filter((t) => t.type !== "end");
    // (CURRENT_DATE) : parenthèses englobantes (MySQL)
    while (tokens.length >= 3 && tokens[0]!.value === "(" && tokens.at(-1)!.value === ")") {
      tokens = tokens.slice(1, -1);
    }
    const r = new Reader(tokens);
    const value = operand(r);
    return r.i === r.tokens.length && value.kind !== "column" ? value : null;
  } catch {
    return null;
  }
}

/** Colonnes citées par une expression (pour rattacher un CHECK à une colonne). */
export function referencedColumns(expression: string): string[] {
  const tokens = tokenize(expression);
  const names = new Set<string>();
  tokens.forEach((t, i) => {
    if (t.type === "quoted") {
      names.add(t.value);
    } else if (t.type === "word" && !KEYWORDS.has(t.value.toLowerCase()) && tokens[i + 1]?.value !== "(") {
      names.add(t.value);
    }
  });
  return [...names];
}

// ---------------------------------------------------------------------------------------------
// Écriture

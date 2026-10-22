import {
  asciiDomain,
  type Condition,
  excludesEmptyString,
  impliesNonNegative,
  parseCondition,
  valueBounds,
} from "../ddl/expressions";
import type { SqlDialect } from "../model/physical";
import type { NamedExpression, ParsedTable } from "../reverse/parse";
import { canonicalCondition } from "./catalogCanonical";
import { domainCheck } from "./catalogColumns";

/**
 * Ce que les CHECK d'une table disent de ses colonnes (domaines, positivité, bornes, chaîne vide,
 * ASCII), et les CHECK qui restent des contraintes. Colonnes repérées par leur nom en minuscules.
 */
export interface CheckFacts {
  domains: Map<string, string>;
  nonNegative: Set<string>;
  /** Bornes d'une colonne : YEAR (MySQL : 1901–2155), BETWEEN à bornes numériques (O-38). */
  bounds: Map<string, [bigint | null, bigint | null]>;
  nonEmpty: Set<string>;
  ascii: Set<string>;
  checks: (NamedExpression & { canonical?: boolean })[];
}

/** CHECK de domaine / positivité : propriétés des colonnes, pas des contraintes. */
export function checkFacts(table: ParsedTable, dialect: SqlDialect): CheckFacts {
  const allChecks: NamedExpression[] = [...table.checks, ...table.columns.filter((c) => c.check).map((c) => c.check!)];
  // Une contrainte désactivée (Oracle DISABLE) ne contraint pas les valeurs (O-39).
  const activeChecks = allChecks.filter((c) => !c.state?.disabled);
  const facts: CheckFacts = {
    domains: new Map(),
    nonNegative: new Set(),
    bounds: new Map(),
    nonEmpty: new Set(),
    ascii: new Set(),
    checks: [],
  };
  // Tout CHECK actif borne les valeurs des colonnes qu'il contraint (ex. est_cadre IN (0, 1)) (O-39).
  for (const check of activeChecks) {
    const condition = parseCondition(check.expression);
    if (condition) {
      activeFacts(table, condition, facts);
    }
  }
  if (dialect === "mysql" || dialect === "mariadb") {
    for (const c of table.columns) {
      if (/^year\b/i.test(c.type)) {
        bound(facts, c.name, 1901n, 2155n);
      }
    }
  }
  for (const check of allChecks) {
    classifyCheck(table, check, facts);
  }
  return facts;
}

function activeFacts(table: ParsedTable, condition: Condition, facts: CheckFacts) {
  for (const column of table.columns) {
    const b = valueBounds(condition, column.name);
    if (b !== "none" && (b.lo !== null || b.hi !== null)) {
      bound(facts, column.name, b.lo, b.hi);
    }
    if (excludesEmptyString(condition, column.name)) {
      facts.nonEmpty.add(column.name.toLowerCase());
    }
    if (asciiDomain(condition, column.name)) {
      facts.ascii.add(column.name.toLowerCase());
    }
  }
}

/** Bornes cumulées : la plus haute des minimales, la plus basse des maximales. */
function bound(facts: CheckFacts, column: string, lo: bigint | null, hi: bigint | null) {
  const k = column.toLowerCase();
  const old = facts.bounds.get(k);
  const max = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a > b ? a : b);
  const min = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a < b ? a : b);
  facts.bounds.set(k, old ? [max(lo, old[0]), min(hi, old[1])] : [lo, hi]);
}

const numericBetween = (c: Condition) =>
  c.kind === "between" &&
  !c.negated &&
  c.operand.kind === "column" &&
  c.low.kind === "number" &&
  c.high.kind === "number" &&
  /^-?\d+$/.test(c.low.value) &&
  /^-?\d+$/.test(c.high.value)
    ? { column: c.operand.name, lo: BigInt(c.low.value), hi: BigInt(c.high.value) }
    : null;

/** Un CHECK : propriété d'une colonne (domaine, positivité, plage) ou contrainte gardée. */
function classifyCheck(table: ParsedTable, check: NamedExpression, facts: CheckFacts) {
  const condition = parseCondition(check.expression);
  // Tout CHECK qui exclut les négatifs d'une colonne (ex. niveau BETWEEN 1 AND 3) borne sa plage.
  if (condition && !check.state?.disabled) {
    nonNegativeFacts(table, condition, facts);
  }
  const special = check.state ? null : domainCheck(check);
  if (special?.domain) {
    facts.domains.set(special.column.toLowerCase(), special.domain);
    return;
  }
  if (special?.nonNegative) {
    facts.nonNegative.add(special.column.toLowerCase());
    return;
  }
  if (special?.nonEmpty) {
    return;
  }
  // BETWEEN anonyme seul, ou conjoint d'un AND (ex. ck_annee fusionné avec la plage de YEAR) : une plage.
  const alone = !check.name && condition ? numericBetween(condition) : null;
  if (alone) {
    bound(facts, alone.column, alone.lo, alone.hi);
    return;
  }
  if (condition?.kind === "and" && andRanges(check, condition.items, facts)) {
    return;
  }
  facts.checks.push(check);
}

function nonNegativeFacts(table: ParsedTable, condition: Condition, facts: CheckFacts) {
  for (const column of table.columns) {
    if (impliesNonNegative(condition, column.name)) {
      facts.nonNegative.add(column.name.toLowerCase());
    }
  }
}

/** Conjoints BETWEEN d'un AND retirés en plages ; le reste gardé comme CHECK. Vrai si un conjoint l'était. */
function andRanges(check: NamedExpression, items: Condition[], facts: CheckFacts): boolean {
  const rest = items.filter((item) => {
    const b = numericBetween(item);
    if (b) {
      bound(facts, b.column, b.lo, b.hi);
    }
    return !b;
  });
  if (rest.length === items.length) {
    return false;
  }
  facts.checks.push({
    name: check.name,
    expression: JSON.stringify(canonicalCondition(rest.length === 1 ? rest[0]! : { kind: "and", items: rest })),
    canonical: true,
  });
  return true;
}

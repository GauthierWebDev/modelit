// biome-ignore-all lint/suspicious/noBitwiseOperators: empreinte FNV-1a des noms raccourcis
import type { Dbms } from "../dbms/dbms";
import type { TypeTemplates } from "../dbms/typeMapping";
import type { ReferentialAction, SqlDialect } from "../model/physical";
import type { DocumentSettings } from "../model/settings";
import { dialectOf } from "./targets";
import type { DateFunction, SpecialFunction } from "./targets/dialect";

export type { DateFunction, SpecialFunction } from "./targets/dialect";

/**
 * Capacités des SGBD cibles pour la génération du script (override O-29) : mots réservés,
 * actions référentielles, longueur des identifiants, fonctions de date. Les valeurs de chaque SGBD
 * sont dans son dialecte (targets/<sgbd>.ts) ; ces fonctions en sont l'accès.
 * Sources : documentations officielles de chaque SGBD.
 */

export interface Target {
  dbms: Dbms;
  version?: string;
  /** SGBD personnalisé basé sur `dbms` / `version` (override O-59) : nom et types redéfinis. */
  custom?: { name: string; types: TypeTemplates };
}

/** Cible de génération d'un modèle, personnalisation comprise (O-59). */
export const targetOf = (s: Pick<DocumentSettings, "dbms" | "dbmsVersion" | "customDbms">): Target => ({
  dbms: s.dbms,
  version: s.dbmsVersion,
  ...(s.customDbms ? { custom: { name: s.customDbms.name, types: s.customDbms.types } } : {}),
});

/** Même dialecte : l'expression ou le type d'origine peut être réémis tel quel. */
export function sameDialect(source: SqlDialect | undefined, target: Dbms) {
  if (!source) {
    return false;
  }
  const family = (d: SqlDialect) => (d === "mariadb" ? "mysql" : d);
  return family(source) === family(target);
}

// ---------------------------------------------------------------------------------------------
// Identifiants

export const isReserved = (dbms: Dbms, name: string) =>
  dialectOf({ dbms }).identifiers.reserved.has(name.toLowerCase());

/**
 * Identifiant tel qu'il doit être écrit pour la cible : entre délimiteurs s'il contient des
 * caractères spéciaux, s'il est un mot réservé de la cible, ou si sa casse est significative
 * (`caseSensitive`) et ne survit pas au repli de casse de la cible.
 */
export function quoteIdentifier(target: Target, name: string, caseSensitive = false): string {
  const { folding, quotes } = dialectOf(target).identifiers;
  const plain = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
  const folded = folding === "lower" ? name.toLowerCase() : folding === "upper" ? name.toUpperCase() : name;
  const caseLost = caseSensitive && folding !== undefined && folded !== name;
  if (plain && !caseLost && !isReserved(target.dbms, name)) {
    return name;
  }
  const [open, close] = quotes;
  return `${open}${name.replaceAll(close, close + close)}${close}`;
}

// ---------------------------------------------------------------------------------------------
// Longueur des noms

/** Longueur maximale d'un identifiant (octets / caractères selon le SGBD). */
export const maxIdentifierLength = (target: Target): number => dialectOf(target).identifiers.maxLength;

/** Raccourcit un nom trop long en gardant un suffixe stable (empreinte du nom complet). */
export function fitName(name: string, max: number): string {
  if (new TextEncoder().encode(name).length <= max) {
    return name;
  }
  let hash = 2166136261;
  for (const c of name) {
    hash = Math.imul(hash ^ c.codePointAt(0)!, 16777619) >>> 0;
  }
  const suffix = `_${hash.toString(16).padStart(8, "0")}`;
  let head = name;
  while (new TextEncoder().encode(head + suffix).length > max) {
    head = head.slice(0, -1);
  }
  return head + suffix;
}

// ---------------------------------------------------------------------------------------------
// Actions référentielles

type Event = "delete" | "update";

export type ActionResult =
  | { kind: "emit"; sql: string }
  /** Équivalent au comportement par défaut : rien à écrire, rien de perdu. */
  | { kind: "implicit" }
  /** Non pris en charge : remplacé par `fallback` (souvent NO ACTION). */
  | { kind: "degraded"; sql: string; fallback: ReferentialAction };

export function referentialAction(target: Target, event: Event, action: ReferentialAction): ActionResult {
  const actions = dialectOf(target).actions;
  const supported = actions[event];
  if (supported.includes(action)) {
    return { kind: "emit", sql: `ON ${event.toUpperCase()} ${action.toUpperCase()}` };
  }
  if (action === "no action" || actions.implicit.includes(action)) {
    return { kind: "implicit" };
  }
  // RESTRICT → NO ACTION là où RESTRICT n'existe pas (SQL Server) : écrit explicitement.
  if (action === "restrict" && supported.includes("no action")) {
    return { kind: "degraded", sql: `ON ${event.toUpperCase()} NO ACTION`, fallback: "no action" };
  }
  return { kind: "degraded", sql: "", fallback: "no action" };
}

// ---------------------------------------------------------------------------------------------
// Divers

/** ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY possible (pas en SQLite). */
export const supportsAlterForeignKey = (target: Target) => dialectOf(target).constraints.alterForeignKey;

/** CHECK appliqué (MySQL l'ignore avant 8.0.16). */
export const enforcesCheck = (target: Target) => dialectOf(target).constraints.enforcedChecks;

/** Littéraux booléens TRUE / FALSE disponibles. */
export const hasBooleanLiterals = (target: Target): boolean => dialectOf(target).expressions.booleanLiterals;

/** Fonctions de date / heure courantes, écrites dans le dialecte cible (`null` : non disponible). */
export const dateFunction = (target: Target, fn: DateFunction): string | null =>
  dialectOf(target).expressions.dates[fn];

/** Fonction spéciale écrite dans le dialecte cible (`null` : non disponible en DEFAULT). */
export const specialFunction = (target: Target, fn: SpecialFunction): string | null =>
  dialectOf(target).expressions.functions[fn];

/** Affinité SQLite d'un type déclaré (documentation SQLite, « Datatypes », §3.1). */
export function sqliteAffinity(type: string): "INTEGER" | "TEXT" | "BLOB" | "REAL" | "NUMERIC" {
  const t = type.toUpperCase();
  if (t.includes("INT")) {
    return "INTEGER";
  }
  if (/CHAR|CLOB|TEXT/.test(t)) {
    return "TEXT";
  }
  if (t.includes("BLOB") || !t.trim()) {
    return "BLOB";
  }
  if (/REAL|FLOA|DOUB/.test(t)) {
    return "REAL";
  }
  return "NUMERIC";
}

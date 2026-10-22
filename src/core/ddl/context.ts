import type { LogicalColumn, LogicalKey, LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import type { CheckConstraint } from "../model/physical";
import type { DdlOptions } from "../model/settings";
import { maxIdentifierLength, type Target } from "./dialects";
import { parseCondition } from "./expressions";
import { LossReport } from "./losses";
import { type Dialect, dialectOf } from "./targets";

/** Options de génération dont le script dépend. */
export type Options = Pick<
  DdlOptions,
  | "foreignKeysInAlter"
  | "indexes"
  | "constraintNaming"
  | "unsigned"
  | "enums"
  | "sets"
  | "collations"
  | "oracleDates"
  | "emptyStrings"
  | "strictRanges"
  | "spatial"
  | "sqlServerCollation"
  | "dboSchema"
>;

export const DEFAULT_OPTIONS: Options = {
  foreignKeysInAlter: false,
  indexes: true,
  constraintNaming: "none",
  unsigned: "widen",
  enums: "check",
  sets: "array",
  collations: "icu",
  oracleDates: "timestamp",
  emptyStrings: "check",
  strictRanges: false,
  spatial: "postgis",
  sqlServerCollation: "ci_as",
  dboSchema: "public",
};

/** État d'une génération, partagé par les modules du script. */
export interface Context {
  readonly target: Target;
  /** Règles propres au SGBD cible. */
  readonly dialect: Dialect;
  readonly options: Options;
  readonly report: LossReport;
  /** Longueur maximale d'un identifiant pour la cible. */
  readonly maxName: number;
  /** Instructions hors CREATE TABLE, par section du script. */
  readonly script: {
    /** Avant les tables : extensions, collations, types énumérés, séquences. */
    preamble: string[];
    schemas: string[];
    /** Contraintes ajoutées sans valider les lignes existantes (NOT VALID / ENABLE NOVALIDATE), après les tables. */
    notValidated: string[];
    /** Après les tables : index sur expression, commentaires, déclencheurs. */
    epilogue: string[];
    /** Options de fin de CREATE TABLE (MySQL : AUTO_INCREMENT = n). */
    tableOptions: Map<LogicalTable, string>;
  };
  /** Noms déjà employés (en minuscules). */
  readonly used: {
    names: Set<string>;
    schemas: Set<string>;
    sequences: Set<string>;
    /** Nombre de colonnes alimentées par chaque séquence. */
    sequenceUsers: Map<string, number>;
  };
}

export function createContext(target: Target, options: Options): Context {
  return {
    target,
    dialect: dialectOf(target),
    options,
    report: new LossReport(),
    maxName: maxIdentifierLength(target),
    script: { preamble: [], schemas: [], notValidated: [], epilogue: [], tableOptions: new Map() },
    used: { names: new Set(), schemas: new Set(), sequences: new Set(), sequenceUsers: new Map() },
  };
}

export const INDENT = "   ";

export const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const describeKey = (key: LogicalKey) =>
  `(${key.columns.map((c, i) => (key.prefixes?.[i] ? `${c}(${key.prefixes[i]})` : c)).join(", ")})`;

export const describe = (type: DataType) => JSON.stringify(type);

/** Conditions des CHECK actifs de la colonne et de la table (une contrainte désactivée ne protège rien, O-42). */
export function activeConditions(table: LogicalTable, column: LogicalColumn) {
  return [column.check, ...table.checks]
    .filter((c): c is CheckConstraint => Boolean(c) && !c!.state?.disabled)
    .map((c) => parseCondition(c.expression))
    .filter((c) => c !== null);
}

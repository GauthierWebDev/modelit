import type { Dbms } from "../../dbms/dbms";
import type { ReferentialAction } from "../../model/physical";
import type {
  ActionRules,
  CollationRules,
  ColumnRules,
  ConstraintRules,
  CounterRules,
  ExpressionRules,
  GeneratedRules,
  IdentifierRules,
  IndexRules,
  SchemaRules,
  SequenceRules,
  TypeRules,
  UniqueRules,
} from "./rules";

/**
 * Ce que le script fait différemment selon le SGBD cible : une implémentation par SGBD
 * (`targets/<sgbd>.ts`), construite pour une version (`dialectOf`, `targets/index.ts`).
 * Ajouter un SGBD, c'est ajouter un fichier ici, sans toucher aux modules du script.
 *
 * Chaque section ne sert qu'à un module : schémas (naming.ts), types et compteurs (types.ts),
 * séquences (sequences.ts), colonnes (columns.ts), contraintes (constraints.ts, checks.ts),
 * UNIQUE et index (constraints.ts, indexes.ts) ; identifiants, actions référentielles, expressions
 * (dialects.ts) et collations (collation.ts). `standard` donne le comportement du SQL de base ;
 * identifiants, actions et expressions sont propres à chaque SGBD.
 */
export type { CollationResult, ConstraintKind, DateFunction, SequenceRules, SpecialFunction, Usage } from "./rules";

export interface Dialect {
  readonly dbms: Dbms;
  /** Schémas nommés (O-42) ; `null` : sans schémas (le schéma d'origine est abandonné, signalé). */
  readonly schemas: SchemaRules | null;
  readonly types: TypeRules;
  readonly counters: CounterRules;
  /** Séquences (O-39) ; `null` : sans séquences (la valeur par défaut est abandonnée, signalée). */
  readonly sequences: SequenceRules | null;
  /** Colonnes calculées (O-35) ; `null` : sans colonnes calculées (colonne ordinaire, signalé). */
  readonly generated: GeneratedRules | null;
  readonly columns: ColumnRules;
  readonly constraints: ConstraintRules;
  readonly uniques: UniqueRules;
  readonly indexes: IndexRules;
  /** Commentaires : dans la définition (COMMENT '…'), en instructions COMMENT ON, ou abandonnés (signalés). */
  readonly comments: "inline" | "statement" | null;
  /** Partitionnement déclaratif : jamais transposé, le rapport le précise (O-39). */
  readonly partitioning: boolean;
  /** Déclencheur réémis vers le même dialecte (corps sans point-virgule final). */
  trigger: (body: string) => string;
  readonly identifiers: IdentifierRules;
  /** Actions référentielles acceptées, par événement (O-29). */
  readonly actions: ActionRules;
  /** Écriture des expressions de CHECK et de DEFAULT (O-29, O-39). */
  readonly expressions: ExpressionRules;
  /** Collation de chaque classe de comparaison (O-35, O-37). */
  readonly collations: CollationRules;
}

/** Mots réservés communs (SQL standard), complétés par SGBD (`reservedWords`). */
const COMMON = `add all alter and any as asc between both by case cast check collate column constraint create cross
current_date current_time current_timestamp current_user default delete desc distinct drop else end except exists
false fetch for foreign from full grant group having in inner insert intersect into is join leading left like not
null of on or order outer primary references right select set some table then to trailing true union unique update
user using values when where with`;

/** Mots réservés d'un SGBD : les mots communs et les siens. */
export const reservedWords = (specific: string): ReadonlySet<string> =>
  new Set(`${COMMON} ${specific}`.split(/\s+/).filter(Boolean));

/** Toutes les actions référentielles. */
export const ALL_ACTIONS: readonly ReferentialAction[] = [
  "cascade",
  "set null",
  "set default",
  "restrict",
  "no action",
];

/** Comportement du SQL de base, que chaque SGBD complète ou corrige. */
export const standard: Omit<Dialect, "dbms" | "identifiers" | "actions" | "expressions"> = {
  schemas: null,
  types: {
    nativeDomains: false,
    enumTypes: false,
    setArrays: false,
    unsigned: false,
    tinyintBoolean: false,
    yearRange: true,
    unboundedDecimal: { precision: 38, scale: 10 },
    negativeScale: false,
    boundedText: () => undefined,
    affinities: false,
    postgis: false,
    emptyStringIsNull: false,
    textLength: (sql) => sql,
    nondeterministicCollations: false,
    free: { rowversion: "VARBINARY(8)", intervals: false },
  },
  counters: { rejectsExplicitValues: false, nullTakesNextValue: false, onNullIdentity: false },
  sequences: null,
  generated: {
    virtual: true,
    stored: true,
    typed: true,
    clause: (expression, stored) => `GENERATED ALWAYS AS (${expression})${stored ? " STORED" : " VIRTUAL"}`,
  },
  columns: { onUpdate: false, inlineCounterKey: false, primaryKeyNotNull: false },
  constraints: {
    strictCheckTyping: false,
    regex: false,
    deferrable: () => false,
    notValidated: () => false,
    notValidatedSuffix: " NOT VALID",
    singleCascadePath: false,
    alterForeignKey: true,
    enforcedChecks: true,
  },
  uniques: { methods: false, singleNull: false, equalNulls: null, include: false },
  indexes: {
    expressions: false,
    parenthesizedExpressions: false,
    partial: null,
    nativeKinds: false,
    nativePrefixes: false,
    fulltextGin: false,
    prefix: () => null,
    method: null,
    include: false,
  },
  comments: null,
  partitioning: false,
  trigger: (body) => `${body};`,
  collations: { sensitive: "", binary: null, insensitive: () => ({ kind: "dropped" }) },
};

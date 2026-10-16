/**
 * Messages du cœur métier, en français et en anglais (override O-23).
 *
 * Fautes d'accord corrigées (« Le cardinalité » → « La cardinalité »).
 *
 * Vocabulaire par couche (override O-24) : le MCD parle d'entités, de rubriques et de
 * discriminants ; le MLD et le MPD de tables, de colonnes et de clés primaires. Un problème
 * qui concerne les deux couches a deux formulations (`…Conceptual` / `…Logical`) ; le terme
 * « identifiant » est réservé à la case à cocher des rubriques.
 *
 * `MSG` désigne le catalogue de la langue courante (liaison ES « vivante ») ; l'interface
 * change de langue avec `setMessagesLocale`.
 */

/** Mot du dialecte d'origine pour une contrainte désactivée / non validée (O-42). */
const disabledWord = (dialect?: string) => (dialect === "sqlserver" ? "NOCHECK CONSTRAINT" : "DISABLE");
const notValidatedWord = (dialect?: string) => (dialect === "sqlserver" ? "WITH NOCHECK" : dialect === "postgresql" ? "NOT VALID" : "NOVALIDATE");

const FR = {
  entityNameTaken: "Nom de l'entité déjà existant",
  associationNameTaken: "Nom de l'association déjà existant",
  duplicateAttributes: "Il existe des doublons dans les rubriques.",
  maxLowerThanMin: "La cardinalité Max doit être supérieure ou égale à la cardinalité Min.",
  incoherentCardinalities: "Les cardinalités Min et Max sont incohérentes.",
  associationNeedsTwoLegs: "Attention ! Une association doit posséder au moins 2 pattes",
  bothSidesOneOne: "Une association ne peut pas avoir des cardinalités 1,1 de part et d'autre",
  attributesNeedTable:
    "Seules les associations générant une table de correspondance peuvent être porteuses de rubriques",
  oneOneForbiddenWithAttributes:
    "La cardinalité 1,1 est interdite lorsque l'association est porteuse de rubriques",
  circularReferences: "Attention ! Références circulaires",
  sqlBlocked: "Impossible de générer le script SQL : voir les erreurs dans le MLD textuel",
  // héritage (O-18, O-27) : entité générique et entités spécialisées
  inheritanceNeedsParent: "Il faut une entité générique",
  inheritanceNeedsTwoChildren: "Il faut au moins une entité spécialisée",
  newerFile: "Attention, ce fichier a été enregistré par une version plus récente de l'application, sa lecture sera aléatoire !",

  // propres à l'application
  emptyName: "Le nom ne peut pas être vide.",
  missingKeyConceptual: (entity: string) => `L'entité « ${entity} » n'a pas de discriminant.`,
  missingKeyLogical: (table: string) => `CLE_ABSENTE : la table « ${table} » n'a pas de clé primaire.`,
  duplicateEntityName: (name: string) => `Nom de l'entité déjà existant : « ${name} »`,
  duplicateAssociationName: (name: string) => `Nom de l'association déjà existant : « ${name} »`,
  duplicateAttributesIn: (owner: string) => `Il existe des doublons dans les rubriques de « ${owner} ».`,
  duplicateTableConceptual: (name: string) => `Plusieurs entités ou associations ont le même nom logique « ${name} ».`,
  duplicateTableLogical: (table: string) => `Plusieurs tables s'appellent « ${table} ».`,
  multipleParents: (entity: string) => `« ${entity} » est une entité spécialisée de plusieurs héritages.`,
  subtypeKeyConceptual: (entity: string) =>
    `« ${entity} » est une entité spécialisée : elle hérite du discriminant de son entité générique, ses propres discriminants sont ignorés.`,
  subtypeKeyLogical: (table: string) =>
    `« ${table} » est la table d'une entité spécialisée : sa clé primaire est celle de l'entité générique, ses autres colonnes de clé sont ignorées.`,
  alreadyInherits: "Cet héritage est déjà relié à cette entité.",
  alreadyLinked: "Cette association est déjà reliée à cette entité.",
  duplicateColumnConceptual: (owner: string, name: string) =>
    `Le nom « ${name} » est porté deux fois par « ${owner} » (rubrique ou clé étrangère) : renommez la clé étrangère.`,
  duplicateColumnLogical: (table: string, column: string) =>
    `Colonne « ${column} » en double dans la table « ${table} » : renommez la clé étrangère.`,
  untypedConceptual: (owner: string, attribute: string) => `La rubrique « ${attribute} » de « ${owner} » n'a pas de type.`,
  untypedLogical: (table: string, column: string) =>
    `La colonne « ${column} » de la table « ${table} » n'a pas de type : elle sera émise sans type dans le SQL.`,
  naryWithFunctionalLeg:
    "Règle de passage non encore prise en charge : association n-aire avec une patte de cardinalité max 1 (table générée par défaut).",
  genericVersion: "Générique (sans spécificité de version)",
  /** Ce qu'une version apporte à la génération (boîte « Cible », O-49). */
  versionFeature: {
    identity: "Compteurs en colonnes IDENTITY",
    include: "Colonnes couvertes des index (INCLUDE)",
    nondeterministicCollations: "Collations insensibles à la casse (ICU non déterministes)",
    genRandomUuid: "UUID par défaut avec gen_random_uuid()",
    nullsNotDistinct: "UNIQUE … NULLS NOT DISTINCT",
    negativeScale: "NUMERIC à échelle négative",
    isJson: "CHECK … IS JSON",
    uuidv7: "UUID séquentiels avec uuidv7()",
    virtualColumns: "Colonnes calculées virtuelles",
    longNames: "Noms jusqu'à 128 caractères (30 avant)",
    booleanType: "Type BOOLEAN natif",
    booleanLiterals: "Littéraux TRUE / FALSE",
    checkEnforced: "Contraintes CHECK appliquées",
  },
  fileUnreadable: "Le fichier n'est pas un modèle valide (JSON illisible).",
  fileNotModel: "Le fichier n'est pas un modèle de cette application.",
  noMigration: (version: number) => `Aucune migration depuis la version ${version}.`,
  // rétroconception (O-28)
  reverseUnreadable: (text: string) => `Instruction de table illisible, ignorée : ${text}…`,
  reverseUnknownTable: (table: string, referenced: string) =>
    `La clé étrangère de « ${table} » référence « ${referenced} », absente du script : elle est ignorée.`,
  reverseColumnMismatch: (table: string, referenced: string) =>
    `La clé étrangère de « ${table} » vers « ${referenced} » n'a pas le même nombre de colonnes que la clé référencée : elle est ignorée.`,
  reverseReferencesAssociation: (table: string, referenced: string) =>
    `« ${table} » référence la table d'association « ${referenced} » : ce lien ne peut pas être représenté dans le MCD.`,
  reverseSharedColumns: (table: string, columns: string) =>
    `« ${table} » : la clé étrangère réutilise la ou les colonnes ${columns} d'une autre clé. Le MCD ne sait pas l'exprimer ; le partage est conservé en annotation et réappliqué au SQL.`,
  // rapport de pertes du script (O-29)
  lossHeader: (target: string, count: number) => `Rapport de conversion vers ${target} : ${count} élément(s) abandonné(s) ou dégradé(s)`,
  lossType: (from: string, to: string) => `type ${from} → ${to} (pas d'équivalent exact)`,
  lossAutoIncrement: () => "auto-incrément abandonné : la cible ne le permet pas ici (colonne réduite à un entier)",
  lossDefault: (expression: string) => `DEFAULT ${expression} non traduit (abandonné)`,
  lossCheck: (expression: string) => `CHECK (${expression}) non traduit (laissé en commentaire)`,
  lossCheckNotEnforced: (expression: string) => `CHECK (${expression}) accepté mais non appliqué par cette version`,
  lossAction: (action: string, fallback: string) => `${action} non pris en charge → ${fallback}`,
  lossCascadePath: (event: string, action: string) =>
    `ON ${event} ${action} refusé (chemins de cascade multiples ou cycliques) → NO ACTION`,
  lossName: (name: string, fitted: string, max: number) => `nom « ${name} » raccourci en « ${fitted} » (${max} caractères au plus)`,
  lossAlterUnsupported: () => "option « clés étrangères en ALTER TABLE » ignorée : la cible ne sait pas ajouter une clé étrangère après coup",
  untranslatedCheck: (where: string, expression: string) => `CHECK non traduit (${where}) : ${expression}`,
  // O-36
  referenceNotEnforced: (association: string) =>
    `« ${association} » : la référence était écrite en ligne (col … REFERENCES), ce que MySQL n'applique pas — les données d'origine peuvent ne pas la respecter`,
  multivaluedAttribute: (owner: string, attribute: string) =>
    `« ${owner}.${attribute} » est multivalué (SET) : contraire à la première forme normale (une entité ou une association dédiée serait plus juste)`,
  nonAtomicAttribute: (owner: string, attribute: string) =>
    `« ${owner}.${attribute} » (JSON) n'est pas atomique : son contenu échappe au MCD`,
  prefixAlternateKey: (owner: string, key: string) =>
    `« ${owner} » : identifiant alternatif sur préfixe (${key}) — seuls les premiers caractères sont uniques`,
  // O-35
  lossCollation: (name: string) => `collation ${name} sans équivalent : non émise (collation par défaut de la base)`,
  lossCollationApprox: (name: string, detail: string) =>
    `collation ${name} approchée : ${
      detail === "like"
        ? "LIKE impossible sur cette colonne avant PostgreSQL 18"
        : detail === "nocase"
          ? "NOCASE n'ignore que la casse ASCII, les accents restent distingués"
          : detail === "language"
            ? "insensibilité conservée, règles propres à la langue (tri, lettres particulières) non reproduites"
            : detail === "deterministic"
              ? "collation déterministe par défaut (serveur sans ICU) : comparaisons et unicité sensibles à la casse et aux accents"
              : "les accents ne sont plus distingués"
    }`,
  lossSetArray: (): string => "SET → TEXT[] : l'ordre et les doublons, normalisés par MySQL, sont conservés tels que saisis",
  lossEnumCase: (insensitive: boolean): string =>
    insensitive
      ? "ENUM sous collation insensible : une valeur saisie dans une autre casse (ACTIF) est acceptée telle quelle, MySQL la ramenait à la valeur de l'ENUM (actif)"
      : "ENUM : une valeur saisie dans une autre casse (ACTIF) est refusée, MySQL la ramenait à la valeur de l'ENUM (actif)",
  lossTinyintBoolean: (to: string) => `TINYINT(1) → ${to} : MySQL y accepte d'autres valeurs que 0 / 1 (de −128 à 127) ; seuls vrai / faux restent`,
  lossCollationEnumType: (name: string) => `collation ${name} sans effet sur un type énuméré : comparaison exacte des valeurs`,
  lossSet: (values: string) => `SET(${values}) → TEXT : valeurs multiples et domaine non contrôlés`,
  lossUnsignedCheck: (from: string) => `UNSIGNED : ${from} conservé + CHECK (>= 0) ; la moitié haute de la plage est perdue`,
  lossMysqlTimestamp: (to: string) => `TIMESTAMP MySQL (UTC, plage 1970–2038) → ${to} : même sémantique de fuseau, plage plus large`,
  lossIdentityStart: (start: number) => `premier numéro du compteur (${start}) non transposable`,
  lossGenerated: (expression: string) => `colonne calculée (${expression}) non traduite : colonne ordinaire`,
  lossGeneratedMode: (from: string, to: string) => `colonne calculée ${from} → ${to} (${from} indisponible pour ce SGBD / cette version)`,
  lossCheckTypes: (expression: string, detail: string) => `CHECK (${expression}) incompatible avec le type des colonnes (${detail}) : laissé en commentaire`,
  lossGeneratedType: (type: string) => `colonne calculée : type ${type} non déclaré (SQL Server le déduit de l'expression)`,
  lossOnUpdate: (expression: string) => `ON UPDATE ${expression} non traduit : un déclencheur serait nécessaire`,
  lossIndexMethod: (name: string, method: string) => `méthode d'index ${method} de ${name} abandonnée (l'index ou la contrainte sont conservés)`,
  lossFulltextGin: (name: string) => `index plein texte ${name} → index GIN sur to_tsvector('simple', …) : approximation (requêtes MATCH … AGAINST à réécrire)`,
  lossIndexKind: (name: string, kind: string) => `index ${kind} ${name} sans équivalent : non émis`,
  lossPrefixKey: (name: string, unique: boolean) => `${unique ? "UNIQUE" : "index"} sur préfixe ${name} sans équivalent : non émis (jamais élargi à la colonne entière)`,
  lossComments: (count: number) => `${count} commentaire(s) non émis (pas de syntaxe pour ce SGBD)`,
  lossTrigger: (name: string) => `déclencheur ${name} non traduit (code propre au SGBD d'origine)`,
  // O-39 (Oracle)
  disabledComment: (dialect?: string): string => `désactivée (${disabledWord(dialect)}) dans la source : non appliquée`,
  lossDefaultNotNull: (expression: string): string =>
    `DEFAULT ${expression} non traduit sur une colonne NOT NULL : un INSERT sans valeur pour cette colonne échouera`,
  lossSqlServerIdentity: (): string => "IDENTITY (SQL Server) refuse une valeur fournie (sauf SET IDENTITY_INSERT), que la source acceptait",
  lossSqlServerCollation: (name: string): string =>
    `hypothèse : collation par défaut de la base SQL Server ${name} (absente du script), appliquée aux textes sans collation déclarée`,
  lossSpatialFallback: (type: string, to: string): string =>
    `${type} → ${to} (${to === "BYTEA" ? "WKB" : "WKT"}) sans extension PostGIS : fonctions et index spatiaux perdus`,
  lossSchema: (schema: string): string => `schéma ${schema} non transposable : tables créées dans le schéma courant`,
  lossSqlServerOption: (option: string): string => `${option} (option SQL Server) : sans équivalent, abandonnée`,
  lossDatetimeOffset: (to: string): string => `DATETIMEOFFSET → ${to} : le décalage horaire d'origine est perdu (valeur ramenée à l'UTC)`,
  lossSqlServerDatetime: (to: string): string => `DATETIME → ${to} : arrondi d'origine au 1/300 s (.000, .003, .007) ; ici, à la milliseconde`,
  lossInclude: (name: string): string => `INCLUDE de l'index ${name} non transposable (colonnes couvertes abandonnées)`,
  reverseOrphanComment: (where: string): string => `Fin de commentaire « */ » sans début (${where}) : commentaire mal imbriqué pour ce SGBD, ignorée.`,
  untypedComputed: (owner: string, attribute: string): string =>
    `La donnée calculée « ${attribute} » de « ${owner} » n'a pas de type : il n'a pas pu être déduit de l'expression — à saisir.`,
  singleNullUnique: (owner: string, columns: string): string =>
    `« ${owner} » : identifiant alternatif sur ${columns}, facultatif — un seul NULL admis (SQL Server), contrairement aux autres SGBD`,
  spatialExtension: (owner: string, attribute: string, type: string, dbms: string): string =>
    `« ${owner}.${attribute} » (${type}) : type spatial, qui dépend d'une extension du SGBD cible (${dbms === "postgresql" ? "PostGIS" : dbms === "sqlite" ? "SpatiaLite" : "Spatial Extender"})`,
  rowversionAttribute: (owner: string, attribute: string): string =>
    `« ${owner}.${attribute} » (ROWVERSION) : numéro de version mis à jour automatiquement, sans équivalent hors SQL Server`,
  lossRowversion: (to: string): string => `ROWVERSION → ${to} : sans équivalent, colonne ordinaire (plus mise à jour automatiquement)`,
  lossSpatialExtension: (type: string): string => `${type} : nécessite l'extension PostGIS (CREATE EXTENSION postgis)`,
  lossUuidDefault: (from: string, to: string): string => `DEFAULT ${from} → ${to} : UUID aléatoire (version 4) au lieu de ${from === "NEWSEQUENTIALID()" ? "croissant" : "l'identifiant produit par Oracle"}`,
  lossIdentityStep: (step: number): string => `pas du compteur (${step}) non transposable`,
  lossSequenceType: (type: string): string => `type ${type} de la séquence non transposable (type par défaut du SGBD)`,
  reverseUnusedSequence: (name: string) => `Séquence « ${name} » utilisée par aucune colonne : elle n'est pas reprise.`,
  constraintDisabled: (owner: string, name: string, dialect?: string) =>
    `« ${owner} » : contrainte ${name} désactivée (${disabledWord(dialect)}) dans la source — elle n'y était pas appliquée`,
  constraintNotValidated: (owner: string, name: string, dialect?: string) =>
    `« ${owner} » : contrainte ${name} non validée (${notValidatedWord(dialect)}) — des lignes existantes peuvent ne pas la respecter`,
  conditionalUnique: (owner: string, columns: string, condition: string) =>
    `« ${owner} » : unicité conditionnelle (${columns}), seulement si ${condition} — le MCD ne l'exprime pas`,
  partitionDropped: (owner: string) => `« ${owner} » : table partitionnée dans la source — partitionnement non repris`,
  lossNumberInteger: (from: string, to: string, why: "sequence" | "identity" | "reference"): string =>
    `${from} → ${to} : ${why === "sequence" ? "colonne alimentée par une séquence" : why === "identity" ? "colonne d'identité" : "même type que la clé référencée"} — décimales et valeurs au-delà de ±9,2 × 10¹⁸ refusées`,
  lossRangeWidened: (from: string, to: string): string => `${from} → ${to} : plage de valeurs élargie (aucun CHECK ne la borne)`,
  lossNegativeScale: (from: string, to: string): string => `${from} → ${to} : échelle négative indisponible (arrondi à gauche de la virgule perdu)`,
  lossDecimalUnbounded: (from: string, to: string): string => `${from} sans précision → ${to} : précision et échelle désormais bornées`,
  lossOracleDate: (to: string): string => `DATE Oracle (date et heure) → ${to} : l'heure est perdue (option « DATE → DATE »)`,
  lossRawUuid: (): string => "RAW(16) DEFAULT SYS_GUID() → UUID : approximation (mêmes 16 octets ; les valeurs de SYS_GUID ne sont pas des UUID normalisés)",
  lossSysGuidDefault: (to: string): string => `DEFAULT SYS_GUID() → ${to} : UUID aléatoire (version 4) au lieu de l'identifiant produit par Oracle`,
  lossIntervalDays: (from: string, to: string): string => `${from} → ${to} : la précision des jours n'est plus bornée`,
  lossDisabled: (name: string, dialect?: string): string => `contrainte ${name} désactivée (${disabledWord(dialect)}) dans la source : émise en commentaire, non appliquée`,
  lossDeferrableCheck: (name: string): string => `CHECK ${name} différable → immédiat (CHECK jamais différable ici)`,
  lossDeferrable: (name: string): string => `contrainte ${name} différable (DEFERRABLE) → immédiate (non pris en charge par la cible)`,
  lossNotValidated: (name: string, dialect?: string): string =>
    `contrainte ${name} non validée (${notValidatedWord(dialect)}) → validée sur les lignes existantes (non pris en charge par la cible)`,
  lossNullsNotDistinct: (name: string): string => `UNIQUE ${name} : NULLS NOT DISTINCT indisponible — deux lignes ayant un NULL ne sont plus en conflit`,
  lossNullsAllNull: (name: string): string => `UNIQUE ${name} (NULLS NOT DISTINCT) : les lignes entièrement NULL, admises en double par Oracle, sont refusées`,
  lossToOracleEmptyString: (notNull: boolean): string =>
    notNull ? "Oracle : '' vaut NULL, donc refusée sur cette colonne NOT NULL" : "Oracle : '' vaut NULL — une chaîne vide est stockée comme NULL",
  lossOracleCompositeNulls: (name: string): string =>
    `UNIQUE ${name} : dans une clé composée, Oracle tient les NULL pour égaux (deux lignes ne différant que par un NULL entrent en conflit)`,
  lossSqlServerNulls: (name: string): string => `UNIQUE ${name} : SQL Server n'y admet qu'un seul NULL (les autres SGBD en admettent plusieurs)`,
  lossUniqueWhere: (name: string): string => `unicité conditionnelle ${name} sans équivalent (index partiel) : non émise`,
  lossUniqueExpression: (name: string): string => `unicité sur expression ${name} non traduite : non émise`,
  lossIdentityOnNull: (): string => "identité ON NULL : un NULL explicite est refusé au lieu de recevoir une valeur",
  lossIdentityAlways: (): string => "identité GENERATED ALWAYS → BY DEFAULT : une valeur fournie n'est plus refusée",
  lossSequenceTrigger: (mode: "on null" | "always"): string =>
    mode === "on null"
      ? "déclencheur de séquence → DEFAULT nextval : un NULL explicite n'est plus remplacé par une valeur de la séquence"
      : "déclencheur de séquence → DEFAULT nextval : une valeur fournie n'est plus écrasée par la séquence",
  lossSequence: (name: string): string => `séquence ${name} sans équivalent : non émise, valeur par défaut abandonnée`,
  lossPartition: (postgresql: boolean): string =>
    postgresql
      ? "partitionnement abandonné : PostgreSQL exige que la clé primaire contienne la clé de partition"
      : "partitionnement abandonné (syntaxe propre au SGBD d'origine)",
  lossStorage: (clauses: string): string => `clauses de stockage (${clauses}) abandonnées : sans effet sur les données`,
  lossByteSemantics: (): string => "VARCHAR2 / CHAR (n BYTE) : longueur en octets devenue longueur en caractères (plus de caractères multi-octets admis)",
  lossNlsSemantics: (): string =>
    "VARCHAR2 / CHAR (n) sans BYTE ni CHAR : longueur en caractères ici ; dans la source, elle dépend de NLS_LENGTH_SEMANTICS (octets par défaut)",
  lossEmptyStringNull: (): string => "Oracle : '' vaut NULL ; ici, '' est une valeur distincte, stockée telle quelle",
  lossEmptyStringRejected: (): string => "Oracle : '' vaut NULL (acceptée) ; ici, '' est rejetée par le CHECK existant",
  lossEmptyStringNotNull: (): string => "Oracle refusait '' (NULL) sur cette colonne NOT NULL ; ici, '' est acceptée (option « chaîne vide » sans CHECK)",
};

export type Messages = typeof FR;

const EN: Messages = {
  entityNameTaken: "An entity with this name already exists",
  associationNameTaken: "An association with this name already exists",
  duplicateAttributes: "There are duplicate attributes.",
  maxLowerThanMin: "The maximum cardinality must be greater than or equal to the minimum cardinality.",
  incoherentCardinalities: "The minimum and maximum cardinalities are inconsistent.",
  associationNeedsTwoLegs: "Warning! An association must have at least 2 legs",
  bothSidesOneOne: "An association cannot have 1,1 cardinalities on both sides",
  attributesNeedTable: "Only associations that generate a junction table can carry attributes",
  oneOneForbiddenWithAttributes: "The 1,1 cardinality is not allowed when the association carries attributes",
  circularReferences: "Warning! Circular references",
  sqlBlocked: "Cannot generate the SQL script: see the errors in the textual logical model",
  inheritanceNeedsParent: "A generic entity is required",
  inheritanceNeedsTwoChildren: "At least one specialised entity is required",
  newerFile: "Warning: this file was saved by a newer version of the application and may not load correctly!",

  emptyName: "The name cannot be empty.",
  missingKeyConceptual: (entity) => `Entity “${entity}” has no discriminant.`,
  missingKeyLogical: (table) => `MISSING_KEY: table “${table}” has no primary key.`,
  duplicateEntityName: (name) => `An entity with this name already exists: “${name}”`,
  duplicateAssociationName: (name) => `An association with this name already exists: “${name}”`,
  duplicateAttributesIn: (owner) => `“${owner}” has duplicate attributes.`,
  duplicateTableConceptual: (name) => `Several entities or associations have the same logical name “${name}”.`,
  duplicateTableLogical: (table) => `Several tables are named “${table}”.`,
  multipleParents: (entity) => `“${entity}” is a specialised entity of several inheritances.`,
  subtypeKeyConceptual: (entity) =>
    `“${entity}” is a specialised entity: it inherits its generic entity's discriminant, its own discriminants are ignored.`,
  subtypeKeyLogical: (table) =>
    `“${table}” is a specialised entity's table: its primary key is the generic entity's, its other key columns are ignored.`,
  alreadyInherits: "This inheritance is already linked to this entity.",
  alreadyLinked: "This association is already linked to this entity.",
  duplicateColumnConceptual: (owner, name) =>
    `The name “${name}” is used twice by “${owner}” (attribute or foreign key): rename the foreign key.`,
  duplicateColumnLogical: (table, column) => `Duplicate column “${column}” in table “${table}”: rename the foreign key.`,
  untypedConceptual: (owner, attribute) => `Attribute “${attribute}” of “${owner}” has no type.`,
  untypedLogical: (table, column) => `Column “${column}” of table “${table}” has no type: it will be generated without a type in SQL.`,
  naryWithFunctionalLeg:
    "Mapping rule not supported yet: n-ary association with a leg of maximum cardinality 1 (a table is generated by default).",
  genericVersion: "Generic (no version-specific keywords)",
  versionFeature: {
    identity: "Counters as IDENTITY columns",
    include: "Covered index columns (INCLUDE)",
    nondeterministicCollations: "Case-insensitive collations (non-deterministic ICU)",
    genRandomUuid: "UUID defaults with gen_random_uuid()",
    nullsNotDistinct: "UNIQUE … NULLS NOT DISTINCT",
    negativeScale: "NUMERIC with negative scale",
    isJson: "CHECK … IS JSON",
    uuidv7: "Sequential UUIDs with uuidv7()",
    virtualColumns: "Virtual generated columns",
    longNames: "Names up to 128 characters (30 before)",
    booleanType: "Native BOOLEAN type",
    booleanLiterals: "TRUE / FALSE literals",
    checkEnforced: "CHECK constraints enforced",
  },
  fileUnreadable: "The file is not a valid model (unreadable JSON).",
  fileNotModel: "The file is not a model of this application.",
  noMigration: (version) => `No migration from version ${version}.`,
  reverseUnreadable: (text) => `Unreadable table statement, ignored: ${text}…`,
  reverseUnknownTable: (table, referenced) => `The foreign key of “${table}” references “${referenced}”, which is not in the script: it is ignored.`,
  reverseColumnMismatch: (table, referenced) =>
    `The foreign key from “${table}” to “${referenced}” does not have the same number of columns as the referenced key: it is ignored.`,
  reverseReferencesAssociation: (table, referenced) =>
    `“${table}” references the junction table “${referenced}”: this link cannot be represented in the CDM.`,
  reverseSharedColumns: (table, columns) =>
    `“${table}”: the foreign key reuses column(s) ${columns} of another key. The CDM cannot express this; the sharing is kept as an annotation and reapplied to the SQL.`,
  lossHeader: (target, count) => `Conversion report for ${target}: ${count} item(s) dropped or degraded`,
  lossType: (from, to) => `type ${from} → ${to} (no exact equivalent)`,
  lossAutoIncrement: () => "auto-increment dropped: not supported by the target here (plain integer column)",
  lossDefault: (expression) => `DEFAULT ${expression} not translated (dropped)`,
  lossCheck: (expression) => `CHECK (${expression}) not translated (left as a comment)`,
  lossCheckNotEnforced: (expression) => `CHECK (${expression}) accepted but not enforced by this version`,
  lossAction: (action, fallback) => `${action} not supported → ${fallback}`,
  lossCascadePath: (event, action) => `ON ${event} ${action} rejected (multiple or cyclic cascade paths) → NO ACTION`,
  lossName: (name, fitted, max) => `name “${name}” shortened to “${fitted}” (at most ${max} characters)`,
  lossAlterUnsupported: () => "“foreign keys in ALTER TABLE” option ignored: the target cannot add a foreign key afterwards",
  untranslatedCheck: (where, expression) => `CHECK not translated (${where}): ${expression}`,
  referenceNotEnforced: (association) =>
    `“${association}”: the reference was declared inline (col … REFERENCES), which MySQL does not enforce — the source data may violate it`,
  multivaluedAttribute: (owner, attribute) =>
    `“${owner}.${attribute}” is multi-valued (SET): contrary to first normal form (a dedicated entity or association would fit better)`,
  nonAtomicAttribute: (owner, attribute) => `“${owner}.${attribute}” (JSON) is not atomic: its content is outside the CDM`,
  prefixAlternateKey: (owner, key) => `“${owner}”: alternate key on a prefix (${key}) — only the first characters are unique`,
  lossCollation: (name) => `collation ${name} has no equivalent: not emitted (database default collation)`,
  lossCollationApprox: (name, detail) =>
    `collation ${name} approximated: ${
      detail === "like"
        ? "LIKE unavailable on this column before PostgreSQL 18"
        : detail === "nocase"
          ? "NOCASE ignores ASCII case only, accents remain distinct"
          : detail === "language"
            ? "insensitivity kept, language-specific rules (sorting, special letters) not reproduced"
            : detail === "deterministic"
              ? "default deterministic collation (server without ICU): comparisons and uniqueness are case- and accent-sensitive"
              : "accents are no longer distinguished"
    }`,
  lossSetArray: () => "SET → TEXT[]: order and duplicates, normalised by MySQL, are kept as entered",
  lossEnumCase: (insensitive) =>
    insensitive
      ? "ENUM under an insensitive collation: a value entered in another case (ACTIF) is accepted as is, MySQL turned it into the ENUM value (actif)"
      : "ENUM: a value entered in another case (ACTIF) is rejected, MySQL turned it into the ENUM value (actif)",
  lossTinyintBoolean: (to) => `TINYINT(1) → ${to}: MySQL accepts other values than 0 / 1 (−128 to 127); only true / false remain`,
  lossCollationEnumType: (name) => `collation ${name} has no effect on an enumerated type: exact value comparison`,
  lossSet: (values) => `SET(${values}) → TEXT: multiple values and domain not enforced`,
  lossUnsignedCheck: (from) => `UNSIGNED: ${from} kept + CHECK (>= 0); the upper half of the range is lost`,
  lossMysqlTimestamp: (to) => `MySQL TIMESTAMP (UTC, 1970–2038 range) → ${to}: same time-zone semantics, wider range`,
  lossIdentityStart: (start) => `counter start value (${start}) not transposable`,
  lossGenerated: (expression) => `generated column (${expression}) not translated: plain column`,
  lossGeneratedMode: (from, to) => `generated column ${from} → ${to} (${from} unavailable for this DBMS / version)`,
  lossCheckTypes: (expression, detail) => `CHECK (${expression}) incompatible with the column types (${detail}): left as a comment`,
  lossGeneratedType: (type) => `generated column: type ${type} not declared (SQL Server infers it from the expression)`,
  lossOnUpdate: (expression) => `ON UPDATE ${expression} not translated: a trigger would be required`,
  lossIndexMethod: (name, method) => `index method ${method} of ${name} dropped (the index or constraint is kept)`,
  lossFulltextGin: (name) => `full-text index ${name} → GIN index on to_tsvector('simple', …): approximation (MATCH … AGAINST queries to rewrite)`,
  lossIndexKind: (name, kind) => `${kind} index ${name} has no equivalent: not emitted`,
  lossPrefixKey: (name, unique) => `${unique ? "UNIQUE" : "index"} on prefix ${name} has no equivalent: not emitted (never widened to the whole column)`,
  lossComments: (count) => `${count} comment(s) not emitted (no syntax for this DBMS)`,
  lossTrigger: (name) => `trigger ${name} not translated (code specific to the source DBMS)`,
  disabledComment: (dialect) => `disabled (${disabledWord(dialect)}) in the source: not enforced`,
  lossDefaultNotNull: (expression) => `DEFAULT ${expression} not translated on a NOT NULL column: an INSERT without a value for this column will fail`,
  lossSqlServerIdentity: () => "IDENTITY (SQL Server) rejects a supplied value (except SET IDENTITY_INSERT), which the source accepted",
  lossSqlServerCollation: (name) => `assumption: default collation of the SQL Server database ${name} (absent from the script), applied to texts without a declared collation`,
  lossSpatialFallback: (type, to) => `${type} → ${to} (${to === "BYTEA" ? "WKB" : "WKT"}) without the PostGIS extension: spatial functions and indexes lost`,
  lossSchema: (schema) => `schema ${schema} not transposable: tables created in the current schema`,
  lossSqlServerOption: (option) => `${option} (SQL Server option): no equivalent, dropped`,
  lossDatetimeOffset: (to) => `DATETIMEOFFSET → ${to}: the original time offset is lost (value brought back to UTC)`,
  lossSqlServerDatetime: (to) => `DATETIME → ${to}: original rounding to 1/300 s (.000, .003, .007); here, to the millisecond`,
  lossInclude: (name) => `INCLUDE of index ${name} not transposable (covered columns dropped)`,
  reverseOrphanComment: (where) => `Comment end “*/” without a start (${where}): comment wrongly nested for this DBMS, ignored.`,
  untypedComputed: (owner, attribute) => `The computed attribute “${attribute}” of “${owner}” has no type: it could not be inferred from the expression — please enter it.`,
  singleNullUnique: (owner, columns) => `“${owner}”: alternate key on ${columns}, optional — a single NULL allowed (SQL Server), unlike other DBMSs`,
  spatialExtension: (owner, attribute, type, dbms) =>
    `“${owner}.${attribute}” (${type}): spatial type, which depends on an extension of the target DBMS (${dbms === "postgresql" ? "PostGIS" : dbms === "sqlite" ? "SpatiaLite" : "Spatial Extender"})`,
  rowversionAttribute: (owner, attribute) => `“${owner}.${attribute}” (ROWVERSION): automatically updated version number, no equivalent outside SQL Server`,
  lossRowversion: (to) => `ROWVERSION → ${to}: no equivalent, ordinary column (no longer updated automatically)`,
  lossSpatialExtension: (type) => `${type}: requires the PostGIS extension (CREATE EXTENSION postgis)`,
  lossUuidDefault: (from, to) => `DEFAULT ${from} → ${to}: random UUID (version 4) instead of ${from === "NEWSEQUENTIALID()" ? "an increasing one" : "the identifier produced by Oracle"}`,
  lossIdentityStep: (step) => `counter step (${step}) not transposable`,
  lossSequenceType: (type) => `sequence type ${type} not transposable (DBMS default type)`,
  reverseUnusedSequence: (name) => `Sequence “${name}” is used by no column: it is not kept.`,
  constraintDisabled: (owner, name, dialect) => `“${owner}”: constraint ${name} disabled (${disabledWord(dialect)}) in the source — it was not enforced`,
  constraintNotValidated: (owner, name, dialect) => `“${owner}”: constraint ${name} not validated (${notValidatedWord(dialect)}) — existing rows may violate it`,
  conditionalUnique: (owner, columns, condition) => `“${owner}”: conditional uniqueness (${columns}), only when ${condition} — the CDM cannot express it`,
  partitionDropped: (owner) => `“${owner}”: table partitioned in the source — partitioning not kept`,
  lossNumberInteger: (from, to, why) =>
    `${from} → ${to}: ${why === "sequence" ? "column fed by a sequence" : why === "identity" ? "identity column" : "same type as the referenced key"} — decimals and values beyond ±9.2 × 10¹⁸ rejected`,
  lossRangeWidened: (from, to) => `${from} → ${to}: wider range of values (no CHECK bounds it)`,
  lossNegativeScale: (from, to) => `${from} → ${to}: negative scale unavailable (rounding left of the decimal point lost)`,
  lossDecimalUnbounded: (from, to) => `${from} without precision → ${to}: precision and scale now bounded`,
  lossOracleDate: (to) => `Oracle DATE (date and time) → ${to}: the time is lost (option “DATE → DATE”)`,
  lossRawUuid: () => "RAW(16) DEFAULT SYS_GUID() → UUID: approximation (same 16 bytes; SYS_GUID values are not standard UUIDs)",
  lossSysGuidDefault: (to) => `DEFAULT SYS_GUID() → ${to}: random UUID (version 4) instead of the identifier produced by Oracle`,
  lossIntervalDays: (from, to) => `${from} → ${to}: the precision of days is no longer bounded`,
  lossDisabled: (name, dialect) => `constraint ${name} disabled (${disabledWord(dialect)}) in the source: emitted as a comment, not enforced`,
  lossDeferrableCheck: (name) => `CHECK ${name} deferrable → immediate (CHECK is never deferrable here)`,
  lossDeferrable: (name) => `constraint ${name} deferrable (DEFERRABLE) → immediate (not supported by the target)`,
  lossNotValidated: (name, dialect) => `constraint ${name} not validated (${notValidatedWord(dialect)}) → validated on existing rows (not supported by the target)`,
  lossNullsNotDistinct: (name) => `UNIQUE ${name}: NULLS NOT DISTINCT unavailable — two rows with a NULL no longer conflict`,
  lossNullsAllNull: (name) => `UNIQUE ${name} (NULLS NOT DISTINCT): all-NULL rows, allowed twice by Oracle, are rejected`,
  lossToOracleEmptyString: (notNull) => (notNull ? "Oracle: '' is NULL, hence rejected in this NOT NULL column" : "Oracle: '' is NULL — an empty string is stored as NULL"),
  lossOracleCompositeNulls: (name) => `UNIQUE ${name}: in a composite key, Oracle treats NULLs as equal (two rows differing only by a NULL conflict)`,
  lossSqlServerNulls: (name) => `UNIQUE ${name}: SQL Server allows a single NULL in it (other DBMSs allow several)`,
  lossUniqueWhere: (name) => `conditional uniqueness ${name} has no equivalent (partial index): not emitted`,
  lossUniqueExpression: (name) => `uniqueness on expression ${name} not translated: not emitted`,
  lossIdentityOnNull: () => "identity ON NULL: an explicit NULL is rejected instead of receiving a value",
  lossIdentityAlways: () => "identity GENERATED ALWAYS → BY DEFAULT: a supplied value is no longer rejected",
  lossSequenceTrigger: (mode) =>
    mode === "on null"
      ? "sequence trigger → DEFAULT nextval: an explicit NULL is no longer replaced by a sequence value"
      : "sequence trigger → DEFAULT nextval: a supplied value is no longer overwritten by the sequence",
  lossSequence: (name) => `sequence ${name} has no equivalent: not emitted, default value dropped`,
  lossPartition: (postgresql) =>
    postgresql ? "partitioning dropped: PostgreSQL requires the primary key to contain the partition key" : "partitioning dropped (syntax specific to the source DBMS)",
  lossStorage: (clauses) => `storage clauses (${clauses}) dropped: no effect on the data`,
  lossByteSemantics: () => "VARCHAR2 / CHAR (n BYTE): length in bytes became a length in characters (more multi-byte characters allowed)",
  lossNlsSemantics: () => "VARCHAR2 / CHAR (n) without BYTE or CHAR: length in characters here; in the source it depends on NLS_LENGTH_SEMANTICS (bytes by default)",
  lossEmptyStringNull: () => "Oracle: '' is NULL; here, '' is a distinct value, stored as is",
  lossEmptyStringRejected: () => "Oracle: '' is NULL (accepted); here, '' is rejected by the existing CHECK",
  lossEmptyStringNotNull: () => "Oracle rejected '' (NULL) in this NOT NULL column; here '' is accepted (option “empty string” without CHECK)",
};

export type MessagesLocale = "fr" | "en";

export let MSG: Messages = FR;

export function setMessagesLocale(locale: MessagesLocale) {
  MSG = locale === "en" ? EN : FR;
}

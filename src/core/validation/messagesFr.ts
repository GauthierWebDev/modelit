/** Mot du dialecte d'origine pour une contrainte désactivée / non validée (O-42). */
export const disabledWord = (dialect?: string) => (dialect === "sqlserver" ? "NOCHECK CONSTRAINT" : "DISABLE");

export const notValidatedWord = (dialect?: string) =>
  dialect === "sqlserver" ? "WITH NOCHECK" : dialect === "postgresql" ? "NOT VALID" : "NOVALIDATE";

export const FR = {
  entityNameTaken: "Nom de l'entité déjà existant",
  associationNameTaken: "Nom de l'association déjà existant",
  duplicateAttributes: "Il existe des doublons dans les rubriques.",
  maxLowerThanMin: "La cardinalité Max doit être supérieure ou égale à la cardinalité Min.",
  incoherentCardinalities: "Les cardinalités Min et Max sont incohérentes.",
  associationNeedsTwoLegs: "Attention ! Une association doit posséder au moins 2 pattes",
  bothSidesOneOne: "Une association ne peut pas avoir des cardinalités 1,1 de part et d'autre",
  attributesNeedTable:
    "Seules les associations générant une table de correspondance peuvent être porteuses de rubriques",
  oneOneForbiddenWithAttributes: "La cardinalité 1,1 est interdite lorsque l'association est porteuse de rubriques",
  circularReferences: "Attention ! Références circulaires",
  sqlBlocked: "Impossible de générer le script SQL : voir les erreurs dans le MLD textuel",
  // héritage (O-18, O-27) : entité générique et entités spécialisées
  inheritanceNeedsParent: "Il faut une entité générique",
  inheritanceNeedsChild: "Il faut au moins une entité spécialisée",
  newerFile:
    "Attention, ce fichier a été enregistré par une version plus récente de l'application, sa lecture sera aléatoire !",

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
  tableNameTaken: (table: string) => `Une autre table s'appelle déjà « ${table} ».`,
  columnNameTaken: (table: string, column: string) => `La table « ${table} » a déjà une colonne « ${column} ».`,
  untypedConceptual: (owner: string, attribute: string) =>
    `La rubrique « ${attribute} » de « ${owner} » n'a pas de type.`,
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
  fileUnknownDbms: (dbms: string) => `Fichier abîmé ou d'une version plus récente : SGBD « ${dbms} » inconnu.`,
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
  customDbmsHeader: (name: string, base: string) => `SGBD personnalisé « ${name} », basé sur ${base}`,
  invalidTemplateVariable: (variable: string) => `Variable ${variable} sans objet pour ce type.`,
  lossHeader: (target: string, count: number) =>
    `Rapport de conversion vers ${target} : ${count} élément(s) abandonné(s) ou dégradé(s)`,
  lossType: (from: string, to: string) => `type ${from} → ${to} (pas d'équivalent exact)`,
  lossAutoIncrement: () => "auto-incrément abandonné : la cible ne le permet pas ici (colonne réduite à un entier)",
  lossDefault: (expression: string) => `DEFAULT ${expression} non traduit (abandonné)`,
  lossCheck: (expression: string) => `CHECK (${expression}) non traduit (laissé en commentaire)`,
  lossCheckNotEnforced: (expression: string) => `CHECK (${expression}) accepté mais non appliqué par cette version`,
  lossAction: (action: string, fallback: string) => `${action} non pris en charge → ${fallback}`,
  lossCascadePath: (event: string, action: string) =>
    `ON ${event} ${action} refusé (chemins de cascade multiples ou cycliques) → NO ACTION`,
  lossName: (name: string, fitted: string, max: number) =>
    `nom « ${name} » raccourci en « ${fitted} » (${max} caractères au plus)`,
  lossAlterUnsupported: () =>
    "option « clés étrangères en ALTER TABLE » ignorée : la cible ne sait pas ajouter une clé étrangère après coup",
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
  lossSetArray: (): string =>
    "SET → TEXT[] : l'ordre et les doublons, normalisés par MySQL, sont conservés tels que saisis",
  lossEnumCase: (insensitive: boolean): string =>
    insensitive
      ? "ENUM sous collation insensible : une valeur saisie dans une autre casse (ACTIF) est acceptée telle quelle, MySQL la ramenait à la valeur de l'ENUM (actif)"
      : "ENUM : une valeur saisie dans une autre casse (ACTIF) est refusée, MySQL la ramenait à la valeur de l'ENUM (actif)",
  lossTinyintBoolean: (to: string) =>
    `TINYINT(1) → ${to} : MySQL y accepte d'autres valeurs que 0 / 1 (de −128 à 127) ; seuls vrai / faux restent`,
  lossCollationEnumType: (name: string) =>
    `collation ${name} sans effet sur un type énuméré : comparaison exacte des valeurs`,
  lossSet: (values: string) => `SET(${values}) → TEXT : valeurs multiples et domaine non contrôlés`,
  lossUnsignedCheck: (from: string) =>
    `UNSIGNED : ${from} conservé + CHECK (>= 0) ; la moitié haute de la plage est perdue`,
  lossMysqlTimestamp: (to: string) =>
    `TIMESTAMP MySQL (UTC, plage 1970–2038) → ${to} : même sémantique de fuseau, plage plus large`,
  lossIdentityStart: (start: number) => `premier numéro du compteur (${start}) non transposable`,
  lossGenerated: (expression: string) => `colonne calculée (${expression}) non traduite : colonne ordinaire`,
  lossGeneratedMode: (from: string, to: string) =>
    `colonne calculée ${from} → ${to} (${from} indisponible pour ce SGBD / cette version)`,
  lossCheckTypes: (expression: string, detail: string) =>
    `CHECK (${expression}) incompatible avec le type des colonnes (${detail}) : laissé en commentaire`,
  lossGeneratedType: (type: string) =>
    `colonne calculée : type ${type} non déclaré (SQL Server le déduit de l'expression)`,
  lossOnUpdate: (expression: string) => `ON UPDATE ${expression} non traduit : un déclencheur serait nécessaire`,
  lossIndexMethod: (name: string, method: string) =>
    `méthode d'index ${method} de ${name} abandonnée (l'index ou la contrainte sont conservés)`,
  lossFulltextGin: (name: string) =>
    `index plein texte ${name} → index GIN sur to_tsvector('simple', …) : approximation (requêtes MATCH … AGAINST à réécrire)`,
  lossIndexKind: (name: string, kind: string) => `index ${kind} ${name} sans équivalent : non émis`,
  lossPrefixKey: (name: string, unique: boolean) =>
    `${unique ? "UNIQUE" : "index"} sur préfixe ${name} sans équivalent : non émis (jamais élargi à la colonne entière)`,
  lossComments: (count: number) => `${count} commentaire(s) non émis (pas de syntaxe pour ce SGBD)`,
  lossTrigger: (name: string) => `déclencheur ${name} non traduit (code propre au SGBD d'origine)`,
  // O-39 (Oracle)
  disabledComment: (dialect?: string): string => `désactivée (${disabledWord(dialect)}) dans la source : non appliquée`,
  lossDefaultNotNull: (expression: string): string =>
    `DEFAULT ${expression} non traduit sur une colonne NOT NULL : un INSERT sans valeur pour cette colonne échouera`,
  lossSqlServerIdentity: (): string =>
    "IDENTITY (SQL Server) refuse une valeur fournie (sauf SET IDENTITY_INSERT), que la source acceptait",
  lossSqlServerCollation: (name: string): string =>
    `hypothèse : collation par défaut de la base SQL Server ${name} (absente du script), appliquée aux textes sans collation déclarée`,
  lossSpatialFallback: (type: string, to: string): string =>
    `${type} → ${to} (${to === "BYTEA" ? "WKB" : "WKT"}) sans extension PostGIS : fonctions et index spatiaux perdus`,
  lossSchema: (schema: string): string => `schéma ${schema} non transposable : tables créées dans le schéma courant`,
  lossSqlServerOption: (option: string): string => `${option} (option SQL Server) : sans équivalent, abandonnée`,
  lossDatetimeOffset: (to: string): string =>
    `DATETIMEOFFSET → ${to} : le décalage horaire d'origine est perdu (valeur ramenée à l'UTC)`,
  lossSqlServerDatetime: (to: string): string =>
    `DATETIME → ${to} : arrondi d'origine au 1/300 s (.000, .003, .007) ; ici, à la milliseconde`,
  lossInclude: (name: string): string => `INCLUDE de l'index ${name} non transposable (colonnes couvertes abandonnées)`,
  reverseOrphanComment: (where: string): string =>
    `Fin de commentaire « */ » sans début (${where}) : commentaire mal imbriqué pour ce SGBD, ignorée.`,
  untypedComputed: (owner: string, attribute: string): string =>
    `La donnée calculée « ${attribute} » de « ${owner} » n'a pas de type : il n'a pas pu être déduit de l'expression — à saisir.`,
  singleNullUnique: (owner: string, columns: string): string =>
    `« ${owner} » : identifiant alternatif sur ${columns}, facultatif — un seul NULL admis (SQL Server), contrairement aux autres SGBD`,
  spatialExtension: (owner: string, attribute: string, type: string, dbms: string): string =>
    `« ${owner}.${attribute} » (${type}) : type spatial, qui dépend d'une extension du SGBD cible (${dbms === "postgresql" ? "PostGIS" : dbms === "sqlite" ? "SpatiaLite" : "Spatial Extender"})`,
  rowversionAttribute: (owner: string, attribute: string): string =>
    `« ${owner}.${attribute} » (ROWVERSION) : numéro de version mis à jour automatiquement, sans équivalent hors SQL Server`,
  lossRowversion: (to: string): string =>
    `ROWVERSION → ${to} : sans équivalent, colonne ordinaire (plus mise à jour automatiquement)`,
  lossSpatialExtension: (type: string): string => `${type} : nécessite l'extension PostGIS (CREATE EXTENSION postgis)`,
  lossUuidDefault: (from: string, to: string): string =>
    `DEFAULT ${from} → ${to} : UUID aléatoire (version 4) au lieu de ${from === "NEWSEQUENTIALID()" ? "croissant" : "l'identifiant produit par Oracle"}`,
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
  lossRangeWidened: (from: string, to: string): string =>
    `${from} → ${to} : plage de valeurs élargie (aucun CHECK ne la borne)`,
  lossNegativeScale: (from: string, to: string): string =>
    `${from} → ${to} : échelle négative indisponible (arrondi à gauche de la virgule perdu)`,
  lossDecimalUnbounded: (from: string, to: string): string =>
    `${from} sans précision → ${to} : précision et échelle désormais bornées`,
  lossOracleDate: (to: string): string =>
    `DATE Oracle (date et heure) → ${to} : l'heure est perdue (option « DATE → DATE »)`,
  lossRawUuid: (): string =>
    "RAW(16) DEFAULT SYS_GUID() → UUID : approximation (mêmes 16 octets ; les valeurs de SYS_GUID ne sont pas des UUID normalisés)",
  lossSysGuidDefault: (to: string): string =>
    `DEFAULT SYS_GUID() → ${to} : UUID aléatoire (version 4) au lieu de l'identifiant produit par Oracle`,
  lossIntervalDays: (from: string, to: string): string => `${from} → ${to} : la précision des jours n'est plus bornée`,
  lossDisabled: (name: string, dialect?: string): string =>
    `contrainte ${name} désactivée (${disabledWord(dialect)}) dans la source : émise en commentaire, non appliquée`,
  lossDeferrableCheck: (name: string): string => `CHECK ${name} différable → immédiat (CHECK jamais différable ici)`,
  lossDeferrable: (name: string): string =>
    `contrainte ${name} différable (DEFERRABLE) → immédiate (non pris en charge par la cible)`,
  lossNotValidated: (name: string, dialect?: string): string =>
    `contrainte ${name} non validée (${notValidatedWord(dialect)}) → validée sur les lignes existantes (non pris en charge par la cible)`,
  lossNullsNotDistinct: (name: string): string =>
    `UNIQUE ${name} : NULLS NOT DISTINCT indisponible — deux lignes ayant un NULL ne sont plus en conflit`,
  lossNullsAllNull: (name: string): string =>
    `UNIQUE ${name} (NULLS NOT DISTINCT) : les lignes entièrement NULL, admises en double par Oracle, sont refusées`,
  lossToOracleEmptyString: (notNull: boolean): string =>
    notNull
      ? "Oracle : '' vaut NULL, donc refusée sur cette colonne NOT NULL"
      : "Oracle : '' vaut NULL — une chaîne vide est stockée comme NULL",
  lossOracleCompositeNulls: (name: string): string =>
    `UNIQUE ${name} : dans une clé composée, Oracle tient les NULL pour égaux (deux lignes ne différant que par un NULL entrent en conflit)`,
  lossSqlServerNulls: (name: string): string =>
    `UNIQUE ${name} : SQL Server n'y admet qu'un seul NULL (les autres SGBD en admettent plusieurs)`,
  lossUniqueWhere: (name: string): string =>
    `unicité conditionnelle ${name} sans équivalent (index partiel) : non émise`,
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
  lossByteSemantics: (): string =>
    "VARCHAR2 / CHAR (n BYTE) : longueur en octets devenue longueur en caractères (plus de caractères multi-octets admis)",
  lossNlsSemantics: (): string =>
    "VARCHAR2 / CHAR (n) sans BYTE ni CHAR : longueur en caractères ici ; dans la source, elle dépend de NLS_LENGTH_SEMANTICS (octets par défaut)",
  lossEmptyStringNull: (): string => "Oracle : '' vaut NULL ; ici, '' est une valeur distincte, stockée telle quelle",
  lossEmptyStringRejected: (): string => "Oracle : '' vaut NULL (acceptée) ; ici, '' est rejetée par le CHECK existant",
  lossEmptyStringNotNull: (): string =>
    "Oracle refusait '' (NULL) sur cette colonne NOT NULL ; ici, '' est acceptée (option « chaîne vide » sans CHECK)",
};

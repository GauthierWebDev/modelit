import type { Dbms } from "../dbms/dbms";
import { isAtLeast } from "../dbms/versions";
import type { ReferentialAction } from "../model/physical";

/**
 * Capacités des SGBD cibles pour la génération du script (override O-29).
 * Sources : documentations officielles de chaque SGBD (mots réservés, actions référentielles,
 * longueur des identifiants, fonctions de date).
 */

export interface Target {
  dbms: Dbms;
  version?: string;
}

// ---------------------------------------------------------------------------------------------
// Identifiants

/** Repli de casse des identifiants non quotés. */
const FOLDING: Partial<Record<Dbms, "lower" | "upper">> = { postgresql: "lower", oracle: "upper", db2: "upper" };

const QUOTES: Record<Dbms, [string, string]> = {
  postgresql: ['"', '"'],
  oracle: ['"', '"'],
  db2: ['"', '"'],
  sqlite: ['"', '"'],
  sybase: ['"', '"'],
  mysql: ["`", "`"],
  mariadb: ["`", "`"],
  sqlserver: ["[", "]"],
  access: ["[", "]"],
};

/** Mots réservés communs (SQL standard), complétés par SGBD. */
const COMMON = `add all alter and any as asc between both by case cast check collate column constraint create cross
current_date current_time current_timestamp current_user default delete desc distinct drop else end except exists
false fetch for foreign from full grant group having in inner insert intersect into is join leading left like not
null of on or order outer primary references right select set some table then to trailing true union unique update
user using values when where with`;

const SPECIFIC: Record<Dbms, string> = {
  postgresql: `analyse analyze array asymmetric authorization binary collation concurrently current_catalog current_role
current_schema deferrable do freeze ilike initially isnull lateral limit localtime localtimestamp natural notnull offset
only overlaps placing returning session_user similar symmetric system_user tablesample variadic verbose window`,
  mysql: `accessible analyze asensitive before bigint binary blob call cascade change char character condition continue
convert cube cume_dist cursor database databases dec decimal declare delayed dense_rank describe deterministic distinctrow
div double dual each elseif empty enclosed escaped exit explain first_value float float4 float8 force fulltext function
generated get grouping groups high_priority if ignore index infile inout insensitive int int1 int2 int3 int4 int8 integer
interval iterate json_table key keys kill lag last_value lateral lead leave limit linear lines load localtime
localtimestamp lock long longblob longtext loop low_priority match maxvalue mediumblob mediumint mediumtext middleint mod
modifies natural no_write_to_binlog nth_value ntile numeric optimize option optionally out outfile over partition
percent_rank precision procedure purge range rank read reads read_write real recursive regexp release rename repeat
replace require resignal restrict return revoke rlike row rows row_number schema schemas sensitive separator show signal
smallint spatial specific sql sqlexception sqlstate sqlwarning ssl starting stored straight_join system terminated
tinyblob tinyint tinytext trigger undo unlock unsigned usage use utc_date utc_time utc_timestamp varbinary varchar
varcharacter varying virtual while window write xor zerofill`,
  mariadb: "",
  sqlserver: `authorization backup begin break browse bulk cascade checkpoint close clustered coalesce commit compute
contains containstable continue convert current cursor database dbcc deallocate declare deny disk distributed double dump
errlvl escape exec execute exit external file fillfactor freetext freetexttable function goto holdlock identity
identity_insert identitycol if index key kill lineno load merge national nocheck nonclustered nullif off offsets open
opendatasource openquery openrowset openxml option over percent pivot plan precision print proc procedure public
raiserror read readtext reconfigure replication restore restrict return revert revoke rollback rowcount rowguidcol rule
save schema securityaudit session_user setuser shutdown statistics system_user tablesample textsize top tran transaction
trigger truncate try_convert tsequal unpivot updatetext use varying view waitfor while writetext`,
  oracle: `access audit char cluster comment compress connect current date decimal exclusive file float identified
immediate increment index initial integer level lock long maxextents minus mlslabel mode modify noaudit nocompress nowait
number offline online option pctfree prior public raw rename resource revoke row rowid rownum rows session share size
smallint start successful synonym sysdate trigger uid validate varchar varchar2 view whenever`,
  sqlite: `abort autoincrement commit deferrable escape except index isnull limit notnull raise transaction`,
  db2: `after alias allow application assumes audit aux auxiliary before binary bufferpool call called capture cascaded
ccsid char character clone close cluster collection collid comment commit concat condition connect connection contains
continue count count_big current cursor data database datapartitionname datapartitionnum date day days dbinfo declare
deferred define descriptor deterministic disable disallow do document double dssize dynamic editproc elseif enable
encoding encryption ending erase escape every exception excluding exclusive execute exit explain external extract
fenced fieldproc file final free function general generated get global go goto graphic handler hash hashed_value hint
hold hour hours identity if immediate including inclusive increment index indicator inherit inout insensitive integrity
isobid isolation iterate jar java key label language lc_ctype leave level linktype local locale locator locators lock
lockmax locksize long loop maintained materialized maxvalue microsecond microseconds minute minutes minvalue mode
modifies month months new new_table nextval nocache nocycle nodename nodenumber nomaxvalue nominvalue none noorder
normalized nulls numparts obid old old_table open optimization optimize option out over overriding package padded
pagesize parameter part partition partitioned partitioning partitions password path piecesize plan position precision
prepare prevval priqty privileges procedure program psid query queryno range rank read reads recovery referencing
refresh release rename repeat reset resignal restart restrict result result_set_locator return returns revoke role
rollback round_ceiling round_down round_floor round_half_down round_half_even round_half_up round_up routine row
row_number rownumber rows rowset rrn run savepoint schema scratchpad scroll search second seconds secqty security
sensitive sequence session session_user signal simple snapshot source specific sql sqlid stacked standard start
starting statement static stay stogroup stores style substring summary synonym sysfun sysibm sysproc system
system_user transaction trigger trim truncate type undo until usage validproc value variable variant vcat version view
volatile volumes while wlm write xmlelement xmlexists xmlnamespaces year years`,
  sybase: `arith_overflow break browse bulk cascade char_convert checkpoint close clustered commit compute confirm
connect continue controlrow convert count current cursor database dbcc deallocate declare deterministic disk double dummy
dump endtran errlvl errordata errorexit escape exclusive exec execute exit exp_row_size external fetch fillfactor func
goto holdlock identity identity_gap identity_start identity_insert if index inout install jar key kill lineno load lock
materialized max_rows_per_page mirror mirrorexit modify national new noholdlock nonclustered nonscrollable
non_sensitive numeric_truncation off offsets once online only open option out output over partition perm permanent plan
precision prepare print privileges proc procedure processexit proxy_table public quiesce raiserror read readpast
readtext reconfigure remove reorg replace replication reservepagegap return returns revoke role rollback rowcount rows
rule save schema scroll scrollable semi_sensitive sensitive setuser shared shutdown stringsize sum syb_identity
syb_restree syb_terminate temp textsize tran transaction trigger truncate tsequal unpartition use user_option
using varying view waitfor while writetext xmlextract xmlparse xmltest xmlvalidate`,
  access: `alphanumeric autoincrement binary bit boolean byte char character column container counter currency
database date datetime disallow distinctrow double float float4 float8 general guid ieeedouble ieeesingle ignore
image index int integer integer1 integer2 integer4 level logical long longbinary longtext memo money month note
number numeric oleobject option owneraccess parameters percent pivot real short single smallint string text time
timestamp top transform value varbinary varchar year yesno`,
};
SPECIFIC.mariadb = SPECIFIC.mysql;

const RESERVED: Record<Dbms, Set<string>> = Object.fromEntries(
  (Object.keys(SPECIFIC) as Dbms[]).map((dbms) => [dbms, new Set(`${COMMON} ${SPECIFIC[dbms]}`.split(/\s+/).filter(Boolean))]),
) as Record<Dbms, Set<string>>;

export const isReserved = (dbms: Dbms, name: string) => RESERVED[dbms].has(name.toLowerCase());

/**
 * Identifiant tel qu'il doit être écrit pour la cible : entre délimiteurs s'il contient des
 * caractères spéciaux, s'il est un mot réservé de la cible, ou si sa casse est significative
 * (`caseSensitive`) et ne survit pas au repli de casse de la cible.
 */
export function quoteIdentifier(target: Target, name: string, caseSensitive = false): string {
  const folding = FOLDING[target.dbms];
  const plain = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
  const folded = folding === "lower" ? name.toLowerCase() : folding === "upper" ? name.toUpperCase() : name;
  const caseLost = caseSensitive && folding !== undefined && folded !== name;
  if (plain && !caseLost && !isReserved(target.dbms, name)) return name;
  const [open, close] = QUOTES[target.dbms];
  return `${open}${name.replaceAll(close, close + close)}${close}`;
}

// ---------------------------------------------------------------------------------------------
// Longueur des noms

/** Longueur maximale d'un identifiant (octets / caractères selon le SGBD). */
export function maxIdentifierLength(target: Target): number {
  switch (target.dbms) {
    case "postgresql":
      return 63;
    case "mysql":
    case "mariadb":
    case "access":
      return 64;
    case "oracle":
      // 128 octets depuis 12.2 ; 30 avant (11g, 12c 12.1) et par prudence en générique.
      return isAtLeast("oracle", target.version, "18c") ? 128 : 30;
    case "sqlserver":
    case "db2":
      return 128;
    case "sybase":
      return 255;
    case "sqlite":
      return Infinity;
  }
}

/** Raccourcit un nom trop long en gardant un suffixe stable (empreinte du nom complet). */
export function fitName(name: string, max: number): string {
  if (new TextEncoder().encode(name).length <= max) return name;
  let hash = 2166136261;
  for (const c of name) hash = Math.imul(hash ^ c.codePointAt(0)!, 16777619) >>> 0;
  const suffix = `_${hash.toString(16).padStart(8, "0")}`;
  let head = name;
  while (new TextEncoder().encode(head + suffix).length > max) head = head.slice(0, -1);
  return head + suffix;
}

// ---------------------------------------------------------------------------------------------
// Actions référentielles

type Event = "delete" | "update";

const ALL: ReferentialAction[] = ["cascade", "set null", "set default", "restrict", "no action"];

/** Actions acceptées par le SGBD, par événement. */
const ACTIONS: Record<Dbms, Record<Event, ReferentialAction[]>> = {
  postgresql: { delete: ALL, update: ALL },
  sqlite: { delete: ALL, update: ALL },
  // InnoDB rejette SET DEFAULT.
  mysql: { delete: ["cascade", "set null", "restrict", "no action"], update: ["cascade", "set null", "restrict", "no action"] },
  mariadb: { delete: ["cascade", "set null", "restrict", "no action"], update: ["cascade", "set null", "restrict", "no action"] },
  // Pas de RESTRICT (NO ACTION équivalent, mais vérifié immédiatement dans les deux cas).
  sqlserver: { delete: ["no action", "cascade", "set null", "set default"], update: ["no action", "cascade", "set null", "set default"] },
  // Oracle : ON DELETE CASCADE / SET NULL uniquement ; aucun ON UPDATE.
  oracle: { delete: ["cascade", "set null"], update: [] },
  db2: { delete: ["cascade", "set null", "restrict", "no action"], update: ["restrict", "no action"] },
  // Sybase ASE : aucune clause d'action ; l'intégrité référentielle est toujours restrictive.
  sybase: { delete: [], update: [] },
  // Access (SQL ANSI-92) : CASCADE et SET NULL.
  access: { delete: ["cascade", "set null"], update: ["cascade", "set null"] },
};

/** Comportement obtenu sans clause : NO ACTION, ou RESTRICT pour Sybase. */
const IMPLICIT: Partial<Record<Dbms, ReferentialAction[]>> = {
  sybase: ["no action", "restrict"],
  oracle: ["no action"],
  access: ["no action"],
};

export type ActionResult =
  | { kind: "emit"; sql: string }
  /** Équivalent au comportement par défaut : rien à écrire, rien de perdu. */
  | { kind: "implicit" }
  /** Non pris en charge : remplacé par `fallback` (souvent NO ACTION). */
  | { kind: "degraded"; sql: string; fallback: ReferentialAction };

export function referentialAction(target: Target, event: Event, action: ReferentialAction): ActionResult {
  const supported = ACTIONS[target.dbms][event];
  if (supported.includes(action)) return { kind: "emit", sql: `ON ${event.toUpperCase()} ${action.toUpperCase()}` };
  if (action === "no action" || (IMPLICIT[target.dbms]?.includes(action) ?? false)) return { kind: "implicit" };
  // RESTRICT → NO ACTION là où RESTRICT n'existe pas (SQL Server) : écrit explicitement.
  if (action === "restrict" && supported.includes("no action")) {
    return { kind: "degraded", sql: `ON ${event.toUpperCase()} NO ACTION`, fallback: "no action" };
  }
  return { kind: "degraded", sql: "", fallback: "no action" };
}

// ---------------------------------------------------------------------------------------------
// Divers

/** ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY possible (pas en SQLite). */
export const supportsAlterForeignKey = (target: Target) => target.dbms !== "sqlite";

/** CHECK appliqué (MySQL l'ignore avant 8.0.16). */
export const enforcesCheck = (target: Target) => !(target.dbms === "mysql" && target.version === "5.7");

/** Littéraux booléens TRUE / FALSE disponibles. */
export function hasBooleanLiterals(target: Target): boolean {
  switch (target.dbms) {
    case "postgresql":
    case "mysql":
    case "mariadb":
    case "sqlite":
      return true;
    case "oracle":
      return isAtLeast("oracle", target.version, "23ai");
    case "db2":
      return isAtLeast("db2", target.version, "11.1");
    default:
      return false;
  }
}

/** `localtimestamp` : date et heure locales à la seconde, sans fuseau (Oracle SYSDATE) (O-39). */
export type DateFunction = "current_date" | "current_time" | "current_timestamp" | "localtimestamp" | "localtimestamp_seconds" | "utc_timestamp";

/** Fonctions de date / heure courantes, écrites dans le dialecte cible (`null` : non disponible). */
export function dateFunction(target: Target, fn: DateFunction): string | null {
  // localtimestamp : heure locale (GETDATE, SYSDATETIME) ; localtimestamp_seconds : à la seconde
  // (Oracle SYSDATE) ; utc_timestamp : heure UTC sans fuseau (SYSUTCDATETIME, GETUTCDATE) (O-39, O-42).
  const mysqlExpressions = target.version !== "5.7";
  const table: Record<Dbms, Record<DateFunction, string | null>> = {
    postgresql: {
      current_date: "CURRENT_DATE",
      current_time: "CURRENT_TIME",
      current_timestamp: "CURRENT_TIMESTAMP",
      localtimestamp: "LOCALTIMESTAMP",
      localtimestamp_seconds: "LOCALTIMESTAMP(0)",
      utc_timestamp: "(now() AT TIME ZONE 'UTC')",
    },
    sqlite: {
      current_date: "CURRENT_DATE",
      current_time: "CURRENT_TIME",
      current_timestamp: "CURRENT_TIMESTAMP",
      localtimestamp: "(datetime('now', 'localtime'))",
      localtimestamp_seconds: "(datetime('now', 'localtime'))",
      utc_timestamp: "CURRENT_TIMESTAMP", // SQLite : CURRENT_TIMESTAMP est en UTC
    },
    // Expressions entre parenthèses en DEFAULT : MySQL 8.0.13+, MariaDB 10.2+.
    mysql: {
      current_date: mysqlExpressions ? "(CURRENT_DATE)" : null,
      current_time: mysqlExpressions ? "(CURRENT_TIME)" : null,
      current_timestamp: "CURRENT_TIMESTAMP",
      localtimestamp: "CURRENT_TIMESTAMP",
      localtimestamp_seconds: "CURRENT_TIMESTAMP",
      utc_timestamp: mysqlExpressions ? "(UTC_TIMESTAMP())" : null,
    },
    mariadb: {
      current_date: "(CURRENT_DATE)",
      current_time: "(CURRENT_TIME)",
      current_timestamp: "CURRENT_TIMESTAMP",
      localtimestamp: "CURRENT_TIMESTAMP",
      localtimestamp_seconds: "CURRENT_TIMESTAMP",
      utc_timestamp: "(UTC_TIMESTAMP())",
    },
    sqlserver: {
      current_date: "CAST(GETDATE() AS DATE)",
      current_time: "CAST(GETDATE() AS TIME)",
      current_timestamp: "CURRENT_TIMESTAMP",
      localtimestamp: "SYSDATETIME()",
      localtimestamp_seconds: "CAST(GETDATE() AS DATETIME2(0))",
      utc_timestamp: "SYSUTCDATETIME()",
    },
    oracle: {
      current_date: "CURRENT_DATE",
      current_time: null,
      current_timestamp: "CURRENT_TIMESTAMP",
      localtimestamp: "LOCALTIMESTAMP",
      localtimestamp_seconds: "SYSDATE",
      utc_timestamp: "SYS_EXTRACT_UTC(SYSTIMESTAMP)",
    },
    db2: {
      current_date: "CURRENT DATE",
      current_time: "CURRENT TIME",
      current_timestamp: "CURRENT TIMESTAMP",
      localtimestamp: "CURRENT TIMESTAMP",
      localtimestamp_seconds: "CURRENT TIMESTAMP",
      utc_timestamp: null,
    },
    sybase: { current_date: "current_date()", current_time: "current_time()", current_timestamp: "getdate()", localtimestamp: "getdate()", localtimestamp_seconds: "getdate()", utc_timestamp: "getutcdate()" },
    access: { current_date: "Date()", current_time: "Time()", current_timestamp: "Now()", localtimestamp: "Now()", localtimestamp_seconds: "Now()", utc_timestamp: null },
  };
  return table[target.dbms][fn];
}

/** Fonctions sans argument d'une valeur par défaut, hors dates (O-39). */
export type SpecialFunction = "current_user" | "uuid" | "uuid_sequential";

/** Fonction spéciale écrite dans le dialecte cible (`null` : non disponible en DEFAULT). */
export function specialFunction(target: Target, fn: SpecialFunction): string | null {
  // uuid_sequential : UUID croissant (NEWSEQUENTIALID) — uuidv7() à partir de PostgreSQL 18 (O-42).
  const pg = isAtLeast("postgresql", target.version, "13") ? "gen_random_uuid()" : null;
  const table: Record<Dbms, Record<SpecialFunction, string | null>> = {
    postgresql: { current_user: "CURRENT_USER", uuid: pg, uuid_sequential: isAtLeast("postgresql", target.version, "18") ? "uuidv7()" : pg },
    oracle: { current_user: "USER", uuid: "SYS_GUID()", uuid_sequential: "SYS_GUID()" },
    sqlserver: { current_user: "CURRENT_USER", uuid: "NEWID()", uuid_sequential: "NEWSEQUENTIALID()" },
    mysql: target.version === "5.7" ? { current_user: null, uuid: null, uuid_sequential: null } : { current_user: "(CURRENT_USER())", uuid: "(UUID())", uuid_sequential: "(UUID())" },
    mariadb: { current_user: "CURRENT_USER()", uuid: "UUID()", uuid_sequential: "UUID()" },
    db2: { current_user: "USER", uuid: null, uuid_sequential: null },
    sqlite: { current_user: null, uuid: null, uuid_sequential: null },
    sybase: { current_user: "user_name()", uuid: "newid()", uuid_sequential: "newid()" },
    access: { current_user: null, uuid: null, uuid_sequential: null },
  };
  return table[target.dbms][fn];
}

/** Affinité SQLite d'un type déclaré (documentation SQLite, « Datatypes », §3.1). */
export function sqliteAffinity(type: string): "INTEGER" | "TEXT" | "BLOB" | "REAL" | "NUMERIC" {
  const t = type.toUpperCase();
  if (t.includes("INT")) return "INTEGER";
  if (/CHAR|CLOB|TEXT/.test(t)) return "TEXT";
  if (t.includes("BLOB") || !t.trim()) return "BLOB";
  if (/REAL|FLOA|DOUB/.test(t)) return "REAL";
  return "NUMERIC";
}

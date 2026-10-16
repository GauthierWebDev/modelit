import { isAtLeast } from "../../dbms/versions";
import { type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED =
  reservedWords(`after alias allow application assumes audit aux auxiliary before binary bufferpool call called capture cascaded
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
volatile volumes while wlm write xmlelement xmlexists xmlnamespaces year years`);

export const db2 = (version: string | undefined): Dialect => ({
  ...standard,
  dbms: "db2",
  schemas: { create: (_, quoted) => `CREATE SCHEMA IF NOT EXISTS ${quoted};` },
  types: {
    ...standard.types,
    unboundedDecimal: { sql: "DECFLOAT(34)" },
    // LOB interdits dans les CHECK et les clés.
    boundedText: ({ compared, keyed }) => (compared || keyed ? 4000 : undefined),
    free: { rowversion: "BINARY(8)", uuid: "CHAR(36)", json: "CLOB", intervals: false },
  },
  // Colonnes calculées toujours stockées, sans mot-clé STORED.
  generated: {
    virtual: false,
    stored: true,
    typed: true,
    clause: (expression) => `GENERATED ALWAYS AS (${expression})`,
  },
  constraints: { ...standard.constraints, strictCheckTyping: true },
  indexes: { ...standard.indexes, expressions: true },
  comments: "statement",
  identifiers: { quotes: ['"', '"'], folding: "upper", reserved: RESERVED, maxLength: 128 },
  actions: {
    delete: ["cascade", "set null", "restrict", "no action"],
    update: ["restrict", "no action"],
    implicit: [],
  },
  expressions: {
    booleanLiterals: isAtLeast("db2", version, "11.1"),
    dates: {
      current_date: "CURRENT DATE",
      current_time: "CURRENT TIME",
      current_timestamp: "CURRENT TIMESTAMP",
      localtimestamp: "CURRENT TIMESTAMP",
      localtimestamp_seconds: "CURRENT TIMESTAMP",
      utc_timestamp: null,
    },
    functions: { current_user: "USER", uuid: null, uuid_sequential: null },
  },
});

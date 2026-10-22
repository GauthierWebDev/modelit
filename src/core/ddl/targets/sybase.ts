import { type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED =
  reservedWords(`arith_overflow break browse bulk cascade char_convert checkpoint close clustered commit compute confirm
connect continue controlrow convert count current cursor database dbcc deallocate declare deterministic disk double dummy
dump endtran errlvl errordata errorexit escape exclusive exec execute exit exp_row_size external fetch fillfactor func
goto holdlock identity identity_gap identity_start identity_insert if index inout install jar key kill lineno load lock
materialized max_rows_per_page mirror mirrorexit modify national new noholdlock nonclustered nonscrollable
non_sensitive numeric_truncation off offsets once online only open option out output over partition perm permanent plan
precision prepare print privileges proc procedure processexit proxy_table public quiesce raiserror read readpast
readtext reconfigure remove reorg replace replication reservepagegap return returns revoke role rollback rowcount rows
rule save schema scroll scrollable semi_sensitive sensitive setuser shared shutdown stringsize sum syb_identity
syb_restree syb_terminate temp textsize tran transaction trigger truncate tsequal unpartition use user_option
using varying view waitfor while writetext xmlextract xmlparse xmltest xmlvalidate`);

export const sybase = (): Dialect => ({
  ...standard,
  dbms: "sybase",
  generated: null,
  identifiers: { quotes: ['"', '"'], reserved: RESERVED, maxLength: 255 },
  // Aucune clause d'action ; l'intégrité référentielle est toujours restrictive.
  actions: { delete: [], update: [], implicit: ["no action", "restrict"] },
  expressions: {
    booleanLiterals: false,
    dates: {
      current_date: "current_date()",
      current_time: "current_time()",
      current_timestamp: "getdate()",
      localtimestamp: "getdate()",
      localtimestamp_seconds: "getdate()",
      utc_timestamp: "getutcdate()",
    },
    functions: { current_user: "user_name()", uuid: "newid()", uuid_sequential: "newid()" },
  },
});

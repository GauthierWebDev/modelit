import type { Dbms } from "../../dbms/dbms";
import type { Target } from "../dialects";
import { access } from "./access";
import { db2 } from "./db2";
import type { Dialect } from "./dialect";
import { mariadb, mysql } from "./mysql";
import { oracle } from "./oracle";
import { postgresql } from "./postgresql";
import { sqlite } from "./sqlite";
import { sqlserver } from "./sqlserver";
import { sybase } from "./sybase";

export type { Dialect, Usage } from "./dialect";

const DIALECTS: Record<Dbms, (version: string | undefined) => Dialect> = {
  postgresql,
  mysql,
  mariadb,
  oracle,
  sqlserver,
  sqlite,
  db2,
  sybase,
  access,
};

/** Règles du script pour la cible, à sa version. */
export const dialectOf = (target: Target): Dialect => DIALECTS[target.dbms](target.version);

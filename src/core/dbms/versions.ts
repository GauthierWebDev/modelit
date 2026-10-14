import { MSG } from "../validation/messages";
import type { Dbms } from "./dbms";

/**
 * Versions des SGBD cibles (override O-04).
 *
 * La version permet d'utiliser les mots-clés les plus adaptés disponibles
 * (ex. colonnes IDENTITY plutôt que SERIAL). La version « générique » applique
 * la correspondance de base, indépendante des versions.
 */
export const GENERIC_VERSION = "generic";

export interface DbmsVersion {
  id: string;
  label: string;
}

/** Du plus ancien au plus récent. */
export const DBMS_VERSIONS: Record<Dbms, DbmsVersion[]> = {
  access: [{ id: "2010", label: "2010 et +" }],
  db2: ["11.1", "11.5", "12.1"].map((v) => ({ id: v, label: v })),
  mariadb: ["10.6", "10.11", "11.4", "11.8"].map((v) => ({ id: v, label: v })),
  mysql: ["5.7", "8.0", "8.4"].map((v) => ({ id: v, label: v })),
  oracle: ["11g", "12c", "18c", "19c", "21c", "23ai"].map((v) => ({ id: v, label: v })),
  postgresql: ["9.6", "10", "11", "12", "13", "14", "15", "16", "17", "18"].map((v) => ({ id: v, label: v })),
  sqlserver: ["2012", "2014", "2016", "2017", "2019", "2022"].map((v) => ({ id: v, label: v })),
  sqlite: [{ id: "3", label: "3" }],
  sybase: ["15.7", "16.0"].map((v) => ({ id: v, label: `ASE ${v}` })),
};

export const latestVersion = (dbms: Dbms): string => DBMS_VERSIONS[dbms].at(-1)!.id;

/** Options proposées à l'utilisateur : la plus récente d'abord, la générique en dernier. */
export function versionOptions(dbms: Dbms): DbmsVersion[] {
  return [...DBMS_VERSIONS[dbms]].reverse().concat({ id: GENERIC_VERSION, label: MSG.genericVersion });
}

/** Version valide pour ce SGBD, sinon la plus récente. */
export function resolveVersion(dbms: Dbms, version: string | undefined): string {
  if (version === GENERIC_VERSION) return version;
  return DBMS_VERSIONS[dbms].some((v) => v.id === version) ? version! : latestVersion(dbms);
}

/** `version` est-elle au moins `since` ? Toujours faux pour la version générique. */
export function isAtLeast(dbms: Dbms, version: string | undefined, since: string): boolean {
  const list = DBMS_VERSIONS[dbms].map((v) => v.id);
  const index = version === undefined ? -1 : list.indexOf(version);
  const sinceIndex = list.indexOf(since);
  return index >= 0 && sinceIndex >= 0 && index >= sinceIndex;
}

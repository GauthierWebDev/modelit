import { type Build, key, type ResolvedFk } from "./buildState";
import type { ParsedTable } from "./parse";

/** Nom d'association libre : suffixe _2, _3… si le nom est déjà pris. */
export function associationName(b: Build, wanted: string) {
  let name = wanted;
  for (let i = 2; b.usedNames.has(key(name)); i += 1) {
    name = `${wanted}_${i}`;
  }
  b.usedNames.add(key(name));
  return name;
}

/**
 * Nom d'une association issue d'une clé étrangère (O-36, O-37), par ordre de priorité :
 *  a) nom de la contrainte sans préfixe ni nom de table (fk_premium_favori → favori) ;
 *  b) nom de la colonne sans suffixe _id / _fk (parrain_id → parrain) ;
 *  c) table_table, avec un suffixe distinctif si la paire est déjà reliée.
 * Un nom dérivé (a, b) est écarté s'il est déjà pris, ou s'il se réduit au nom d'une table
 * reliée ou à une abréviation de ce nom (« ex » pour Exemplaire, « labo » pour Laboratoire).
 */
export function dependencyName(b: Build, table: ParsedTable, fk: ResolvedFk) {
  const taken = (name: string) => !name || b.usedNames.has(key(name)) || b.entityNames.has(key(name));
  const linked = [key(table.name), key(fk.target.name)];
  const acceptable = (name: string | undefined): name is string =>
    Boolean(name) && !taken(name!) && !linked.some((t) => t.startsWith(key(name!)));
  const fromConstraint = constraintName(table, fk);
  if (acceptable(fromConstraint)) {
    return associationName(b, fromConstraint);
  }
  // Règle b) : pas quand la colonne porte le nom de la colonne référencée (matricule, code_service) (O-39).
  if (fk.columns.length === 1 && key(fk.columns[0]!) !== key(fk.referencedColumns[0]!)) {
    const fromColumn = fk.columns[0]!.replace(/_+(id|fk)$/i, "").replace(/^(id|fk)_+/i, "");
    if (acceptable(fromColumn)) {
      return associationName(b, fromColumn);
    }
  }
  return associationName(b, `${table.name}_${fk.target.name}`);
}

/** Règle a) : nom de la contrainte sans préfixe fk_ ni nom de table. */
function constraintName(table: ParsedTable, fk: ResolvedFk) {
  const tableTokens = key(table.name).split("_");
  return fk.name
    ?.replace(/^(fk|fkey)_+/i, "")
    .replace(/_+(fk|fkey)$/i, "")
    .replace(/^([a-z0-9]+)_+/i, (match, token: string) => {
      const t = key(token);
      // Nom de la table, l'une de ses parties, ou son abréviation (ex. « ex » pour Exemplaire).
      return t === key(table.name) || tableTokens.includes(t) || (t.length >= 2 && key(table.name).startsWith(t))
        ? ""
        : match;
    });
}

/**
 * Rôle de l'occurrence RÉFÉRENCÉE d'une association réflexive (O-36, corrigé par O-37) : tiré
 * de la colonne de la clé étrangère, sans _id / id_ ni le nom de la colonne référencée
 * (parrain_id → parrain, isbn_originale → originale). Il est porté par la patte 0,n ; la patte
 * 0,1 (côté référençant) reste sans rôle.
 */
export function reflexiveRole(table: ParsedTable, fk: ResolvedFk) {
  const index = Math.max(
    0,
    fk.columns.findIndex((c) => !table.primaryKey.some((p) => key(p) === key(c))),
  );
  const column = fk.columns[index]!;
  const referenced = key(fk.referencedColumns[index]!);
  let role = key(column)
    .replace(/_+(id|fk)$/, "")
    .replace(/^(id|fk)_+/, "");
  // Sans le nom de la colonne référencée (isbn_originale → originale) ni celui de la table
  // (service_parent → parent) (O-39).
  for (const part of [referenced, key(table.name)]) {
    if (role.startsWith(`${part}_`)) {
      role = role.slice(part.length + 1);
    } else if (role.endsWith(`_${part}`)) {
      role = role.slice(0, -part.length - 1);
    }
  }
  return role || column;
}

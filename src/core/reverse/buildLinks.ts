import type { Id, Link } from "../model/document";
import { foreignKeyDefaultName } from "../naming/keys";
import { MSG } from "../validation/messages";
import { type Build, key, originOf, type ResolvedFk, within } from "./buildState";
import type { ParsedTable } from "./parse";

/** Actions référentielles, nom et état de la contrainte sur une patte. */
export function applyForeignKey(link: Link, fk: ResolvedFk) {
  link.onDelete = fk.onDelete;
  link.onUpdate = fk.onUpdate;
  link.foreignKeyConstraintName = fk.name;
  if (fk.state) {
    link.foreignKeyState = fk.state;
  }
}

/** Renommages pour que les clés étrangères régénérées gardent les noms du script. */
export function foreignKeyNames(b: Build, fk: ResolvedFk) {
  const names: Record<Id, string> = {};
  fk.columns.forEach((column, i) => {
    const referenced = fk.referencedColumns[i]!;
    const origin = originOf(b, fk.target, referenced);
    const defaultName = foreignKeyDefaultName(
      b.doc.settings.keys.foreign,
      fk.target.name,
      referenced,
      fk.columns.length === 1,
    );
    if (origin && column !== defaultName) {
      names[origin.id] = column;
    }
  });
  return Object.keys(names).length > 0 ? names : undefined;
}

/** Commentaires des colonnes de la clé étrangère (rubriques référencées → texte). */
export function foreignKeyComments(b: Build, table: ParsedTable, fk: ResolvedFk) {
  const comments: Record<Id, string> = {};
  fk.columns.forEach((column, i) => {
    const comment = table.columns.find((c) => key(c.name) === key(column))?.comment;
    const origin = originOf(b, fk.target, fk.referencedColumns[i]!);
    if (comment && origin) {
      comments[origin.id] = comment;
    }
  });
  return Object.keys(comments).length > 0 ? comments : undefined;
}

/**
 * Colonnes de `fk` déjà fournies par la clé primaire (hors identifiant relatif) ou par une
 * autre clé étrangère traitée avant : elles seront réutilisées, pas dupliquées (O-29).
 */
export function sharedColumns(b: Build, table: ParsedTable, fk: ResolvedFk, before: ResolvedFk[]) {
  const relativeColumns = b.fks
    .get(table)!
    .filter((other) => other !== fk && within(other.columns, table.primaryKey))
    .flatMap((o) => o.columns);
  const provided = new Set([...table.primaryKey, ...relativeColumns, ...before.flatMap((o) => o.columns)].map(key));
  const shared = fk.columns.filter((c) => provided.has(key(c)));
  if (shared.length === 0 || within(fk.columns, table.primaryKey)) {
    return;
  }
  b.warnings.push(MSG.reverseSharedColumns(table.name, shared.join(", ")));
  return shared
    .map((c) => originOf(b, fk.target, fk.referencedColumns[fk.columns.findIndex((x) => key(x) === key(c))]!)?.id)
    .filter((id): id is Id => Boolean(id));
}

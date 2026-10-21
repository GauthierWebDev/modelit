import type { CatalogColumn } from "./catalog";
import { type Comparison, type Push, rangeCovers } from "./catalogCompare";

/** Différences d'une colonne présente des deux côtés. */
export function diffColumn(cmp: Comparison, c: CatalogColumn, d: CatalogColumn, push: Push) {
  // Colonne calculée sans type déclaré (SQL Server) : son type découle de l'expression (O-41).
  const typeless = Boolean(c.generated) && c.concept === "null";
  diffType(cmp, c, d, typeless, push);
  diffValues(cmp, c, d, typeless, push);
  diffDerivation(c, d, push);
  diffText(c, d, push);
}

function diffType(cmp: Comparison, c: CatalogColumn, d: CatalogColumn, typeless: boolean, push: Push) {
  const { affinityOnly, crossDialect } = cmp;
  const typeOk =
    typeless ||
    (affinityOnly
      ? c.affinity === d.affinity || Boolean(c.domain && d.domain)
      : crossDialect
        ? c.concept === d.concept
        : c.type === d.type);
  if (!typeOk) {
    push("type", `${c.type} → ${d.type}`, c.name);
  }
  if (c.autoIncrement !== d.autoIncrement && !(crossDialect && /serial|identity/i.test(d.type))) {
    push("autoIncrement", `${c.autoIncrement} → ${d.autoIncrement}`, c.name);
  }
}

/** NOT NULL, défaut, domaine, plage, collation. */
function diffValues(cmp: Comparison, c: CatalogColumn, d: CatalogColumn, typeless: boolean, push: Push) {
  if (c.notNull !== d.notNull) {
    push("notNull", `${c.notNull} → ${d.notNull}`, c.name);
  }
  if (c.default !== d.default) {
    push("default", `${c.default} → ${d.default}`, c.name);
  }
  if (c.domain !== d.domain) {
    push("domain", `${c.domain} → ${d.domain}`, c.name);
  }
  if (cmp.crossDialect && !cmp.affinityOnly && !typeless && !rangeCovers(c.range, d.range)) {
    push("range", `${c.range} → ${d.range}`, c.name);
  }
  // Collation : comparée quand la source en a une effective (sinon : celle de l'installation, inconnue).
  if (c.collation && c.collation !== (d.collation ?? d.defaultCollation)) {
    push("collation", `${c.collation} → ${d.collation ?? d.defaultCollation}`, c.name);
  }
}

/** Colonne calculée, ON UPDATE, compteur. */
function diffDerivation(c: CatalogColumn, d: CatalogColumn, push: Push) {
  if (c.generated !== d.generated) {
    push("generated", `${c.generated} → ${d.generated}`, c.name);
  }
  if (c.onUpdate !== d.onUpdate) {
    push("onUpdate", `${c.onUpdate} → ${d.onUpdate}`, c.name);
  }
  if (c.identityStart !== d.identityStart) {
    push("autoIncrement", `début ${c.identityStart} → ${d.identityStart}`, c.name);
  }
  if (c.identityIncrement !== d.identityIncrement) {
    push("autoIncrement", `pas ${c.identityIncrement} → ${d.identityIncrement}`, c.name);
  }
}

/** Commentaire, identité, séquence, chaîne vide, sémantique de longueur. */
function diffText(c: CatalogColumn, d: CatalogColumn, push: Push) {
  if ((c.comment ?? "") !== (d.comment ?? "")) {
    push("comment", `${c.comment} → ${d.comment}`, c.name);
  }
  if (c.identity !== d.identity) {
    push("autoIncrement", `identité ${c.identity ?? "by default"} → ${d.identity ?? "by default"}`, c.name);
  }
  if (c.sequence !== d.sequence) {
    push("sequence", `séquence ${c.sequence} → ${d.sequence}`, c.name);
  }
  if (c.emptyString && d.emptyString && c.emptyString !== d.emptyString) {
    push("emptyString", `'' ${c.emptyString} → ${d.emptyString}`, c.name);
  }
  if (c.lengthSemantics && d.lengthSemantics && c.lengthSemantics !== d.lengthSemantics) {
    push("type", `longueur ${c.lengthSemantics} → ${d.lengthSemantics}`, c.name);
  }
}

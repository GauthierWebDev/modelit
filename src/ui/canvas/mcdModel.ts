import type { Id, ModelDocument } from "@core/index";
import { useMemo } from "react";
import { associationNamesByLink, inheritanceGeometries, linkGeometries } from "./geometry";
import { layoutsOf } from "./viewport";

/** Géométrie et annotations du MCD dérivées du document (mémoïsées dans cet ordre). */
export function useMcdModel(doc: ModelDocument, selection: Id[]) {
  const layouts = useMemo(() => layoutsOf(doc), [doc]);
  const geometries = useMemo(
    () => linkGeometries(doc.links, layouts, doc.layout.bends),
    [doc.links, layouts, doc.layout.bends],
  );
  const inheritance = useMemo(
    () => inheritanceGeometries(doc.inheritances, doc.inheritanceLinks, layouts, doc.layout.bends),
    [doc.inheritances, doc.inheritanceLinks, layouts, doc.layout.bends],
  );
  const selected = useMemo(() => new Set(selection), [selection]);
  /** Associations qui référencent un identifiant alternatif (oeuvre(isbn)) plutôt que la clé primaire (O-36). */
  const referencedKeys = useMemo(() => {
    const map = new Map<string, { entity: string; attributes: string[] }>();
    for (const link of doc.links) {
      if (!link.referencedAttributes?.length) {
        continue;
      }
      const entity = doc.entities.find((e) => e.id === link.entityId);
      if (!entity) {
        continue;
      }
      const attributes = link.referencedAttributes.map((id) => entity.attributes.find((x) => x.id === id)?.name ?? "?");
      map.set(link.associationId, { entity: entity.name, attributes });
    }
    return map;
  }, [doc.links, doc.entities]);
  const linkNames = useMemo(
    () => associationNamesByLink({ links: doc.links, associations: doc.associations, entities: doc.entities }),
    [doc.links, doc.associations, doc.entities],
  );
  const functional = useMemo(() => {
    const ids = new Set<Id>();
    for (const l of doc.links) {
      if (l.cardinality.max === 1) {
        ids.add(l.associationId);
      }
    }
    return ids;
  }, [doc.links]);
  return { layouts, geometries, inheritance, selected, referencedKeys, linkNames, functional };
}

import type { DataType } from "../model/datatype";
import type { Association, CardinalityMax, Entity, InheritanceConstraint, ModelDocument } from "../model/document";
import {
  createAssociation,
  createAttribute,
  createEntity,
  createInheritance,
  createInheritanceLink,
  createLink,
  emptyDocument,
} from "../model/factory";

/**
 * Petit DSL de construction de modèles pour les tests.
 *
 *   model()
 *     .entity("CLIENT", ["id_client*", "nom"])
 *     .entity("COMMANDE", ["id_commande*"])
 *     .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
 *     .build()
 *
 * Rubrique : `nom` ; suffixe `*` = identifiant ; `nom:Type` non géré, utiliser `typed`.
 * Patte : `ENTITE min,max` ; suffixe `(R)` = identifiant relatif.
 */
export function model() {
  const doc: ModelDocument = emptyDocument();
  doc.settings.naming.typology = "conceptual";
  // Clés étrangères nommées comme la colonne référencée (masque [FK]) :
  // les tests de passage restent lisibles ; les masques ont leurs propres tests.
  doc.settings.keys.foreign = "<column>";

  const api = {
    entity(name: string, attributes: string[] = [], patch: Partial<Entity> = {}) {
      const e = createEntity(name);
      e.attributes = attributes.map(parseAttribute);
      doc.entities.push({ ...e, ...patch });
      return api;
    },
    association(name: string, legs: string[], attributes: string[] = [], patch: Partial<Association> = {}) {
      const a = createAssociation(name);
      a.attributes = attributes.map(parseAttribute);
      doc.associations.push({ ...a, ...patch });
      for (const leg of legs) {
        const m = /^(\S+) (\d+),(\d+|n)(\(R\))?$/.exec(leg);
        if (!m) {
          throw new Error(`Patte invalide : ${leg}`);
        }
        const entity = doc.entities.find((e) => e.name === m[1]);
        if (!entity) {
          throw new Error(`Entité inconnue : ${m[1]}`);
        }
        const link = createLink(a.id, entity.id);
        const max: CardinalityMax = m[3] === "n" ? "n" : Number(m[3]);
        link.cardinality = { min: Number(m[2]), max };
        link.relativeId = Boolean(m[4]);
        doc.links.push(link);
      }
      return api;
    },
    /** Héritage : `parent` = entité cible (surtype, `null` = non désignée), puis les sous-types. */
    inherit(parent: string | null, children: string[], constraint: InheritanceConstraint = "none") {
      const id = (name: string) => {
        const e = doc.entities.find((x) => x.name === name);
        if (!e) {
          throw new Error(`Entité inconnue : ${name}`);
        }
        return e.id;
      };
      const h = createInheritance();
      h.constraint = constraint;
      if (parent) {
        h.parentId = id(parent);
      }
      doc.inheritances.push(h);
      for (const name of [...(parent ? [parent] : []), ...children]) {
        doc.inheritanceLinks.push(createInheritanceLink(h.id, id(name)));
      }
      return api;
    },
    typed(entity: string, attribute: string, type: DataType) {
      const attr = doc.entities.find((e) => e.name === entity)?.attributes.find((a) => a.name === attribute);
      if (!attr) {
        throw new Error(`Rubrique inconnue : ${entity}.${attribute}`);
      }
      attr.type = type;
      return api;
    },
    build: () => doc,
  };
  return api;
}

function parseAttribute(spec: string) {
  const identifier = spec.endsWith("*");
  return createAttribute(identifier ? spec.slice(0, -1) : spec, { identifier });
}

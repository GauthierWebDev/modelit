import {
  type Attribute,
  type Id,
  MODEL_COLLECTIONS,
  type ModelCollection,
  type ModelDocument,
  type Point,
} from "@core/index";
import { type Draft, produce } from "immer";

/**
 * Opérations de session (O-05 ; J-01, phase 5a, D11) : différence entre deux états d'un document,
 * adressée par identifiant et non par position dans les listes. Une opération reste donc juste
 * quand d'autres participants ont ajouté ou retiré des objets entre-temps.
 *
 * Granularité : champ par champ pour les objets, rubrique par rubrique pour les entités et les
 * associations, clé par clé pour les paramètres, objet par objet pour la géométrie. Sur un même
 * champ, la dernière opération appliquée l'emporte (l'hôte les applique dans l'ordre reçu).
 */

export type CollectionName = ModelCollection;
/** Collections dont les objets portent des rubriques (sous-collection `attributes`). */
const WITH_ATTRIBUTES = new Set<CollectionName>(["entities", "associations"]);

type Item = { id: Id } & Record<string, unknown>;

export type Op =
  /** `owner` : rubrique de l'entité ou association `owner` ; `after` : identifiant précédent (null : en tête). */
  | { t: "add"; coll: CollectionName; owner?: Id; value: Item; after: Id | null }
  | { t: "remove"; coll: CollectionName; owner?: Id; id: Id }
  /** `value` absent : champ retiré. */
  | { t: "set"; coll: CollectionName; owner?: Id; id: Id; field: string; value?: unknown }
  | { t: "order"; coll: CollectionName; owner?: Id; ids: Id[] }
  | { t: "setting"; key: string; value: unknown }
  | { t: "position"; id: Id; value: Point | null }
  | { t: "bends"; id: Id; value: Point[] | null };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function diffItems(
  before: readonly Item[],
  after: readonly Item[],
  coll: CollectionName,
  owner: Id | undefined,
  ops: Op[],
) {
  const previous = new Map(before.map((x) => [x.id, x]));
  const next = new Map(after.map((x) => [x.id, x]));
  const where = owner ? { coll, owner } : { coll };
  for (const x of before) {
    if (!next.has(x.id)) {
      ops.push({ t: "remove", ...where, id: x.id });
    }
  }
  after.forEach((x, i) => {
    const old = previous.get(x.id);
    if (!old) {
      ops.push({ t: "add", ...where, value: x, after: i > 0 ? after[i - 1]!.id : null });
      return;
    }
    if (old === x) {
      return;
    }
    const nested = !owner && WITH_ATTRIBUTES.has(coll);
    diffFields(old, x, nested, where, ops);
    if (nested && old.attributes !== x.attributes) {
      diffItems(old.attributes as Item[], x.attributes as Item[], coll, x.id, ops);
    }
  });
  // Ordre des objets communs aux deux états (déplacement d'une rubrique, par exemple).
  const kept = after.filter((x) => previous.has(x.id)).map((x) => x.id);
  const was = before.filter((x) => next.has(x.id)).map((x) => x.id);
  if (!same(kept, was)) {
    ops.push({ t: "order", ...where, ids: after.map((x) => x.id) });
  }
}

/** Champs modifiés d'un objet présent des deux côtés (rubriques à part si `nested`). */
function diffFields(old: Item, x: Item, nested: boolean, where: { coll: CollectionName; owner?: Id }, ops: Op[]) {
  for (const field of new Set([...Object.keys(old), ...Object.keys(x)])) {
    if (field === "id" || (nested && field === "attributes") || same(old[field], x[field])) {
      continue;
    }
    ops.push(
      field in x ? { t: "set", ...where, id: x.id, field, value: x[field] } : { t: "set", ...where, id: x.id, field },
    );
  }
}

function diffRecord<T>(before: Record<Id, T>, after: Record<Id, T>, make: (id: Id, value: T | null) => Op, ops: Op[]) {
  for (const id of Object.keys(before)) {
    if (!(id in after)) {
      ops.push(make(id, null));
    }
  }
  for (const [id, value] of Object.entries(after)) {
    if (!same(before[id], value)) {
      ops.push(make(id, value));
    }
  }
}

/** Opérations qui transforment `before` en `after`. */
export function diff(before: ModelDocument, after: ModelDocument): Op[] {
  const ops: Op[] = [];
  if (before === after) {
    return ops;
  }
  if (before.settings !== after.settings) {
    const a = before.settings as unknown as Record<string, unknown>;
    const b = after.settings as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!same(a[key], b[key])) {
        ops.push({ t: "setting", key, value: b[key] });
      }
    }
  }
  for (const coll of MODEL_COLLECTIONS) {
    if (before[coll] !== after[coll]) {
      diffItems(before[coll] as unknown as Item[], after[coll] as unknown as Item[], coll, undefined, ops);
    }
  }
  if (before.layout.positions !== after.layout.positions) {
    diffRecord(before.layout.positions, after.layout.positions, (id, value) => ({ t: "position", id, value }), ops);
  }
  if (before.layout.bends !== after.layout.bends) {
    diffRecord(before.layout.bends, after.layout.bends, (id, value) => ({ t: "bends", id, value }), ops);
  }
  return ops;
}

/** Liste visée par une opération ; `null` si son propriétaire n'existe plus (opération ignorée). */
function target(d: Draft<ModelDocument>, coll: CollectionName, owner?: Id): Item[] | null {
  if (!owner) {
    return d[coll] as unknown as Item[];
  }
  const node = (d[coll] as unknown as Item[]).find((x) => x.id === owner);
  return node ? (node.attributes as Attribute[] as unknown as Item[]) : null;
}

function applyOne(d: Draft<ModelDocument>, op: Op) {
  if (op.t === "setting" || op.t === "position" || op.t === "bends") {
    applyDocumentOp(d, op);
    return;
  }
  const list = target(d, op.coll, op.owner);
  if (list) {
    applyListOp(list, op);
  }
}

/** Réglage, position, cassures. */
function applyDocumentOp(d: Draft<ModelDocument>, op: Extract<Op, { t: "setting" | "position" | "bends" }>) {
  switch (op.t) {
    case "setting":
      (d.settings as unknown as Record<string, unknown>)[op.key] = structuredClone(op.value);
      return;
    case "position":
      if (op.value) {
        d.layout.positions[op.id] = { ...op.value };
      } else {
        delete d.layout.positions[op.id];
      }
      return;
    case "bends":
      if (op.value?.length) {
        d.layout.bends[op.id] = op.value.map((p) => ({ ...p }));
      } else {
        delete d.layout.bends[op.id];
      }
      return;
  }
}

/** Ajout, retrait, champ, ordre, dans une liste d'objets ou de rubriques. */
function applyListOp(list: Item[], op: Extract<Op, { t: "add" | "remove" | "set" | "order" }>) {
  switch (op.t) {
    case "add": {
      // Déjà là (écho de sa propre opération) : l'objet prend la place que lui donne l'hôte, pour
      // que l'ordre des listes soit le même chez tous.
      const existing = list.findIndex((x) => x.id === op.value.id);
      const item = existing >= 0 ? list.splice(existing, 1)[0]! : structuredClone(op.value);
      const index = op.after === null ? 0 : list.findIndex((x) => x.id === op.after) + 1;
      list.splice(op.after !== null && index === 0 ? list.length : index, 0, item);
      return;
    }
    case "remove": {
      const index = list.findIndex((x) => x.id === op.id);
      if (index >= 0) {
        list.splice(index, 1);
      }
      return;
    }
    case "set":
      setField(list, op);
      return;
    case "order": {
      const rank = new Map(op.ids.map((id, i) => [id, i]));
      const listed = list.filter((x) => rank.has(x.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
      const others = list.filter((x) => !rank.has(x.id));
      list.splice(0, list.length, ...listed, ...others);
      return;
    }
  }
}

function setField(list: Item[], op: Extract<Op, { t: "set" }>) {
  const item = list.find((x) => x.id === op.id);
  if (!item) {
    return;
  }
  if ("value" in op) {
    item[op.field] = structuredClone(op.value);
  } else {
    delete item[op.field];
  }
}

/** Applique des opérations ; celles qui visent un objet disparu sont ignorées. */
export function apply(doc: ModelDocument, ops: readonly Op[]): ModelDocument {
  if (ops.length === 0) {
    return doc;
  }
  return produce(doc, (d) => {
    for (const op of ops) {
      applyOne(d, op);
    }
  });
}

import type { Association, DiagramLayout, Entity, Id, Inheritance, InheritanceLink, Link, ModelDocument, Point } from "./document";
import { newId } from "./factory";
import type { KeyMember } from "./physical";

/**
 * Copier / coller d'objets du MCD (override O-52). Un fragment est une copie autonome d'une
 * sélection : objets, rubriques, pattes et liens, positions et cassures. Le coller lui donne de
 * nouveaux identifiants et des noms libres dans le document cible.
 */

export const FRAGMENT_FORMAT = "modelit/fragment";

export interface ModelFragment {
  format: typeof FRAGMENT_FORMAT;
  version: 1;
  entities: Entity[];
  associations: Association[];
  inheritances: Inheritance[];
  links: Link[];
  inheritanceLinks: InheritanceLink[];
  layout: DiagramLayout;
}

/** Copie des objets `ids` (entités, associations, héritages) et de leurs traits ; null si rien. */
export function extractFragment(doc: ModelDocument, ids: Id[]): ModelFragment | null {
  const chosen = new Set(ids);
  const entities = doc.entities.filter((e) => chosen.has(e.id));
  const associations = doc.associations.filter((a) => chosen.has(a.id));
  const inheritances = doc.inheritances.filter((h) => chosen.has(h.id));
  if (!entities.length && !associations.length && !inheritances.length) return null;
  // Un trait suit son association ou son héritage ; sélectionné seul, il est ignoré.
  const links = doc.links.filter((l) => chosen.has(l.associationId));
  const inheritanceLinks = doc.inheritanceLinks.filter((l) => chosen.has(l.inheritanceId));
  const layout: DiagramLayout = { positions: {}, bends: {} };
  for (const node of [...entities, ...associations, ...inheritances]) {
    const position = doc.layout.positions[node.id];
    if (position) layout.positions[node.id] = position;
  }
  for (const link of [...links, ...inheritanceLinks]) {
    const bends = doc.layout.bends[link.id];
    if (bends?.length) layout.bends[link.id] = bends;
  }
  return structuredClone({ format: FRAGMENT_FORMAT, version: 1, entities, associations, inheritances, links, inheritanceLinks, layout });
}

/** Fragment relu du presse-papiers ; null pour tout autre contenu. */
export function parseFragment(text: string): ModelFragment | null {
  try {
    const data = JSON.parse(text) as Partial<ModelFragment>;
    if (data?.format !== FRAGMENT_FORMAT || data.version !== 1) return null;
    const lists = [data.entities, data.associations, data.inheritances, data.links, data.inheritanceLinks];
    if (!lists.every(Array.isArray) || !data.layout?.positions || !data.layout.bends) return null;
    return data as ModelFragment;
  } catch {
    return null;
  }
}

/**
 * Colle `fragment` dans `doc` (modifié sur place) et renvoie les identifiants des objets collés.
 * Dans le document d'origine (un objet copié y existe encore), les copies sont décalées de deux
 * pas de grille, autant de fois que nécessaire pour ne pas recouvrir un collage précédent.
 */
export function pasteFragment(doc: ModelDocument, fragment: ModelFragment): Id[] {
  const ids = new Map<Id, Id>();
  for (const node of [...fragment.entities, ...fragment.associations, ...fragment.inheritances]) {
    ids.set(node.id, newId());
    if ("attributes" in node) for (const a of node.attributes) ids.set(a.id, newId());
  }
  for (const link of [...fragment.links, ...fragment.inheritanceLinks]) ids.set(link.id, newId());
  const copy = remapIds(structuredClone(fragment), ids);

  // Noms libres : « Client » → « Client_2 », « Client_3 »…
  const entityNames = new Set(doc.entities.map((e) => e.name));
  const associationNames = new Set(doc.associations.map((a) => a.name));
  const logicalNames = new Set([...doc.entities, ...doc.associations].map((n) => n.logicalName).filter((n): n is string => Boolean(n)));
  for (const e of copy.entities) e.name = freeName(e.name, entityNames);
  for (const a of copy.associations) a.name = freeName(a.name, associationNames);
  for (const n of [...copy.entities, ...copy.associations]) {
    if (n.logicalName) n.logicalName = freeName(n.logicalName, logicalNames);
    withoutConstraintNames(n);
  }

  // Traits vers une entité non copiée : rattachés à l'original s'il existe, sinon abandonnés.
  const existing = new Set(doc.entities.map((e) => e.id));
  const pasted = new Set(copy.entities.map((e) => e.id));
  const reachable = (id: Id) => pasted.has(id) || existing.has(id);
  const links = copy.links.filter((l) => reachable(l.entityId));
  const inheritanceLinks = copy.inheritanceLinks.filter((l) => reachable(l.entityId));
  const dropped = new Set([...copy.links, ...copy.inheritanceLinks].map((l) => l.id).filter((id) => !links.some((l) => l.id === id) && !inheritanceLinks.some((l) => l.id === id)));
  for (const link of links) delete link.foreignKeyConstraintName;
  for (const h of copy.inheritances) {
    if (h.parentId && !inheritanceLinks.some((l) => l.inheritanceId === h.id && l.entityId === h.parentId)) h.parentId = undefined;
  }
  for (const n of [...copy.entities, ...copy.associations]) withoutLinks(n, dropped);

  const offset = pasteOffset(doc, fragment);
  for (const [id, p] of Object.entries(copy.layout.positions)) doc.layout.positions[id] = { x: p.x + offset, y: p.y + offset };
  for (const [id, bends] of Object.entries(copy.layout.bends)) {
    if (!dropped.has(id)) doc.layout.bends[id] = bends.map((p) => ({ x: p.x + offset, y: p.y + offset }));
  }
  doc.entities.push(...copy.entities);
  doc.associations.push(...copy.associations);
  doc.inheritances.push(...copy.inheritances);
  doc.links.push(...links);
  doc.inheritanceLinks.push(...inheritanceLinks);
  return [...copy.entities, ...copy.associations, ...copy.inheritances].map((n) => n.id);
}

/** Décalage des copies : 0 dans un autre document, sinon k × 2 pas de grille (premier k libre). */
function pasteOffset(doc: ModelDocument, fragment: ModelFragment): number {
  const nodes = [...fragment.entities, ...fragment.associations, ...fragment.inheritances];
  const present = new Set([...doc.entities, ...doc.associations, ...doc.inheritances].map((n) => n.id));
  if (!nodes.some((n) => present.has(n.id))) return 0;
  const step = 2 * doc.settings.grid.size;
  const anchor = fragment.layout.positions[nodes[0]!.id] ?? { x: 0, y: 0 };
  const occupied = (p: Point) => Object.values(doc.layout.positions).some((q) => q.x === p.x && q.y === p.y);
  let k = 1;
  while (occupied({ x: anchor.x + k * step, y: anchor.y + k * step })) k++;
  return k * step;
}

/** Premier nom libre : le nom lui-même, sinon base_2, base_3… (base : sans un « _N » déjà copié). */
export function freeName(name: string, taken: Set<string>): string {
  let result = name;
  if (taken.has(name)) {
    const suffixed = /^(.*)_(\d+)$/.exec(name);
    const base = suffixed && taken.has(suffixed[1]!) ? suffixed[1]! : name;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n++;
    result = `${base}_${n}`;
  }
  taken.add(result);
  return result;
}

/** Remplace partout (clés et valeurs) les identifiants de `ids` ; ce sont des UUID, sans ambiguïté. */
function remapIds<T>(value: T, ids: Map<Id, Id>): T {
  if (typeof value === "string") return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, ids)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [ids.get(k) ?? k, remapIds(v, ids)])) as T;
  }
  return value;
}

/**
 * Noms de contraintes, d'index, de séquences et déclencheurs : uniques dans une base, ils feraient
 * échouer le script s'ils étaient dupliqués. La copie les laisse au générateur.
 */
function withoutConstraintNames(node: Entity | Association) {
  delete node.primaryKeyName;
  delete node.triggers;
  delete node.sequences;
  for (const list of [node.alternateKeys, node.indexes, node.checks]) for (const item of list ?? []) delete item.name;
  for (const a of node.attributes) {
    delete a.sequence;
    if (a.check) delete a.check.name;
  }
}

/** Retire des clés et index les membres venus d'une patte abandonnée (et les clés vidées). */
function withoutLinks(node: Entity | Association, dropped: Set<Id>) {
  if (!dropped.size) return;
  const keep = (m: KeyMember) => !("linkId" in m) || !dropped.has(m.linkId);
  const prune = <K extends { members: KeyMember[]; prefixes?: (number | null)[]; include?: KeyMember[] }>(key: K): K => ({
    ...key,
    members: key.members.filter(keep),
    // Les longueurs de préfixe suivent les membres, position par position.
    ...(key.prefixes && { prefixes: key.prefixes.filter((_, i) => keep(key.members[i]!)) }),
    ...(key.include && { include: key.include.filter(keep) }),
  });
  if (node.alternateKeys) node.alternateKeys = node.alternateKeys.map(prune).filter((k) => k.members.length);
  if (node.indexes) node.indexes = node.indexes.map(prune).filter((k) => k.members.length);
}

import type { Entity, ModelDocument } from "@core/index";
import { describe, it } from "vitest";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import { session } from "./memorySession";

/** Générateur congruentiel linéaire : suite reproductible pour une graine donnée. */
function seeded(seed: number) {
  let state = seed;
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(random() * list.length)];
  return { random, pick };
}

interface Target {
  actor: DocumentHandle;
  doc: ModelDocument;
  entity: Entity | undefined;
  pick: <T>(list: T[]) => T | undefined;
}

/** Une action tirée au hasard : création, renommage, suppression, rubriques, déplacement, annulation, lien. */
function randomAction(
  { actor, doc, entity, pick }: Target,
  { random, seed, step }: { random: () => number; seed: number; step: number },
) {
  switch (Math.floor(random() * 7)) {
    case 0:
      cmd.addEntity(actor, { x: step * 10, y: 0 });
      break;
    case 1:
      if (entity) {
        cmd.renameNode(actor, entity.id, `E${step}`);
      }
      break;
    case 2:
      if (entity) {
        cmd.deleteObjects(actor, [entity.id]);
      }
      break;
    case 3:
      if (entity) {
        cmd.setAttributes(actor, entity.id, [
          ...entity.attributes,
          { id: `a${seed}-${step}`, name: `r${step}`, identifier: false, notNull: false, unique: false },
        ]);
      }
      break;
    case 4:
      if (entity) {
        cmd.moveNodes(actor, new Map([[entity.id, { x: step, y: step }]]));
      }
      break;
    case 5:
      actor.store.getState().undo();
      break;
    case 6: {
      const other = pick(doc.entities);
      if (entity && other && entity.id !== other.id) {
        cmd.connectNodes(actor, entity.id, other.id, { associationPosition: { x: 0, y: 0 } });
      }
      break;
    }
  }
}

/** Session collaborative (O-05 ; J-01, phase 5a, D11) : convergence sous des livraisons irrégulières. */
describe("session collaborative", () => {
  it("200 actions mêlées, livraisons irrégulières : tous convergent (graine fixe)", () => {
    for (const seed of [1, 7, 42]) {
      const { random, pick } = seeded(seed);
      const { h, net, converged } = session();
      const actors = [h.alice, h.bob, h.claire];
      for (let step = 0; step < 200; step += 1) {
        const actor = pick(actors)!;
        const { doc } = actor.store.getState();
        const entity = pick(doc.entities);
        randomAction({ actor, doc, entity, pick }, { random, seed, step });
        if (random() < 0.3) {
          net.flush();
        }
      }
      converged();
    }
  });
});

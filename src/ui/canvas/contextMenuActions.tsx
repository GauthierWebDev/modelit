import {
  bendsOf,
  diagramLinks,
  diagramNodes,
  type Entity,
  type Id,
  type Link,
  type ModelDocument,
  type Point,
} from "@core/index";
import { ClipboardPaste } from "lucide-react";
import { hasCopy, pasteText } from "@/app/clipboardCommands";
import * as cmd from "@/app/commands";
import type { DocumentHandle } from "@/app/document/handle";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { MOD, MODEL_SETTINGS_SHORTCUT } from "@/ui/shortcuts";
import { mainCommand } from "@/ui/windows/mainCommands";
import {
  type Action,
  addAttributeAction,
  arrangeActions,
  CARDINALITIES,
  editingActions,
  notifyError,
  SEPARATOR,
} from "./actionItems";
import { INHERITANCE_SIZE, snap } from "./geometry";
import { fitToWindow, revealObjects } from "./viewport";

export function buildContextActions(
  doc: DocumentHandle,
  id: Id | null,
  point: Point,
  model: ReturnType<DocumentHandle["store"]["getState"]>["doc"],
  view: string,
  selection: Id[],
): Action[] {
  if (!id) {
    return emptyActions(doc, point, model, view);
  }

  // Plusieurs objets sélectionnés, dont celui-ci : actions sur toute la sélection.
  if (selection.length > 1 && selection.includes(id)) {
    return [
      { kind: "row", id: "arrange", items: arrangeActions(doc) },
      SEPARATOR,
      ...editingActions(doc, selection.length),
    ];
  }

  const entity = model.entities.find((e) => e.id === id);
  if (entity) {
    return entityActions(doc, entity);
  }
  if (model.associations.some((a) => a.id === id)) {
    return [...editingActions(doc, 1), SEPARATOR, addAttributeAction(doc, id)];
  }
  if (model.inheritances.some((h) => h.id === id)) {
    return editingActions(doc, 1);
  }

  const link = model.links.find((l) => l.id === id);
  if (link) {
    return linkActions(doc, link, model);
  }
  if (model.inheritanceLinks.some((l) => l.id === id)) {
    return [
      {
        kind: "item",
        id: "delete",
        label: t("actions.deleteLink"),
        shortcut: "⌫",
        run: () => cmd.deleteObjects(doc, [id]),
      },
    ];
  }
  return [];
}

/** Clic droit dans le vide : coller ici, créer, tout sélectionner, placer, cadrer, paramètres. */
function emptyActions(doc: DocumentHandle, point: Point, model: ModelDocument, view: string): Action[] {
  const grid = model.settings.grid.size;
  const at = { x: snap(point.x, grid), y: snap(point.y, grid) };
  const select = (ids: Id[]) => doc.view.getState().select(ids);
  const mcd = view === "mcd";
  return [
    {
      kind: "item",
      id: "pasteHere",
      label: t("actions.pasteHere"),
      icon: <ClipboardPaste size={14} />,
      disabled: !hasCopy(),
      run: () => pasteText(doc, undefined, at) && revealObjects(doc, doc.view.getState().selection),
    },
    SEPARATOR,
    {
      kind: "item",
      id: "newEntity",
      label: t("actions.newEntity"),
      shortcut: "E",
      run: () => select([cmd.addEntity(doc, at)]),
    },
    ...(mcd ? mcdCreationActions(doc, point, grid, select) : []),
    SEPARATOR,
    {
      kind: "item",
      id: "selectAll",
      label: t("actions.selectAll"),
      shortcut: `${MOD}A`,
      run: () => select([...diagramNodes(model), ...diagramLinks(model)].map((o) => o.id)),
    },
    {
      kind: "item",
      id: "autoLayout",
      label: t("actions.autoLayout"),
      disabled: doc.view.getState().layoutRunning,
      run: () => mainCommand({ name: "autoLayout" }),
    },
    { kind: "item", id: "fit", label: t("actions.fit"), shortcut: "⇧F", run: () => fitToWindow(doc) },
    SEPARATOR,
    {
      kind: "item",
      id: "modelSettings",
      label: t("menu.modelSettings"),
      shortcut: MODEL_SETTINGS_SHORTCUT,
      run: () => useUiStore.getState().setModelSettingsOpen(true),
    },
  ];
}

function entityActions(doc: DocumentHandle, entity: Entity): Action[] {
  const { id } = entity;
  return [
    ...editingActions(doc, 1),
    SEPARATOR,
    addAttributeAction(doc, id),
    {
      kind: "item",
      id: "autoDiscriminant",
      label: t("inspector.autoDiscriminant"),
      run: () => notifyError(cmd.addAutoIdentifier(doc, id)),
    },
    {
      kind: "item",
      id: "fictive",
      label: t("actions.fictive"),
      checked: entity.fictive,
      run: () => cmd.updateEntity(doc, id, { fictive: !entity.fictive }),
    },
  ];
}

/** Patte : cardinalités, identifiant relatif, redresser, supprimer. */
function linkActions(doc: DocumentHandle, link: Link, model: ModelDocument): Action[] {
  const { id } = link;
  const bends = bendsOf(model.layout, id).length;
  return [
    ...CARDINALITIES.map(
      (c): Action => ({
        kind: "item",
        id: `cardinality-${c.min}-${c.max}`,
        label: `${c.min},${c.max}`,
        checked: link.cardinality.min === c.min && link.cardinality.max === c.max,
        run: () => notifyError(cmd.setLinkCardinality(doc, id, c)),
      }),
    ),
    SEPARATOR,
    {
      kind: "item",
      id: "relativeId",
      label: t("inspector.relativeId"),
      checked: link.relativeId,
      run: () => cmd.updateLink(doc, id, { relativeId: !link.relativeId }),
    },
    ...(bends > 0
      ? ([
          {
            kind: "item",
            id: "straighten",
            label: t("inspector.straighten", { n: bends }),
            run: () => cmd.straightenLink(doc, id),
          },
        ] satisfies Action[])
      : []),
    SEPARATOR,
    {
      kind: "item",
      id: "delete",
      label: t("actions.deleteLeg"),
      shortcut: "⌫",
      run: () => cmd.deleteObjects(doc, [id]),
    },
  ];
}

/** MCD seulement : nouvelle association, nouvel héritage. */
function mcdCreationActions(doc: DocumentHandle, point: Point, grid: number, select: (ids: Id[]) => void): Action[] {
  const at = { x: snap(point.x, grid), y: snap(point.y, grid) };
  return [
    {
      kind: "item",
      id: "newAssociation",
      label: t("actions.newAssociation"),
      shortcut: "A",
      run: () => select([cmd.addAssociation(doc, at)]),
    },
    {
      kind: "item",
      id: "newInheritance",
      label: t("actions.newInheritance"),
      shortcut: "H",
      // Le triangle est centré sur le point, comme à la création au clic.
      run: () =>
        select([
          cmd.addInheritance(doc, {
            x: snap(point.x - INHERITANCE_SIZE.width / 2, grid),
            y: snap(point.y - INHERITANCE_SIZE.height / 2, grid),
          }),
        ]),
    },
  ];
}

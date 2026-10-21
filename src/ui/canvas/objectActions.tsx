import { bendsOf, type Cardinality, diagramLinks, diagramNodes, type Id, type Point } from "@core/index";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ClipboardPaste,
  Copy,
  CopyPlus,
  ListPlus,
  Scissors,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { copySelection, cutSelection, duplicateSelection, hasCopy, pasteText } from "@/app/clipboardCommands";
import { selectReadOnlyTab, useCollabStore } from "@/app/collab/session";
import * as cmd from "@/app/commands";
import { revealSection } from "@/app/dock/actions";
import type { DocumentHandle } from "@/app/document/handle";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { MOD, MODEL_SETTINGS_SHORTCUT } from "@/ui/shortcuts";
import { mainCommand } from "@/ui/windows/mainCommands";
import { alignSelection, distributeSelection, selectedBoxes } from "./arrange";
import { useContextMenu } from "./ContextMenu";
import { INHERITANCE_SIZE, snap } from "./geometry";
import { clientToModel, fitToWindow, revealObjects } from "./viewport";

/**
 * Actions sur le schéma (override O-53), partagées par le bouton « ⋯ » et le menu contextuel.
 * Elles passent par les mêmes commandes que les raccourcis (O-52, app/commands).
 */

export interface ActionItem {
  kind: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  run: () => void;
}

/** `row` : rangée d'icônes (ex. disposition, O-57). */
export type Action = ActionItem | { kind: "separator" } | { kind: "row"; id: string; items: ActionItem[] };

const SEPARATOR: Action = { kind: "separator" };
/** Actions encore permises dans une session en lecture seule. */
const READ_ONLY_ALLOWED = new Set(["copy", "selectAll", "fit", "modelSettings"]);

const notifyError = (message: string | null) =>
  message && useUiStore.getState().notify({ kind: "error", text: message });

/** Copie aussi dans le presse-papiers du système quand c'est possible (autre instance de ModelIt). */
const toSystemClipboard = (text: string | null) =>
  void (
    text &&
    navigator.clipboard?.writeText(text).catch(() => {
      // Presse-papiers du système refusé : la copie interne suffit.
    })
  );

function editingActions(doc: DocumentHandle, count: number): Action[] {
  const selection = () => doc.view.getState().selection;
  return [
    {
      kind: "item",
      id: "copy",
      label: t("actions.copy"),
      icon: <Copy size={14} />,
      shortcut: `${MOD}C`,
      run: () => toSystemClipboard(copySelection(doc)),
    },
    {
      kind: "item",
      id: "cut",
      label: t("actions.cut"),
      icon: <Scissors size={14} />,
      shortcut: `${MOD}X`,
      run: () => toSystemClipboard(cutSelection(doc)),
    },
    {
      kind: "item",
      id: "duplicate",
      label: t("actions.duplicate"),
      icon: <CopyPlus size={14} />,
      shortcut: `${MOD}D`,
      run: () => duplicateSelection(doc) && revealObjects(doc, selection()),
    },
    {
      kind: "item",
      id: "delete",
      label: count > 1 ? t("actions.deleteMany", { n: count }) : t("actions.delete"),
      icon: <Trash2 size={14} />,
      shortcut: "⌫",
      run: () => cmd.deleteObjects(doc, selection()),
    },
  ];
}

function addAttributeAction(doc: DocumentHandle, ownerId: Id): Action {
  return {
    kind: "item",
    id: "addAttribute",
    label: t("actions.addAttribute"),
    icon: <ListPlus size={14} />,
    run: () => {
      const id = cmd.addAttribute(doc, ownerId);
      if (!id) {
        return;
      }
      revealSection("attributes");
      useUiStore.getState().editAttribute(id);
    },
  };
}

const ALIGN_ICONS = {
  left: <AlignStartVertical size={14} />,
  center: <AlignCenterVertical size={14} />,
  right: <AlignEndVertical size={14} />,
  top: <AlignStartHorizontal size={14} />,
  middle: <AlignCenterHorizontal size={14} />,
  bottom: <AlignEndHorizontal size={14} />,
} as const;

/**
 * Aligner (à partir de deux objets) et répartir (à partir de trois) la sélection (override O-57) :
 * section Propriétés et menu contextuel d'une sélection multiple.
 */
export function arrangeActions(doc: DocumentHandle): ActionItem[] {
  const count = selectedBoxes(doc).length;
  return [
    ...(Object.keys(ALIGN_ICONS) as (keyof typeof ALIGN_ICONS)[]).map(
      (id): ActionItem => ({
        kind: "item",
        id: `align-${id}`,
        label: t(`arrange.align.${id}`),
        icon: ALIGN_ICONS[id],
        disabled: count < 2,
        run: () => alignSelection(doc, id),
      }),
    ),
    {
      kind: "item",
      id: "distribute-horizontal",
      label: t("arrange.distribute.horizontal"),
      icon: <AlignHorizontalSpaceBetween size={14} />,
      disabled: count < 3,
      run: () => distributeSelection(doc, "horizontal"),
    },
    {
      kind: "item",
      id: "distribute-vertical",
      label: t("arrange.distribute.vertical"),
      icon: <AlignVerticalSpaceBetween size={14} />,
      disabled: count < 3,
      run: () => distributeSelection(doc, "vertical"),
    },
  ];
}

/** Actions du bouton « ⋯ » d'une entité ou d'une association. */
export function quickActions(doc: DocumentHandle, ownerId: Id): Action[] {
  const [copy, , duplicate, remove] = editingActions(doc, 1);
  return [addAttributeAction(doc, ownerId), copy!, duplicate!, remove!];
}

const CARDINALITIES: Cardinality[] = [
  { min: 0, max: 1 },
  { min: 1, max: 1 },
  { min: 0, max: "n" },
  { min: 1, max: "n" },
];

/**
 * Clic droit sur le canevas avec l'outil Sélection : `id` est l'objet sous le pointeur (null : le
 * vide). Un objet non sélectionné est sélectionné d'abord ; déjà sélectionné, la sélection reste.
 */
export function openCanvasMenu(
  doc: DocumentHandle,
  e: { clientX: number; clientY: number; preventDefault: () => void },
  id: Id | null,
) {
  e.preventDefault();
  const { selection, select } = doc.view.getState();
  if (id && !selection.includes(id)) {
    select([id]);
  }
  const point = clientToModel(doc, { x: e.clientX, y: e.clientY });
  useContextMenu.getState().open(e.clientX, e.clientY, contextActions(doc, id, point));
}

/** Contenu du menu contextuel : `id` est l'objet sous le pointeur (null : le vide), `point` le point du modèle. */
export function contextActions(doc: DocumentHandle, id: Id | null, point: Point): Action[] {
  const model = doc.store.getState().doc;
  const { view, selection } = doc.view.getState();
  const readOnly = selectReadOnlyTab(useCollabStore.getState()) === doc.id;
  const actions = buildContextActions(doc, id, point, model, view, selection);
  if (!readOnly) {
    return actions;
  }
  const allowed = actions.filter((a) => a.kind === "separator" || (a.kind === "item" && READ_ONLY_ALLOWED.has(a.id)));
  // Pas de séparateur en tête, en fin, ni doublé.
  return allowed.filter(
    (a, i) => a.kind !== "separator" || (i > 0 && i < allowed.length - 1 && allowed[i - 1]!.kind !== "separator"),
  );
}

function buildContextActions(
  doc: DocumentHandle,
  id: Id | null,
  point: Point,
  model: ReturnType<DocumentHandle["store"]["getState"]>["doc"],
  view: string,
  selection: Id[],
): Action[] {
  const grid = model.settings.grid.size;
  const at = { x: snap(point.x, grid), y: snap(point.y, grid) };
  const select = (ids: Id[]) => doc.view.getState().select(ids);

  if (!id) {
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
      ...(mcd
        ? ([
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
          ] satisfies Action[])
        : []),
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
  if (model.associations.some((a) => a.id === id)) {
    return [...editingActions(doc, 1), SEPARATOR, addAttributeAction(doc, id)];
  }
  if (model.inheritances.some((h) => h.id === id)) {
    return editingActions(doc, 1);
  }

  const link = model.links.find((l) => l.id === id);
  if (link) {
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

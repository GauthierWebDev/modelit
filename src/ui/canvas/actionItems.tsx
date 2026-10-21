import type { Cardinality, Id } from "@core/index";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Copy,
  CopyPlus,
  ListPlus,
  Scissors,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { copySelection, cutSelection, duplicateSelection } from "@/app/clipboardCommands";
import * as cmd from "@/app/commands";
import { revealSection } from "@/app/dock/actions";
import type { DocumentHandle } from "@/app/document/handle";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { MOD } from "@/ui/shortcuts";
import { alignSelection, distributeSelection, selectedBoxes } from "./arrange";
import { revealObjects } from "./viewport";

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

export const SEPARATOR: Action = { kind: "separator" };

export const notifyError = (message: string | null) =>
  message && useUiStore.getState().notify({ kind: "error", text: message });

/** Copie aussi dans le presse-papiers du système quand c'est possible (autre instance de ModelIt). */
const toSystemClipboard = (text: string | null) =>
  void (
    text &&
    navigator.clipboard?.writeText(text).catch(() => {
      // Presse-papiers du système refusé : la copie interne suffit.
    })
  );

export function editingActions(doc: DocumentHandle, count: number): Action[] {
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

export function addAttributeAction(doc: DocumentHandle, ownerId: Id): Action {
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

export const CARDINALITIES: Cardinality[] = [
  { min: 0, max: 1 },
  { min: 1, max: 1 },
  { min: 0, max: "n" },
  { min: 1, max: "n" },
];

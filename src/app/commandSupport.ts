import type { Id, ModelDocument } from "@core/index";
import type { Draft } from "immer";
import type { MessageKey } from "@/i18n";
import type { DocumentHandle } from "./document/handle";

export const current = (doc: DocumentHandle) => doc.store.getState().doc;

export const change = (doc: DocumentHandle, label: MessageKey, recipe: (d: Draft<ModelDocument>) => void) =>
  doc.store.getState().change(label, recipe);

export const findNode = (d: Draft<ModelDocument>, id: Id) =>
  d.entities.find((e) => e.id === id) ?? d.associations.find((a) => a.id === id);

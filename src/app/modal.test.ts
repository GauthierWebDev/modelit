import { afterEach, describe, expect, it } from "vitest";
import { confirmDialog, useDialogStore } from "./dialogStore";
import { modalOpen } from "./modal";
import { useUiStore } from "./uiStore";

const closed = useUiStore.getState();

afterEach(() => {
  useUiStore.setState(closed);
  useDialogStore.setState({ queue: [] });
});

/** Boîte modale ouverte : fenêtres flottantes bloquées, assistant IA en attente (O-46, O-47 ; A-01, A-5). */
describe("boîte modale ouverte", () => {
  it("aucune boîte : non", () => {
    expect(modalOpen()).toBe(false);
  });

  it("chaque boîte de l'application compte", () => {
    for (const open of [
      { exportOpen: true },
      { optionsOpen: true },
      { modelSettingsOpen: true },
      { reverseOpen: true },
      { shareOpen: true },
      { about: "about" as const },
    ]) {
      useUiStore.setState({ ...closed, ...open });
      expect(modalOpen()).toBe(true);
    }
  });

  it("une confirmation en attente compte", () => {
    void confirmDialog({ title: "t", message: "m", okLabel: "ok", cancelLabel: "annuler" });
    expect(modalOpen()).toBe(true);
  });
});

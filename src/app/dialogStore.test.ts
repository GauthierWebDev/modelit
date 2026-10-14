import { beforeEach, describe, expect, it } from "vitest";
import { alertDialog, confirmDialog, settleDialog, showWarnings, useDialogStore } from "./dialogStore";

describe("boîtes de dialogue de l'application", () => {
  beforeEach(() => useDialogStore.setState({ queue: [] }));

  it("confirmation : la promesse donne la réponse de l'utilisateur", async () => {
    const answer = confirmDialog({ title: "T", message: "M", okLabel: "OK", cancelLabel: "Annuler", tone: "danger" });
    const [request] = useDialogStore.getState().queue;
    expect(request).toMatchObject({ kind: "confirm", tone: "danger", title: "T" });
    settleDialog(request!.id, false);
    await expect(answer).resolves.toBe(false);
    expect(useDialogStore.getState().queue).toEqual([]);
  });

  it("file : une boîte à la fois, dans l'ordre", async () => {
    const order: string[] = [];
    const first = alertDialog({ title: "1", message: "a", okLabel: "OK" }).then(() => order.push("1"));
    const second = confirmDialog({ title: "2", message: "b", okLabel: "OK", cancelLabel: "Non" }).then((ok) => order.push(`2:${ok}`));
    expect(useDialogStore.getState().queue.map((r) => r.title)).toEqual(["1", "2"]);
    settleDialog(useDialogStore.getState().queue[0]!.id, true);
    await first;
    expect(useDialogStore.getState().queue.map((r) => r.title)).toEqual(["2"]);
    settleDialog(useDialogStore.getState().queue[0]!.id, true);
    await second;
    expect(order).toEqual(["1", "2:true"]);
  });

  it("avertissements groupés en une seule boîte", () => {
    void showWarnings(["x", "y"]);
    const queue = useDialogStore.getState().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: "alert", tone: "warning", detail: "• x\n• y" });
  });
});

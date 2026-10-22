import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n";
import { settleDialog, useDialogStore } from "./dialogStore";
import { usePreferencesStore } from "./preferencesStore";
import { useUiStore } from "./uiStore";
import { type AvailableUpdate, setUpdateSource, type UpdateSource } from "./updateSource";
import { checkForUpdatesNow, scheduleUpdateCheck } from "./updates";
import { resetWorkspace } from "./workspace";

/** Fausse source de mises à jour : les appels à `check` sont comptés. */
function fakeSource(overrides: Partial<UpdateSource> = {}) {
  const source = {
    supported: () => true,
    configured: () => Promise.resolve(true),
    check: vi.fn(() => Promise.resolve(null as AvailableUpdate | null)),
    ...overrides,
  };
  setUpdateSource(source);
  return source;
}

const update = (install: AvailableUpdate["install"] = () => Promise.resolve()): AvailableUpdate => ({
  version: "9.9.9",
  currentVersion: "0.6.0",
  notes: "Nouveautés",
  install,
});

/** Boîte affichée par la vérification, fermée avec la réponse `ok`. */
async function answer(ok: boolean) {
  await vi.waitFor(() => expect(useDialogStore.getState().queue.length).toBeGreaterThan(0));
  const [request] = useDialogStore.getState().queue;
  settleDialog(request!.id, ok);
  return request!;
}

beforeEach(() => resetWorkspace());
afterEach(() => {
  useDialogStore.setState({ queue: [] });
  vi.useRealTimers();
});

/** Vérification automatique au lancement (désactivable dans les options). */
describe("mises à jour : vérification au lancement", () => {
  it("plateforme sans mises à jour (navigateur) : aucune vérification", () => {
    vi.useFakeTimers();
    const source = fakeSource({ supported: () => false });
    scheduleUpdateCheck();
    vi.advanceTimersByTime(10_000);
    expect(source.check).not.toHaveBeenCalled();
  });

  it("après un délai, si l'option est active ; silencieuse sans mise à jour", async () => {
    vi.useFakeTimers();
    usePreferencesStore.setState({ updateCheck: true });
    const source = fakeSource();
    scheduleUpdateCheck();
    expect(source.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(source.check).toHaveBeenCalledOnce();
    expect(useDialogStore.getState().queue).toEqual([]);
  });

  it("option désactivée : aucune vérification", async () => {
    vi.useFakeTimers();
    usePreferencesStore.setState({ updateCheck: false });
    const source = fakeSource();
    scheduleUpdateCheck();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.check).not.toHaveBeenCalled();
    usePreferencesStore.setState({ updateCheck: true });
  });
});

/** Vérification demandée depuis les options : le résultat est toujours signalé. */
describe("mises à jour : vérification demandée", () => {
  it("build sans adresse de mise à jour : signalé", async () => {
    fakeSource({ configured: () => Promise.resolve(false) });
    const done = checkForUpdatesNow();
    expect((await answer(true)).message).toBe(t("update.notConfigured"));
    await done;
  });

  it("à jour : signalé", async () => {
    fakeSource();
    const done = checkForUpdatesNow();
    expect((await answer(true)).message).toBe(t("update.upToDate"));
    await done;
  });

  it("échec de la vérification : message avec la cause", async () => {
    fakeSource({ check: vi.fn(() => Promise.reject(new Error("hors ligne"))) });
    const done = checkForUpdatesNow();
    expect((await answer(true)).message).toMatch(/hors ligne/);
    await done;
  });

  it("mise à jour proposée puis refusée : rien n'est installé", async () => {
    const install = vi.fn(() => Promise.resolve());
    fakeSource({ check: vi.fn(() => Promise.resolve(update(install))) });
    const done = checkForUpdatesNow();
    expect((await answer(false)).message).toMatch(/9\.9\.9/);
    await done;
    expect(install).not.toHaveBeenCalled();
  });

  it("acceptée, aucun document modifié : installée, avancement annoncé", async () => {
    const install = vi.fn((progress: (ratio: number | null) => void) => {
      progress(0.5);
      return Promise.resolve();
    });
    fakeSource({ check: vi.fn(() => Promise.resolve(update(install))) });
    const done = checkForUpdatesNow();
    await answer(true);
    await done;
    expect(install).toHaveBeenCalledOnce();
    expect(useUiStore.getState().status?.text).toBe(t("update.downloadingPercent", { percent: 50 }));
  });
});

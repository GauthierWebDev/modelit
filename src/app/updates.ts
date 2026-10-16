import { t } from "@/i18n";
import { APP_INFO, CHANGELOG } from "./appInfo";
import { checkForUpdate, updatesConfigured, updatesSupported, type AvailableUpdate } from "@/platform/updater";
import { alertDialog, confirmDialog, showError } from "./dialogStore";
import { confirmLoseAllChanges } from "./fileCommands";
import { usePreferencesStore } from "./preferencesStore";
import { useUiStore } from "./uiStore";

/**
 * Proposition de mise à jour : vérification automatique au lancement (au plus une fois par jour,
 * désactivable dans les options), ou à la demande depuis les options. Après une mise à jour, les
 * nouveautés de la version sont montrées une fois (À propos → Nouveautés).
 */

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
/** Laisse l'application (et une éventuelle récupération de sauvegarde) s'afficher d'abord. */
const STARTUP_DELAY = 5000;
/** Notes de version affichées dans la boîte ; la suite reste sur la page de la release. */
const MAX_NOTES = 800;

let busy = false;

/** Vérification automatique, à appeler au lancement ; silencieuse si rien n'est disponible ou en cas d'erreur. */
export function scheduleUpdateCheck(): () => void {
  if (!updatesSupported()) return () => {};
  const timer = window.setTimeout(() => {
    const prefs = usePreferencesStore.getState();
    if (!prefs.updateCheck || Date.now() - prefs.lastUpdateCheck < CHECK_INTERVAL) return;
    void run(false);
  }, STARTUP_DELAY);
  return () => window.clearTimeout(timer);
}

/** Vérification demandée par l'utilisateur : le résultat est toujours signalé. */
export const checkForUpdatesNow = () => run(true);

async function run(manual: boolean) {
  if (busy) return;
  busy = true;
  try {
    if (!(await updatesConfigured())) {
      if (manual) await alertDialog({ title: t("update.title"), message: t("update.notConfigured"), okLabel: t("common.ok"), tone: "info" });
      return;
    }
    let update: AvailableUpdate | null;
    try {
      update = await checkForUpdate();
      usePreferencesStore.getState().setLastUpdateCheck(Date.now());
    } catch (e) {
      // Hors ligne, GitHub indisponible… : sans conséquence pour une vérification automatique.
      if (manual) await showError(t("update.checkFailed", { error: String(e) }));
      return;
    }
    if (!update) {
      if (manual) await alertDialog({ title: t("update.title"), message: t("update.upToDate"), okLabel: t("common.ok"), tone: "info" });
      return;
    }
    await offer(update);
  } finally {
    busy = false;
  }
}

async function offer(update: AvailableUpdate) {
  const notes = update.notes.trim();
  const accepted = await confirmDialog({
    title: t("update.title"),
    message: t("update.available", { version: update.version, current: update.currentVersion }),
    ...(notes ? { detail: notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}…` : notes } : {}),
    okLabel: t("update.install"),
    cancelLabel: t("update.later"),
    tone: "info",
  });
  // L'application redémarre : le modèle non enregistré serait perdu.
  if (!accepted || !(await confirmLoseAllChanges())) return;

  const ui = useUiStore.getState();
  let shown = -1;
  try {
    await update.install((ratio) => {
      const percent = ratio === null ? null : Math.floor(ratio * 100);
      if (percent === shown) return;
      shown = percent ?? -1;
      ui.notify({ kind: "info", text: percent === null ? t("update.downloading") : t("update.downloadingPercent", { percent }) });
    });
  } catch (e) {
    ui.notify(null);
    await showError(t("update.installFailed", { error: String(e) }));
  }
}

/** Au premier lancement d'une nouvelle version, ouvre ses notes ; rien à la première installation. */
export function showWhatsNew() {
  const prefs = usePreferencesStore.getState();
  const previous = prefs.lastSeenVersion;
  if (previous === APP_INFO.version) return;
  prefs.setLastSeenVersion(APP_INFO.version);
  if (previous && CHANGELOG.some((e) => e.version === APP_INFO.version)) useUiStore.getState().setAbout("changes");
}

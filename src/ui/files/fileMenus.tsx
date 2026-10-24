import { useDocument } from "@/app/document/DocumentContext";
import type { DocumentHandle } from "@/app/document/handle";
import { fileName } from "@/app/documentNames";
import { usePreferencesStore } from "@/app/preferencesStore";
import { clearRecent } from "@/app/recentFiles";
import { t } from "@/i18n";
import { nativeFiles } from "@/platform/window";
import { useIsSessionTab } from "@/ui/collab/RemoteCursors";
import { MenuItem, MenuLabel, MenuSeparator } from "@/ui/common/Menu";
import { mainCommand } from "@/ui/windows/mainCommands";

/**
 * « Rouvrir sans sauvegarder » proposé (O-67) : application native, document enregistré, hors onglet de session.
 * Même règle que `canReload` (app/fileCommands.ts), lisible aussi depuis une fenêtre flottante.
 */
export function useCanReload(doc: DocumentHandle): boolean {
  const filePath = useDocument((s) => s.filePath);
  const shared = useIsSessionTab(doc);
  return nativeFiles() && filePath !== null && !shared;
}

/** Entrée « Rouvrir sans sauvegarder » d'un menu (≡, clic droit sur un onglet). */
export function ReloadItem({ enabled, run }: { enabled: boolean; run: (action: () => void) => () => void }) {
  return (
    <MenuItem disabled={!enabled} onSelect={run(() => mainCommand({ name: "reload" }))}>
      {t("menu.reload")}
    </MenuItem>
  );
}

/** Fichiers récents du menu ≡ (O-65) : nom affiché, chemin en infobulle ; rien hors application native. */
export function RecentFiles({ run }: { run: (action: () => void) => () => void }) {
  const recent = usePreferencesStore((s) => s.recentFiles);
  if (!nativeFiles() || recent.length === 0) {
    return null;
  }
  return (
    <>
      <MenuSeparator />
      <MenuLabel>{t("menu.recent")}</MenuLabel>
      {recent.map((path) => (
        <MenuItem key={path} tooltip={path} onSelect={run(() => mainCommand({ name: "openPath", path }))}>
          {fileName(path)}
        </MenuItem>
      ))}
      <MenuItem onSelect={run(clearRecent)}>{t("menu.recentClear")}</MenuItem>
    </>
  );
}

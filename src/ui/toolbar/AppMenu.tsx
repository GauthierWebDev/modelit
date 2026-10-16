import { Menu as MenuIcon } from "lucide-react";
import { type ThemePreference, usePreferencesStore } from "@/app/preferencesStore";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { IconButton } from "@/ui/common/controls";
import { Menu, MenuCheck, MenuItem, MenuLabel, MenuSeparator } from "@/ui/common/Menu";
import { SectionChecks } from "@/ui/dock/Dock";
import { MOD, MODEL_SETTINGS_SHORTCUT } from "@/ui/shortcuts";
import { mainCommand } from "@/ui/windows/mainCommands";

const THEMES: ThemePreference[] = ["system", "light", "dark"];

/**
 * Menu ≡ de la barre d'outils (override O-51) : fichier, échanges, modèle (O-55), affichage, application.
 * Ses commandes visent la fenêtre principale, y compris depuis la barre flottante.
 */
export function AppMenu() {
  const { setOptionsOpen, setModelSettingsOpen, setExportOpen, setReverseOpen, setAbout } = useUiStore();
  const { theme, setTheme } = usePreferencesStore();
  return (
    <Menu
      align="left"
      trigger={({ open, toggle }) => (
        <IconButton tooltip={t("menu.app")} active={open} onClick={toggle}>
          <MenuIcon size={16} />
        </IconButton>
      )}
    >
      {(close) => {
        const run = (action: () => void) => () => {
          close();
          action();
        };
        return (
          <>
            <MenuItem shortcut={`${MOD}N`} onSelect={run(() => mainCommand({ name: "new" }))}>
              {t("menu.new")}
            </MenuItem>
            <MenuItem shortcut={`${MOD}O`} onSelect={run(() => mainCommand({ name: "open" }))}>
              {t("menu.open")}
            </MenuItem>
            <MenuItem shortcut={`${MOD}S`} onSelect={run(() => mainCommand({ name: "save" }))}>
              {t("menu.save")}
            </MenuItem>
            <MenuItem shortcut={`⇧${MOD}S`} onSelect={run(() => mainCommand({ name: "save", saveAs: true }))}>
              {t("menu.saveAs")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem shortcut={`${MOD}E`} onSelect={run(() => setExportOpen(true))}>
              {t("menu.exportImage")}
            </MenuItem>
            <MenuItem onSelect={run(() => setReverseOpen(true))}>{t("menu.reverse")}</MenuItem>
            <MenuSeparator />
            <MenuItem shortcut={MODEL_SETTINGS_SHORTCUT} onSelect={run(() => setModelSettingsOpen(true))}>
              {t("menu.modelSettings")}
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>{t("toolbar.sections")}</MenuLabel>
            <SectionChecks close={close} withReset />
            <MenuSeparator />
            <MenuLabel>{t("menu.theme")}</MenuLabel>
            {THEMES.map((id) => (
              <MenuCheck key={id} checked={theme === id} onSelect={run(() => setTheme(id))}>
                {t(`menu.theme.${id}`)}
              </MenuCheck>
            ))}
            <MenuSeparator />
            <MenuItem shortcut={`${MOD},`} onSelect={run(() => setOptionsOpen(true))}>
              {t("menu.options")}
            </MenuItem>
            <MenuItem onSelect={run(() => setAbout("about"))}>{t("menu.about")}</MenuItem>
          </>
        );
      }}
    </Menu>
  );
}

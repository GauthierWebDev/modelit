import type { DocumentSettings, RelationLabelMode } from "@core/index";
import { Eye } from "lucide-react";
import * as cmd from "@/app/commands";
import { useDocument, useDocumentHandle } from "@/app/document/DocumentContext";
import type { DocumentHandle } from "@/app/document/handle";
import { t } from "@/i18n";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { IconButton } from "@/ui/common/controls";
import { Menu, MenuCheck, MenuLabel, MenuSeparator } from "@/ui/common/Menu";

const GRID_SIZES = [5, 10, 20, 40];
const RELATION_LABELS: RelationLabelMode[] = ["none", "foreignKey", "text"];

/**
 * Menu « Affichage » de la barre d'outils (override O-55) : réglages de vue du modèle actif,
 * enregistrés dans le fichier et annulables. Il reste ouvert après un choix, pour en enchaîner
 * plusieurs.
 */
export function DisplayMenu() {
  const handle = useDocumentHandle();
  const s = useDocument((d) => d.doc.settings);
  const readOnly = useSessionReadOnly(handle);
  // Un pas venu d'un fichier, hors des valeurs proposées, reste visible et coché.
  const sizes = GRID_SIZES.includes(s.grid.size) ? GRID_SIZES : [...GRID_SIZES, s.grid.size].sort((a, b) => a - b);
  return (
    <Menu
      align="left"
      trigger={({ open, toggle }) => (
        <IconButton tooltip={t("display.menu")} active={open} onClick={toggle}>
          <Eye size={16} />
        </IconButton>
      )}
    >
      {() => displayItems(handle, s, readOnly, sizes)}
    </Menu>
  );
}

/** Attributs, grille et son pas, flèches et étiquettes des relations (MLD / MPD). */
function displayItems(handle: DocumentHandle, s: DocumentSettings, readOnly: boolean, sizes: number[]) {
  return (
    <>
      <MenuCheck
        disabled={readOnly}
        checked={s.display.showAttributes}
        onSelect={() =>
          cmd.updateSettings(handle, "history.showAttributes", (d) => {
            d.display.showAttributes = !s.display.showAttributes;
          })
        }
      >
        {t("display.attributes")}
      </MenuCheck>
      <MenuCheck
        disabled={readOnly}
        checked={s.grid.enabled}
        onSelect={() =>
          cmd.updateSettings(handle, "history.grid", (d) => {
            d.grid.enabled = !s.grid.enabled;
          })
        }
      >
        {t("inspector.grid")}
      </MenuCheck>
      <MenuSeparator />
      <MenuLabel>{t("inspector.gridSize")}</MenuLabel>
      {sizes.map((size) => (
        <MenuCheck
          key={size}
          disabled={readOnly}
          checked={s.grid.size === size}
          onSelect={() =>
            cmd.updateSettings(handle, "history.gridSize", (d) => {
              d.grid.size = size;
            })
          }
        >
          {size} px
        </MenuCheck>
      ))}
      <MenuSeparator />
      <MenuLabel>{t("inspector.relations")}</MenuLabel>
      <MenuCheck
        disabled={readOnly}
        checked={s.display.relationArrows}
        onSelect={() =>
          cmd.updateSettings(handle, "history.relationArrows", (d) => {
            d.display.relationArrows = !s.display.relationArrows;
          })
        }
      >
        {t("inspector.relationArrows")}
      </MenuCheck>
      <MenuSeparator />
      <MenuLabel>{t("inspector.relationLabels")}</MenuLabel>
      {RELATION_LABELS.map((mode) => (
        <MenuCheck
          key={mode}
          disabled={readOnly}
          checked={s.display.relationLabels === mode}
          onSelect={() =>
            cmd.updateSettings(handle, "history.relationLabels", (d) => {
              d.display.relationLabels = mode;
            })
          }
        >
          {t(`inspector.relationLabels.${mode}`)}
        </MenuCheck>
      ))}
    </>
  );
}

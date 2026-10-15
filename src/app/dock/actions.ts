import { usePreferencesStore } from "../preferencesStore";
import { groupOf, setActive, showSection, type DockLayout, type SectionId } from "./layout";

/** Opérations de disposition appliquées aux options du poste (overrides O-45, O-46). */

export const updateDock = (change: (layout: DockLayout) => DockLayout) => usePreferencesStore.getState().updateDock(change);

/** Affiche une section : réaffichée si elle était masquée, puis onglet actif de son groupe. */
export function revealSection(section: SectionId) {
  updateDock((layout) => {
    const shown = showSection(layout, section);
    const found = groupOf(shown, section);
    return found ? setActive(shown, found.group.id, section) : shown;
  });
}

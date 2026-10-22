import { setFileAccess } from "./app/fileAccess";
import { platformFiles } from "./platform/files";

/**
 * Point d'assemblage de la fenêtre principale (esprit hexagonal, audit A-01 / M-00 L3) : seul endroit qui
 * branche les adaptateurs de la plateforme sur les ports de l'application. Appelé une fois, avant le
 * premier rendu. Les fenêtres flottantes n'en ont pas besoin : elles relaient leurs commandes à la principale.
 */
export function bootstrapMain() {
  setFileAccess(platformFiles);
}

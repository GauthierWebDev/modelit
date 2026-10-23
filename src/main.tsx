import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startPreferencesSync, usePreferencesStore } from "./app/preferencesStore";
import { bootstrapMain } from "./bootstrap";
import { setLocale } from "./i18n";
import { floatKind } from "./platform/floatWindows";
import { App } from "./ui/App";
import { loadFonts } from "./ui/fonts";
import { FloatRoot } from "./ui/windows/FloatRoot";
import "./index.css";

/**
 * Racine : changer de langue remonte l'application (clé = langue), ce qui retraduit
 * toute l'interface sans que chaque composant ait à s'abonner à la langue (override O-23).
 * Le modèle et l'historique, conservés dans les stores, ne sont pas affectés.
 */
function Root() {
  const locale = usePreferencesStore((s) => s.locale);
  setLocale(locale);
  // Fenêtre flottante native (barre d'outils, groupe de sections ; O-45, O-46).
  const float = floatKind();
  return float ? <FloatRoot key={locale} kind={float} /> : <App key={locale} />;
}

// Toutes les fenêtres : options relues quand une autre fenêtre les écrit ; la principale assemble le reste.
startPreferencesSync();
if (!floatKind()) {
  bootstrapMain();
}

// Les largeurs de texte du schéma sont mesurées (et mises en cache) avec la police embarquée :
// elle doit être chargée avant le premier rendu. En cas d'échec, police de repli.
void loadFonts()
  .catch(() => undefined)
  .then(() =>
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <Root />
      </StrictMode>,
    ),
  );

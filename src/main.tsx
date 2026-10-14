import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { usePreferencesStore } from "./app/preferencesStore";
import { setLocale } from "./i18n";
import { App } from "./ui/App";
import { loadFonts } from "./ui/fonts";
import "./index.css";

/**
 * Racine : changer de langue remonte l'application (clé = langue), ce qui retraduit
 * toute l'interface sans que chaque composant ait à s'abonner à la langue (override O-23).
 * Le modèle et l'historique, conservés dans les stores, ne sont pas affectés.
 */
function Root() {
  const locale = usePreferencesStore((s) => s.locale);
  setLocale(locale);
  return <App key={locale} />;
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

import { useEffect } from "react";
import { usePreferencesStore } from "@/app/preferencesStore";
import { setNativeTheme } from "@/platform/window";

/**
 * Applique le thème choisi (override O-03) : classe `.dark` sur <html> et
 * barre de titre native. En mode « système », suit la préférence de l'OS en direct.
 */
export function useApplyTheme() {
  const theme = usePreferencesStore((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    void setNativeTheme(theme === "system" ? null : theme);
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

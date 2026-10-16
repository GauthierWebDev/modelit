import { setMessagesLocale } from "@core/index";
import { en } from "./en";
import { fr, type MessageKey } from "./fr";

/**
 * Traduction de l'interface, français et anglais (override O-23).
 *
 * `t()` lit la langue courante ; changer de langue (`setLocale`) remonte l'application
 * (cf. `main.tsx`) : les composants n'ont pas besoin de s'abonner.
 */
export type Locale = "fr" | "en";
export type { MessageKey };

export const LOCALES: Locale[] = ["fr", "en"];

const catalogs: Record<Locale, Record<MessageKey, string>> = { fr, en };
let current: Locale = "fr";

export function setLocale(locale: Locale) {
  current = locale;
  setMessagesLocale(locale);
  document.documentElement.lang = locale;
}

export const getLocale = () => current;

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = catalogs[current][key] ?? fr[key] ?? key;
  return params
    ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
    : text;
}

/** Langue par défaut : celle du système si elle est prise en charge, sinon l'anglais. */
export function systemLocale(): Locale {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

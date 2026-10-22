import { EN } from "./messagesEn";
import { FR } from "./messagesFr";

/**
 * Messages du cœur métier, en français et en anglais (override O-23).
 *
 * Fautes d'accord corrigées (« Le cardinalité » → « La cardinalité »).
 *
 * Vocabulaire par couche (override O-24) : le MCD parle d'entités, de rubriques et de
 * discriminants ; le MLD et le MPD de tables, de colonnes et de clés primaires. Un problème
 * qui concerne les deux couches a deux formulations (`…Conceptual` / `…Logical`) ; le terme
 * « identifiant » est réservé à la case à cocher des rubriques.
 *
 * `MSG` désigne le catalogue de la langue courante (liaison ES « vivante ») ; l'interface
 * change de langue avec `setMessagesLocale`.
 */

export type Messages = typeof FR;

export type MessagesLocale = "fr" | "en";

export let MSG: Messages = FR;

export function setMessagesLocale(locale: MessagesLocale) {
  MSG = locale === "en" ? EN : FR;
}

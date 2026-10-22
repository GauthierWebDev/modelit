/**
 * Commandes métier : seul point d'entrée de l'interface pour modifier le modèle.
 * Chaque commande valide la modification avec les règles de `core/validation`
 * et renvoie le message d'erreur à afficher, ou `null` si elle a été appliquée.
 * Chaque commande reçoit le document sur lequel elle agit (docs/jalons/J-01, phase 1).
 */

export * from "./attributeCommands";
export * from "./dbmsCommands";
export * from "./linkCommands";
export * from "./nodeCommands";

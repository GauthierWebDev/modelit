/**
 * Cœur métier : modèle, validations, MCD → MLD, génération SQL, format de fichier.
 *
 * Règle d'architecture : ce dossier ne dépend ni de React, ni de Tauri, ni du
 * reste de `src/` (vérifié par `architecture.test.ts`). Il doit rester utilisable
 * tel quel par un outil en ligne de commande ou un autre front-end.
 */

export * from "./dbms/dbms";
export * from "./dbms/typeMapping";
export * from "./dbms/versions";
export { type Target, targetOf } from "./ddl/dialects";
export * from "./ddl/generate";
export * from "./io/modelFile";
export * from "./layout/arrange";
export * from "./layout/grid";
export * from "./mld/logical";
export * from "./mld/rename";
export * from "./mld/text";
export * from "./mld/transform";
export * from "./model/clipboard";
export * from "./model/datatype";
export * from "./model/document";
export * from "./model/factory";
export * from "./model/physical";
export * from "./model/settings";
export * from "./naming/keys";
export * from "./naming/patterns";
export * from "./naming/typology";
export * from "./reverse/build";
export { detectDialect } from "./reverse/dialect";
export { parseSql } from "./reverse/parse";
export * from "./reverse/types";
export * from "./validation/messages";
export * from "./validation/rules";

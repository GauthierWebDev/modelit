/**
 * Cœur métier : modèle, validations, MCD → MLD, génération SQL, format de fichier.
 *
 * Règle d'architecture : ce dossier ne dépend ni de React, ni de Tauri, ni du
 * reste de `src/` (vérifié par `architecture.test.ts`). Il doit rester utilisable
 * tel quel par un outil en ligne de commande ou un autre front-end.
 */
export * from "./model/datatype";
export * from "./model/document";
export * from "./model/settings";
export * from "./model/physical";
export * from "./model/factory";
export * from "./model/clipboard";
export * from "./dbms/dbms";
export * from "./dbms/typeMapping";
export * from "./dbms/versions";
export * from "./naming/typology";
export * from "./naming/keys";
export * from "./naming/patterns";
export * from "./validation/messages";
export * from "./validation/rules";
export * from "./mld/logical";
export * from "./mld/transform";
export * from "./mld/text";
export * from "./mld/rename";
export * from "./ddl/generate";
export { detectDialect } from "./reverse/dialect";
export * from "./io/modelFile";
export * from "./reverse/build";
export * from "./reverse/types";
export { parseSql } from "./reverse/parse";
export * from "./layout/grid";
export * from "./layout/arrange";

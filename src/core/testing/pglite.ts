import { PGlite } from "@electric-sql/pglite";
import { afterAll } from "vitest";

/**
 * Exécution sur PostgreSQL embarqué (PGlite), à appeler en tête d'un fichier de test : une seule
 * instance pour le fichier (démarrage coûteux), schéma remis à zéro à chaque essai, fermée après
 * les tests du fichier.
 */
export function sharedPg() {
  let shared: PGlite | undefined;
  afterAll(async () => shared?.close());
  return async function withPg<T>(sql: string, run: (pg: PGlite) => Promise<T>): Promise<T> {
    shared ??= new PGlite();
    await shared.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await shared.exec(sql);
    return run(shared);
  };
}

/**
 * Adaptateur par défaut d'un port tant que l'assemblage (`src/bootstrap.ts`) ne l'a pas branché : chaque
 * appel lève une erreur qui nomme le port, pour qu'un oubli de branchement échoue bruyamment plutôt que
 * de ne rien faire.
 */
export function unplugged<Port extends object>(name: string): Port {
  return new Proxy({} as Port, {
    get: (_, member) => () => {
      throw new Error(`${name}.${String(member)} : adaptateur non branché (src/bootstrap.ts)`);
    },
  });
}

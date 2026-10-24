import { unplugged } from "./unplugged";

/**
 * Port de l'intégration au système (override O-68) : commande `modelit` dans le PATH, installée depuis les
 * options générales. Implémenté par `platform/shell.ts` (coquille native, `src-tauri/src/cli.rs`), branché au
 * démarrage (`src/bootstrap.ts`) ; indisponible dans le navigateur.
 */

export interface CliStatus {
  /** Système pris en charge, application installée (pas un build de développement). */
  supported: boolean;
  installed: boolean;
  /** Emplacement de la commande (Windows : dossier ajouté au PATH). */
  location: string | null;
  /** Le dossier de la commande est dans le PATH (Linux : `~/.local/bin` ne l'est pas toujours). */
  inPath: boolean;
}

export interface ShellIntegration {
  /** Application native : la section « Ligne de commande » est proposée. */
  available: boolean;
  status: () => Promise<CliStatus>;
  /** Installe la commande ; nouvel état. Rejeté si refusé (mot de passe administrateur annulé) ou impossible. */
  install: () => Promise<CliStatus>;
  uninstall: () => Promise<CliStatus>;
}

let current: ShellIntegration = unplugged<ShellIntegration>("ShellIntegration");

export function setShellIntegration(adapter: ShellIntegration) {
  current = adapter;
}

export const shellIntegration = (): ShellIntegration => current;

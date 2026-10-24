import { isTauri } from "@tauri-apps/api/core";
import type { CliStatus, ShellIntegration } from "@/app/shellIntegration";

/** Adaptateur du port `ShellIntegration` (`app/shellIntegration.ts`) : commandes `cli_*` de la coquille. */
async function call(command: "cli_status" | "cli_install" | "cli_uninstall"): Promise<CliStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CliStatus>(command);
}

export const platformShell: ShellIntegration = {
  available: isTauri(),
  status: () => call("cli_status"),
  install: () => call("cli_install"),
  uninstall: () => call("cli_uninstall"),
};

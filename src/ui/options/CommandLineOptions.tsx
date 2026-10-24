import { useEffect, useState } from "react";
import { type CliStatus, shellIntegration } from "@/app/shellIntegration";
import { t } from "@/i18n";

/**
 * Section « Ligne de commande » des options générales (override O-68) : commande `modelit` dans le PATH, état,
 * installation et retrait (macOS : mot de passe administrateur demandé par le système).
 */
export function CommandLineOptions() {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    shellIntegration()
      .status()
      .then(setStatus, (e: unknown) => setError(String(e)));
  }, []);

  const run = (action: () => Promise<CliStatus>) => {
    setBusy(true);
    setError(null);
    action()
      .then(setStatus, (e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const button =
    "rounded border border-neutral-300 px-2 py-0.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:hover:bg-neutral-800";
  return (
    <>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("cli.help")}</p>
      {status && !status.supported ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("cli.unsupported")}</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={button}
            disabled={busy || !status}
            onClick={() => run(shellIntegration().install)}
          >
            {t(status?.installed ? "cli.reinstall" : "cli.install")}
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !status?.installed}
            onClick={() => run(shellIntegration().uninstall)}
          >
            {t("cli.uninstall")}
          </button>
        </div>
      )}
      {statusLine(status)}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{t("cli.failed", { error })}</p> : null}
    </>
  );
}

function statusLine(status: CliStatus | null) {
  if (!status?.supported) {
    return null;
  }
  const where = status.location ?? "";
  return (
    <p className="text-xs text-neutral-500 dark:text-neutral-400">
      {status.installed ? t("cli.installed", { where }) : t("cli.notInstalled")}
      {status.installed && !status.inPath ? ` ${t("cli.notInPath")}` : ""}
    </p>
  );
}

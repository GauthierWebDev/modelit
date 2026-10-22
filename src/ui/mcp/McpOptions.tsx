import { useState } from "react";
import { claudeCodeCommand, newToken, useMcpStore } from "@/app/mcp/activity";
import { usePreferencesStore } from "@/app/preferencesStore";
import { t } from "@/i18n";
import { Checkbox, Field, NumberInput } from "@/ui/common/controls";
import { takeOverMcp } from "./McpBridge";

/** Options « Assistants IA (MCP) » (override O-47) : activation, port, jeton, configuration à copier. */
export function McpOptions() {
  const { enabled, port, token } = usePreferencesStore((s) => s.mcp);
  const setMcp = usePreferencesStore((s) => s.setMcp);
  const { status, error } = useMcpStore();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (what: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <>
      <Checkbox
        label={t("mcp.enable")}
        checked={enabled}
        onChange={(on) => setMcp(on && !token ? { enabled: on, token: newToken() } : { enabled: on })}
      />
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("mcp.help")}</p>
      {enabled ? enabledOptions({ port, token, setMcp, status, error, copied, copy }) : null}
    </>
  );
}

const link = "text-sm text-blue-600 hover:underline dark:text-blue-400";

type Mcp = ReturnType<typeof usePreferencesStore.getState>["mcp"];
type Activity = ReturnType<typeof useMcpStore.getState>;

interface EnabledScope {
  port: number;
  token: string;
  setMcp: (patch: Partial<Mcp>) => void;
  status: Activity["status"];
  error: Activity["error"];
  copied: string | null;
  copy: (what: string, value: string) => void;
}

/** Point d'écoute activé : port, état, reprise du port, configuration et jeton à copier. */
function enabledOptions({ port, token, setMcp, status, error, copied, copy }: EnabledScope) {
  return (
    <>
      <Field label={t("mcp.port")}>
        <NumberInput min={1024} value={port} onCommit={(v) => v && v <= 65_535 && setMcp({ port: Math.round(v) })} />
      </Field>
      <p
        className={`text-xs ${status === "error" ? "text-red-600 dark:text-red-400" : "text-neutral-500 dark:text-neutral-400"}`}
      >
        {statusText(status, port, error)}
      </p>
      {(status === "error" || status === "released") && (
        <button type="button" className={`self-start ${link}`} onClick={() => void takeOverMcp()}>
          {t("mcp.closeOthers")}
        </button>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" className={link} onClick={() => copy("command", claudeCodeCommand(port, token))}>
          {copied === "command" ? t("mcp.copied") : t("mcp.copyCommand")}
        </button>
        <button type="button" className={link} onClick={() => copy("token", token)}>
          {copied === "token" ? t("mcp.copied") : t("mcp.copyToken")}
        </button>
        <button type="button" className={link} onClick={() => setMcp({ token: newToken() })}>
          {t("mcp.newToken")}
        </button>
      </div>
    </>
  );
}

/** État du point d'écoute en clair. */
function statusText(status: Activity["status"], port: number, error: Activity["error"]): string {
  return status === "on"
    ? t("mcp.listening", { url: `http://127.0.0.1:${port}/mcp` })
    : status === "error"
      ? t("mcp.failed", { error: error ?? "" })
      : status === "released"
        ? t("mcp.released")
        : t("mcp.starting");
}

import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { ACTIVE_FOR, useMcpStore } from "@/app/mcp/activity";
import { t } from "@/i18n";

/** « IA connectée » dans la barre d'état : échange avec un client depuis moins de 5 minutes (O-47). */
export function McpIndicator() {
  const last = useMcpStore((s) => s.lastActivity);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!last || Date.now() - last > ACTIVE_FOR || now - last > ACTIVE_FOR) {
    return null;
  }
  return (
    <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
      <Bot size={12} />
      {t("mcp.connected")}
    </span>
  );
}

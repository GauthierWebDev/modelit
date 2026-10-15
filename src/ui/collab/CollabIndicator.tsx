import { Users } from "lucide-react";
import { useCollabStore } from "@/app/collab/session";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";

/** Session en cours dans la barre d'état (O-05) : rôle, état de la connexion, participants. */
export function CollabIndicator() {
  const { mode, participants, guest } = useCollabStore();
  if (mode !== "host" && mode !== "guest") return null;
  const label =
    mode === "host"
      ? t("collab.sharing")
      : guest?.status === "disconnected" || guest?.status === "connecting"
        ? t("collab.reconnecting")
        : guest?.role === "reader"
          ? t("collab.readOnly")
          : t("collab.sessionOf", { host: participants.find((p) => p.role === "host")?.name ?? "?" });
  return (
    <button
      type="button"
      onClick={() => useUiStore.getState().setShareOpen(true)}
      className="ml-auto flex items-center gap-1 text-emerald-600 hover:underline dark:text-emerald-400"
    >
      <Users size={12} />
      {label} · {t("collab.participants", { n: participants.length })}
    </button>
  );
}

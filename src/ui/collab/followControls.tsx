import { Eye, EyeOff } from "lucide-react";
import type { CollabState } from "@/app/collab/sessionState";
import { t } from "@/i18n";
import { tip } from "@/ui/common/Tooltip";
import { mainCommand } from "@/ui/windows/mainCommands";

/** Suivi dans la liste des participants (O-05 §5, précisé le 2026-10-23). */

type Participant = CollabState["participants"][number];

interface FollowScope {
  presence: CollabState["presence"];
  following: CollabState["following"];
  you: CollabState["you"];
}

/** « vous suit » : ce participant suit ma vue et mon cadrage. */
export function followsYouMark(p: Participant, { presence, you }: FollowScope) {
  return p.id !== you && you && presence[p.id]?.following === you ? (
    <span className="text-[10px] text-neutral-400" data-follows-you="">
      {t("collab.followsYou")}
    </span>
  ) : null;
}

/** Suivre ce participant, ou arrêter (relayé à la fenêtre principale depuis une fenêtre flottante). */
export function followButton(p: Participant, { following, you }: FollowScope) {
  if (p.id === you) {
    return null;
  }
  const active = following === p.id;
  const label = t(active ? "collab.unfollow" : "collab.follow", { name: p.name });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      {...tip(label)}
      className={`rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 ${active ? "visible text-blue-600" : "invisible text-neutral-500 group-hover:visible focus:visible"}`}
      onClick={() => mainCommand({ name: "collab", action: { kind: "follow", peer: active ? null : p.id } })}
    >
      {active ? <EyeOff size={13} /> : <Eye size={13} />}
    </button>
  );
}

import { useCollabStore } from "@/app/collab/session";
import { t } from "@/i18n";

/** Pendant le suivi (O-05 §5) : canevas bordé de la couleur du participant suivi, et mention. */
export function FollowFrame() {
  const following = useCollabStore((s) => s.following);
  const leader = useCollabStore((s) => s.participants.find((p) => p.id === following));
  if (!leader) {
    return null;
  }
  const label = t("collab.followingBanner", { name: leader.name });
  return (
    <g pointerEvents="none" data-follow-frame="">
      <rect width="100%" height="100%" fill="none" stroke={leader.color} strokeWidth={6} />
      <rect x={8} y={8} rx={4} height={20} width={label.length * 6.4 + 14} fill={leader.color} />
      <text x={15} y={22} fontSize={11.5} fontWeight={600} fill="white" style={{ fontFamily: "system-ui, sans-serif" }}>
        {label}
      </text>
    </g>
  );
}

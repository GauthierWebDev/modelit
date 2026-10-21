import { CircleAlert, CircleCheck, Maximize, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import type { ReactNode } from "react";
import { useLogicalModel } from "@/app/derived";
import { revealSection } from "@/app/dock/actions";
import { useDocumentView } from "@/app/document/DocumentContext";
import { t } from "@/i18n";
import { tip } from "@/ui/common/Tooltip";
import { mainCommand } from "@/ui/windows/mainCommands";

/** Éléments de la barre d'état (override O-51) : sélection, problèmes, zoom. */

const item = "flex items-center gap-1 rounded px-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700";

/** Nombre d'objets sélectionnés ; rien sans sélection. */
export function SelectionStatus() {
  const count = useDocumentView((s) => s.selection.length);
  if (!count) {
    return null;
  }
  return <span>{t("status.selected", { n: count })}</span>;
}

/** Erreurs et avertissements du modèle ; un clic affiche la section Problèmes. */
export function IssuesStatus() {
  const { issues } = useLogicalModel();
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return (
    <button type="button" className={item} {...tip(t("status.issuesTooltip"))} onClick={() => revealSection("issues")}>
      {issues.length === 0 ? (
        <>
          <CircleCheck size={12} className="text-emerald-600 dark:text-emerald-400" />
          {t("status.noIssues")}
        </>
      ) : (
        <>
          {errors > 0 && (
            <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
              <CircleAlert size={12} />
              {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
              <TriangleAlert size={12} />
              {warnings}
            </span>
          )}
        </>
      )}
    </button>
  );
}

/** Zoom : arrière, pourcentage (clic : 100 %), avant, ajuster à la fenêtre. */
export function ZoomStatus() {
  const zoom = useDocumentView((s) => s.viewport.zoom);
  const button = (label: string, onClick: () => void, icon: ReactNode) => (
    <button type="button" aria-label={label} {...tip(label)} className={`${item} h-5`} onClick={onClick}>
      {icon}
    </button>
  );
  return (
    <div className="flex items-center">
      {button(t("toolbar.zoomOut"), () => mainCommand({ name: "zoomBy", factor: 1 / 1.2 }), <ZoomOut size={12} />)}
      <button
        type="button"
        {...tip(t("toolbar.zoomReset"))}
        className={`${item} w-14 justify-center whitespace-nowrap tabular-nums`}
        onClick={() => mainCommand({ name: "zoomTo", zoom: 1 })}
      >
        {Math.round(zoom * 100)} %
      </button>
      {button(t("toolbar.zoomIn"), () => mainCommand({ name: "zoomBy", factor: 1.2 }), <ZoomIn size={12} />)}
      {button(t("toolbar.fit"), () => mainCommand({ name: "fit" }), <Maximize size={12} />)}
    </div>
  );
}

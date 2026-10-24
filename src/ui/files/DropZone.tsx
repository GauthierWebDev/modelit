import { FileDown } from "lucide-react";
import { useEffect, useState } from "react";
import { openFiles } from "@/app/fileCommands";
import { t } from "@/i18n";
import { onFileDrop } from "@/platform/window";

/** Glisser-déposer de modèles sur la fenêtre principale (override O-66) : voile au survol, ouverture au dépôt. */
export function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => onFileDrop(setOver, (paths) => void openFiles(paths)), []);
  if (!over) {
    return null;
  }
  return (
    <div
      data-ui-only=""
      className="pointer-events-none fixed inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-500/10"
    >
      <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow-lg dark:bg-neutral-900 dark:text-blue-300">
        <FileDown size={18} />
        {t("file.dropHint")}
      </div>
    </div>
  );
}

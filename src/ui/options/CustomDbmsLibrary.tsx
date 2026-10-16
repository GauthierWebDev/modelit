import { Copy, Trash2, Wrench } from "lucide-react";
import { dbmsLabel } from "@/app/commands";
import { confirmDialog } from "@/app/dialogStore";
import { usePreferencesStore } from "@/app/preferencesStore";
import { t } from "@/i18n";
import { CommitInput, IconButton } from "@/ui/common/controls";

/**
 * « Mes SGBD » (override O-59) : SGBD personnalisés du poste, avec leur base. On les renomme, les
 * duplique ou les supprime ici ; leurs types se modifient depuis un modèle (onglet Types SQL), puis
 * s'enregistrent dans la bibliothèque. Supprimer ne change aucun modèle : chacun garde sa copie.
 */
export function CustomDbmsLibrary() {
  const library = usePreferencesStore((s) => s.customDbms);
  const { renameCustomDbms, duplicateCustomDbms, deleteCustomDbms } = usePreferencesStore();
  if (!library.length)
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customDbms.libraryEmpty")}</p>;
  return (
    <>
      <ul className="flex flex-col gap-1">
        {library.map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-sm">
            <Wrench size={12} className="flex-none text-neutral-500" />
            <CommitInput
              className="flex-1"
              value={d.name}
              onCommit={(name) =>
                name.trim() ? void renameCustomDbms(d.id, name.trim()) : t("customDbms.nameRequired")
              }
            />
            <span className="w-40 flex-none truncate text-xs text-neutral-500 dark:text-neutral-400">
              {t("customDbms.basedOnLabel", { dbms: dbmsLabel(d.base, d.version) })} · {Object.keys(d.types).length}
            </span>
            <IconButton
              tooltip={t("customDbms.duplicate")}
              onClick={() => duplicateCustomDbms(d.id, t("customDbms.copyName", { name: d.name }))}
            >
              <Copy size={14} />
            </IconButton>
            <IconButton
              tooltip={t("customDbms.delete")}
              onClick={() =>
                void confirmDialog({
                  title: t("customDbms.delete"),
                  message: t("customDbms.deleteConfirm", { name: d.name }),
                  detail: t("customDbms.deleteNote"),
                  okLabel: t("customDbms.delete"),
                  cancelLabel: t("common.cancel"),
                  tone: "danger",
                }).then((ok) => ok && deleteCustomDbms(d.id))
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("customDbms.libraryHelp")}</p>
    </>
  );
}

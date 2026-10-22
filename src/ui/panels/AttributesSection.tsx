import { useEffect, useState } from "react";
import { useDocument, useDocumentView } from "@/app/document/DocumentContext";
import { t } from "@/i18n";
import { ErrorBanner } from "@/ui/common/controls";
import { AttributesPanel } from "./AttributesPanel";
import { ReadOnly } from "./Inspector";

/**
 * Section « Rubriques » (override O-50) : rubriques de l'entité ou de l'association sélectionnée,
 * en liste compacte (une ligne chacune), avec le détail de la rubrique choisie dessous.
 */
export function AttributesSection() {
  const doc = useDocument((s) => s.doc);
  const selection = useDocumentView((s) => s.selection);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: effacer l'erreur quand la sélection change
  useEffect(() => setError(null), [selection]);
  const report = (message: string | null) => {
    setError(message);
    return message;
  };

  const id = selection.length === 1 ? selection[0]! : null;
  const entity = doc.entities.find((e) => e.id === id);
  const owner = entity ?? doc.associations.find((a) => a.id === id);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: intercepte Suppr pour le canevas, la zone n'est pas interactive
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: intercepte Suppr pour le canevas, la zone n'est pas interactive
    <div
      className="flex h-full flex-col overflow-y-auto"
      // Suppr ne vise jamais le canevas tant que le focus est dans la section (O-50).
      onKeyDown={(e) => (e.key === "Delete" || e.key === "Backspace") && e.stopPropagation()}
    >
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {owner ? (
        <ReadOnly>
          <AttributesPanel key={owner.id} doc={doc} owner={owner} isEntity={Boolean(entity)} report={report} />
        </ReadOnly>
      ) : (
        <p className="p-3 text-sm text-neutral-500">{t("attributes.none")}</p>
      )}
    </div>
  );
}

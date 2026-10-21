import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { useSessionReadOnly } from "@/ui/collab/readOnly";
import { tip } from "@/ui/common/Tooltip";
import { quickActions } from "./objectActions";
import { objectRects } from "./viewport";

/**
 * Bouton « ⋯ » contre le coin supérieur droit de l'entité ou de l'association sélectionnée
 * (override O-53) ; déplié, une rangée d'icônes. Posé au-dessus du canevas (hors de l'image
 * exportée), il suit le zoom et le défilement.
 */
export function QuickActions() {
  const doc = useDocumentHandle();
  const model = useDocument((s) => s.doc);
  const moving = useDocument((s) => s.transactionStart !== null);
  const selection = useDocumentView((s) => s.selection);
  const viewport = useDocumentView((s) => s.viewport);
  useDocumentView((s) => s.view);
  const tool = useUiStore((s) => s.tool);
  const readOnly = useSessionReadOnly(doc);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const id = selection.length === 1 ? selection[0]! : null;
  const owner =
    id && (model.entities.some((e) => e.id === id) || model.associations.some((a) => a.id === id)) ? id : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refermer le menu quand l'objet visé change
  useEffect(() => setOpen(false), [owner]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      e.stopPropagation();
      setOpen(false);
    };
    globalThis.addEventListener("pointerdown", onPointer, true);
    globalThis.addEventListener("keydown", onKey, true);
    return () => {
      globalThis.removeEventListener("pointerdown", onPointer, true);
      globalThis.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!owner || moving || tool !== "select" || readOnly) {
    return null;
  }
  const [rect] = objectRects(doc, [owner]);
  if (!rect) {
    return null;
  }
  // Écarté du coin : la pastille d'erreur (O-15) y est posée.
  const left = (rect.x + rect.width) * viewport.zoom + viewport.x + 10;
  const top = rect.y * viewport.zoom + viewport.y - 8;
  const actions = quickActions(doc, owner);

  return (
    <div
      ref={ref}
      // Ancré par son coin inférieur gauche, juste au-dessus du coin supérieur droit de l'objet.
      style={{ left, top, transform: "translateY(-100%)" }}
      className="absolute z-10 flex items-center rounded-md border border-neutral-300 bg-white shadow-sm dark:border-neutral-600 dark:bg-neutral-800"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {open ? (
        actions.map((a) =>
          a.kind === "item" ? (
            <button
              key={a.id}
              type="button"
              aria-label={a.label}
              {...tip(a.shortcut ? `${a.label} (${a.shortcut})` : a.label)}
              onClick={() => {
                setOpen(false);
                a.run();
              }}
              className="flex size-6 items-center justify-center text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {a.icon}
            </button>
          ) : null,
        )
      ) : (
        <button
          type="button"
          aria-label={t("actions.more")}
          {...tip(t("actions.more"))}
          onClick={() => setOpen(true)}
          className="flex h-5 w-6 items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
        >
          <Ellipsis size={14} />
        </button>
      )}
    </div>
  );
}

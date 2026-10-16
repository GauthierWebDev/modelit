import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { tip } from "@/ui/common/Tooltip";
import type { Action } from "./objectActions";

/**
 * Menu contextuel du schéma (override O-53) : ouvert sous le pointeur, ramené dans la fenêtre
 * s'il déborde ; Échap, un clic ailleurs, la molette ou le choix d'un élément le ferment.
 */

interface ContextMenuState {
  menu: { x: number; y: number; actions: Action[] } | null;
  open: (x: number, y: number, actions: Action[]) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuState>()((set) => ({
  menu: null,
  open: (x, y, actions) => set({ menu: actions.length ? { x, y, actions } : null }),
  close: () => set({ menu: null }),
}));

/**
 * Bloque le menu contextuel natif (O-53), sauf dans un champ de saisie ou sur du texte sélectionné
 * (copier / coller du texte). À appeler une fois par fenêtre ; renvoie la fonction de retrait.
 */
export function blockNativeContextMenu(): () => void {
  const onContextMenu = (e: MouseEvent) => {
    const target = e.target;
    const editable =
      target instanceof HTMLElement &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (editable || window.getSelection()?.toString()) return;
    e.preventDefault();
  };
  window.addEventListener("contextmenu", onContextMenu);
  return () => window.removeEventListener("contextmenu", onContextMenu);
}

export function ContextMenuLayer() {
  const menu = useContextMenu((s) => s.menu);
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPosition(null);
    const { width, height } = ref.current.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - height - 4)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Échap ferme le menu sans désélectionner sur le canevas.
      e.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      role="menu"
      style={{
        left: position?.left ?? menu.x,
        top: position?.top ?? menu.y,
        visibility: position ? "visible" : "hidden",
      }}
      className="fixed z-50 min-w-52 rounded border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.actions.map((action, i) =>
        action.kind === "separator" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: séparateur sans identité propre
          <hr key={`sep-${i}`} className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
        ) : action.kind === "row" ? (
          // biome-ignore lint/a11y/useSemanticElements: groupe de boutons d'un menu (motif ARIA menu), pas un formulaire
          <div key={action.id} role="group" className="flex gap-0.5 px-2 py-0.5">
            {action.items.map((item) => (
              <span key={item.id} className="inline-flex" {...tip(item.label)}>
                <button
                  type="button"
                  role="menuitem"
                  aria-label={item.label}
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.run();
                  }}
                  className="flex size-7 items-center justify-center rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-35 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  {item.icon}
                </button>
              </span>
            ))}
          </div>
        ) : (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: rôle menuitemcheckbox quand l'action est cochable
          <button
            key={action.id}
            type="button"
            role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={action.checked}
            disabled={action.disabled}
            onClick={() => {
              close();
              action.run();
            }}
            className="flex w-full items-center gap-2 px-3 py-1 text-left whitespace-nowrap hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-700"
          >
            <span className="flex w-3.5 flex-none justify-center text-neutral-500 dark:text-neutral-400">
              {action.checked ? <Check size={14} /> : action.icon}
            </span>
            <span className="flex-1">{action.label}</span>
            {action.shortcut && (
              <span className="pl-6 text-xs text-neutral-400 dark:text-neutral-500">{action.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

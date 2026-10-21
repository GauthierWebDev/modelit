import { type ReactNode, useEffect, useId, useRef } from "react";

/** Modales ouvertes, de la plus ancienne à la plus récente : Échap ne ferme que celle du dessus. */
const stack: string[] = [];

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Boîte de dialogue modale : fermeture par Échap (modale du dessus seulement), par un clic sur le
 * fond ou par `onClose` ; le focus reste dans la boîte (Tab / Maj+Tab) et revient ensuite à
 * l'élément qui l'avait.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = "w-[34rem]",
  role = "dialog",
  icon,
  describedBy,
  layer = "z-50",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** `alertdialog` : message qui attend une réponse (confirmation, erreur). */
  role?: "dialog" | "alertdialog";
  icon?: ReactNode;
  describedBy?: string;
  /** Plan d'affichage (une alerte passe au-dessus d'une boîte déjà ouverte). */
  layer?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    stack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    // Focus initial : élément marqué `data-autofocus`, sinon premier élément focalisable.
    const target =
      box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? box.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack.at(-1) !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const first = items[0]!;
        const last = items.at(-1)!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(id), 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [id]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: fond de la boîte, un clic à l'extérieur la ferme (Échap au clavier)
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: fond de la boîte, un clic à l'extérieur la ferme (Échap au clavier)
    <div
      data-ui-only
      className={`fixed inset-0 ${layer} flex items-center justify-center bg-black/30`}
      onMouseDown={() => close.current()}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: rôle passé en prop (dialog ou alertdialog) */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: un clic dans la boîte ne doit pas atteindre le fond */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: rôle passé en prop (dialog ou alertdialog) */}
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`${width} flex max-h-[90vh] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-neutral-200 bg-white shadow-xl outline-none dark:border-neutral-700 dark:bg-neutral-900`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id={`${id}-title`}
          className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3 text-base font-semibold dark:border-neutral-700"
        >
          {icon}
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? (
          <div className="flex items-center gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { Check } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Menu déroulant : un bouton déclencheur, une liste d'éléments sous lui.
 * Se ferme au choix d'un élément, sur Échap ou sur un clic à l'extérieur.
 */
export function Menu({
  trigger,
  align = "right",
  children,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-50 mt-1 min-w-48 rounded border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-800 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  shortcut,
}: {
  onSelect: () => void;
  children: ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-1 text-left whitespace-nowrap hover:bg-neutral-100 dark:hover:bg-neutral-700"
    >
      <span className="w-3.5 flex-none" />
      <span className="flex-1">{children}</span>
      {shortcut && <span className="pl-6 text-xs text-neutral-400 dark:text-neutral-500">{shortcut}</span>}
    </button>
  );
}

/** Intitulé d'un groupe d'éléments. */
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <p className="px-3 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide whitespace-nowrap text-neutral-500 uppercase dark:text-neutral-400">
    {children}
  </p>
);

export function MenuCheck({
  checked,
  onSelect,
  children,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-1 text-left whitespace-nowrap hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-700"
    >
      <span className="flex w-3.5 flex-none justify-center">{checked && <Check size={14} />}</span>
      {children}
    </button>
  );
}

export const MenuSeparator = () => (
  <div role="separator" className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
);

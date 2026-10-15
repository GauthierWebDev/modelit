import { useEffect, useRef, useState } from "react";

/**
 * Infobulles gérées par le DOM au survol (override O-20), jamais par l'attribut `title`.
 *
 * Tout élément HTML ou SVG portant `data-tooltip` affiche son texte après un court délai ;
 * `\n` produit un retour à la ligne. Une seule couche (`TooltipLayer`, montée dans `App`)
 * écoute le survol de tout le document.
 */
export const tip = (text: string | null | undefined) => (text ? { "data-tooltip": text } : {});

const DELAY = 350;
const GAP = 8;

interface Shown {
  text: string;
  anchor: DOMRect;
}

/**
 * `outside` : fenêtre flottante native ajustée à son contenu (barre d'outils, O-45). L'infobulle se
 * place toujours sous l'élément, hors de la barre, sans être ramenée dans la fenêtre : c'est la
 * fenêtre qui s'agrandit pour l'afficher.
 */
export function TooltipLayer({ outside = false }: { outside?: boolean }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const current = useRef<Element | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setShown(null);
    };
    const onOver = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest?.("[data-tooltip]") ?? null;
      if (target === current.current) return;
      hide();
      if (!target) return;
      current.current = target;
      timer.current = window.setTimeout(() => {
        const text = target.getAttribute("data-tooltip");
        if (text && target.isConnected) setShown({ text, anchor: target.getBoundingClientRect() });
      }, DELAY);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("wheel", hide, { passive: true, capture: true });
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", hide);
      window.clearTimeout(timer.current);
    };
  }, []);

  // Placement sous l'élément (au-dessus s'il manque de place), sans sortir de la fenêtre.
  useEffect(() => {
    if (!shown || !bubble.current) return setPosition(null);
    const { width, height } = bubble.current.getBoundingClientRect();
    const { anchor } = shown;
    let top = anchor.bottom + GAP;
    const centered = anchor.left + anchor.width / 2 - width / 2;
    if (outside) return setPosition({ left: Math.max(GAP, centered), top });
    if (top + height > window.innerHeight - GAP) top = anchor.top - GAP - height;
    const left = Math.min(Math.max(GAP, centered), window.innerWidth - width - GAP);
    setPosition({ left, top: Math.max(GAP, top) });
  }, [shown, outside]);

  if (!shown) return null;
  return (
    <div
      ref={bubble}
      role="tooltip"
      style={position ?? { left: -9999, top: -9999 }}
      className="pointer-events-none fixed z-[100] max-w-sm rounded bg-neutral-900 px-2 py-1 text-xs whitespace-pre-line text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
    >
      {shown.text}
    </div>
  );
}

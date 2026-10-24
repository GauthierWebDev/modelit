import type { SVGProps } from "react";

/** Épaisseur du halo (2 px de chaque côté des lettres). */
const HALO_WIDTH = 4;

/**
 * Texte détaché du trait qu'il longe par un halo de la couleur du fond (cardinalités, rôles, libellés des liens).
 * Deux `<text>` : dessous, le seul trait du halo (`data-halo`) ; dessus, le texte. Pas de `paint-order` : beaucoup
 * de lecteurs SVG l'ignorent et peignent alors le trait par-dessus les lettres (noir sur noir en thème sombre).
 * L'export d'image recolore ou retire les halos selon le fond choisi (`ui/export/exportImage.ts`).
 */
export function HaloText({ children, fill, ...props }: SVGProps<SVGTextElement>) {
  return (
    <>
      <text
        {...props}
        data-halo=""
        fill="none"
        stroke="var(--mcd-halo)"
        strokeWidth={HALO_WIDTH}
        strokeLinejoin="round"
      >
        {children}
      </text>
      <text {...props} fill={fill}>
        {children}
      </text>
    </>
  );
}

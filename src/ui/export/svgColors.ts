/** Halo des textes (`ui/canvas/haloText.tsx`) : à l'export, la couleur du fond choisi. */
export const HALO_VARIABLE = "--mcd-halo";

/**
 * Couleurs écrites en dur dans le SVG exporté (O-17) : chaque `var(--x)` prend la valeur du thème demandé ; le halo
 * prend la couleur du fond exporté (un halo de la couleur du canevas ferait une tache sur un autre fond). Variable
 * inconnue : `currentColor`.
 */
export function resolveColors(svg: string, values: ReadonlyMap<string, string>, background: string | null): string {
  return svg.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
    name === HALO_VARIABLE && background ? background : values.get(name) || "currentColor",
  );
}

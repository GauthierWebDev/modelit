import type { ViewMode } from "@/app/document/documentView";
import { t } from "@/i18n";
import { FONT_FAMILY, type Rect } from "@/ui/canvas/geometry";
import { embeddedFontCss } from "@/ui/fonts";
import { resolveColors } from "./svgColors";

/**
 * Export du schéma en image (override O-17) : SVG, PNG, JPG, WEBP.
 *
 * Le dessin affiché par la zone graphique (`[data-export-root]`) est copié, cadré sur la zone demandée (O-63 :
 * partie affichée, sélection ou schéma complet), débarrassé des éléments d'interface (pastilles, poignées) et ses couleurs, données par
 * des variables CSS, sont remplacées par leurs valeurs pour le thème choisi : le SVG obtenu est
 * autonome, police comprise. Les formats raster sont rendus à partir de ce SVG.
 */

export type ExportFormat = "svg" | "png" | "jpg" | "webp";
/** `screen` : le thème affiché par l'application (O-63). */
export type ExportTheme = "light" | "dark" | "screen";

export interface ExportOptions {
  format: ExportFormat;
  view: ViewMode;
  theme: ExportTheme;
  /** `null` = fond transparent (impossible en JPG). */
  background: string | null;
  /** Résolution des formats raster ; 96 dpi = 100 %. */
  dpi: number;
  area: AreaSpec;
}

export const FORMATS: { id: ExportFormat; label: string; mime: string; transparent: boolean }[] = [
  { id: "svg", label: "SVG", mime: "image/svg+xml", transparent: true },
  { id: "png", label: "PNG", mime: "image/png", transparent: true },
  { id: "jpg", label: "JPG", mime: "image/jpeg", transparent: false },
  { id: "webp", label: "WEBP", mime: "image/webp", transparent: true },
];

export const DPI_OPTIONS = [96, 150, 300, 600];

const MARGIN = 24;
/** Éléments d'interface exclus de l'export. */
const UI_ONLY = "[data-badge], [data-handle], [data-bend-delete], [data-ui-only]";

export class ExportError extends Error {}

/** Valeurs des variables CSS du thème demandé, sans changer l'affichage. */
function themeValues(names: Iterable<string>, theme: ExportTheme): Map<string, string> {
  const html = document.documentElement;
  const wasDark = html.classList.contains("dark");
  html.classList.toggle("dark", theme === "screen" ? wasDark : theme === "dark");
  const style = getComputedStyle(html);
  const values = new Map([...names].map((n) => [n, style.getPropertyValue(n).trim()]));
  html.classList.toggle("dark", wasDark);
  return values;
}

/** Zone à exporter, résolue par la boîte d'export (override O-63). */
export type AreaSpec =
  | { kind: "all" }
  /** Objets gardés (`data-id`), voir `selectionIds`. */
  | { kind: "selection"; ids: ReadonlySet<string> }
  /** Partie visible du modèle et taille du canevas à l'écran, voir `visibleArea`. */
  | { kind: "viewport"; rect: Rect; pixels: { width: number; height: number } };

/** Éléments du schéma hors de la sélection exportée. */
const outside = (root: Element, area: AreaSpec): Element[] =>
  area.kind === "selection"
    ? [...root.querySelectorAll("[data-id]")].filter((el) => !area.ids.has(el.getAttribute("data-id")!))
    : [];

/** Copie du schéma sans cadrage ni éléments d'interface ; sans halo des textes sur fond transparent. */
function exportedContent(root: SVGGElement, background: string | null, area: AreaSpec): SVGGElement {
  const content = root.cloneNode(true) as SVGGElement;
  content.removeAttribute("transform");
  content.removeAttribute("data-export-root");
  for (const el of [...content.querySelectorAll(UI_ONLY), ...outside(content, area)]) {
    el.remove();
  }
  // Un halo de la couleur du canevas ferait une tache sur un fond transparent.
  if (!background) {
    for (const el of content.querySelectorAll("[data-halo]")) {
      el.remove();
    }
  }
  return content;
}

/** Cadrage (coordonnées du modèle) et taille de l'image à 96 dpi. */
function frameOf(root: SVGGElement, area: AreaSpec): { box: Rect; width: number; height: number } {
  if (area.kind === "viewport") {
    return { box: area.rect, ...area.pixels };
  }
  // Recadrage sur le contenu exporté réel : éléments d'interface et hors sélection masqués le temps de la mesure.
  const hidden = [...root.querySelectorAll<SVGElement>(UI_ONLY), ...(outside(root, area) as SVGElement[])];
  for (const el of hidden) {
    el.style.display = "none";
  }
  const measured = root.getBBox();
  for (const el of hidden) {
    el.style.display = "";
  }
  if (measured.width === 0 || measured.height === 0) {
    throw new ExportError(t("export.empty"));
  }
  const x = Math.floor(measured.x - MARGIN);
  const y = Math.floor(measured.y - MARGIN);
  const width = Math.ceil(measured.width + 2 * MARGIN);
  const height = Math.ceil(measured.height + 2 * MARGIN);
  return { box: { x, y, width, height }, width, height };
}

/** SVG autonome du schéma affiché, sur la zone demandée. */
export async function buildSvg(
  options: Pick<ExportOptions, "theme" | "background" | "area">,
): Promise<{ svg: string; width: number; height: number }> {
  const canvas = document.querySelector<SVGSVGElement>("svg[data-canvas]");
  const root = canvas?.querySelector<SVGGElement>("[data-export-root]");
  if (!(canvas && root)) {
    throw new ExportError(t("export.noCanvas"));
  }
  const content = exportedContent(root, options.background, options.area);
  const { box, width, height } = frameOf(root, options.area);

  const serializer = new XMLSerializer();
  const defs = [...canvas.querySelectorAll(":scope > defs")]
    .filter((d) => d.querySelector("marker"))
    .map((d) => serializer.serializeToString(d))
    .join("");
  let body = defs + serializer.serializeToString(content);
  const names = new Set([...body.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!));
  body = resolveColors(body, themeValues(names, options.theme), options.background);

  const fontCss = await embeddedFontCss(
    content.textContent ?? "",
    content.querySelector("[font-style=italic]") !== null,
  );
  const style = fontCss ? `<style>${fontCss}</style>` : "";
  const viewBox = `${box.x} ${box.y} ${box.width} ${box.height}`;
  const background = options.background
    ? `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${options.background}"/>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}"` +
    ` font-family="${FONT_FAMILY.replace(/"/g, "'")}">${style}${background}${body}</svg>`;
  return { svg, width, height };
}

async function rasterize(svg: string, width: number, height: number, options: ExportOptions): Promise<Blob> {
  const scale = options.dpi / 96;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ExportError(t("export.tooLarge"));
  }

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  const { mime } = FORMATS.find((f) => f.id === options.format)!;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
  // Le moteur refuse les images trop grandes.
  if (!blob) {
    throw new ExportError(t("export.tooLarge"));
  }
  if (blob.type === mime) {
    return blob;
  }

  // WebKit (macOS) n'encode pas le WebP : encodeur WebAssembly, chargé à la demande.
  if (options.format === "webp") {
    const { default: encode } = await import("@jsquash/webp/encode");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return new Blob([await encode(data, { quality: 92 })], { type: mime });
  }
  throw new ExportError(t("export.unsupported", { format: options.format.toUpperCase() }));
}

/** Image du schéma affiché, au format demandé. */
export async function renderExport(options: ExportOptions): Promise<Blob> {
  const background = options.format === "jpg" ? (options.background ?? "#ffffff") : options.background;
  const { svg, width, height } = await buildSvg({ theme: options.theme, background, area: options.area });
  if (options.format === "svg") {
    return new Blob([svg], { type: "image/svg+xml" });
  }
  return rasterize(svg, width, height, { ...options, background });
}

import type { ViewMode } from "@/app/document/documentView";
import { t } from "@/i18n";
import { FONT_FAMILY } from "@/ui/canvas/geometry";
import { embeddedFontCss } from "@/ui/fonts";

/**
 * Export du schéma en image (override O-17) : SVG, PNG, JPG, WEBP.
 *
 * Le dessin affiché par la zone graphique (`[data-export-root]`) est copié, recadré sur son
 * contenu, débarrassé des éléments d'interface (pastilles, poignées) et ses couleurs, données par
 * des variables CSS, sont remplacées par leurs valeurs pour le thème choisi : le SVG obtenu est
 * autonome, police comprise. Les formats raster sont rendus à partir de ce SVG.
 */

export type ExportFormat = "svg" | "png" | "jpg" | "webp";
export type ExportTheme = "light" | "dark";

export interface ExportOptions {
  format: ExportFormat;
  view: ViewMode;
  theme: ExportTheme;
  /** `null` = fond transparent (impossible en JPG). */
  background: string | null;
  /** Résolution des formats raster ; 96 dpi = 100 %. */
  dpi: number;
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
  html.classList.toggle("dark", theme === "dark");
  const style = getComputedStyle(html);
  const values = new Map([...names].map((n) => [n, style.getPropertyValue(n).trim()]));
  html.classList.toggle("dark", wasDark);
  return values;
}

/** SVG autonome du schéma affiché. */
export async function buildSvg(
  options: Pick<ExportOptions, "theme" | "background">,
): Promise<{ svg: string; width: number; height: number }> {
  const canvas = document.querySelector<SVGSVGElement>("svg[data-canvas]");
  const root = canvas?.querySelector<SVGGElement>("[data-export-root]");
  if (!canvas || !root) throw new ExportError(t("export.noCanvas"));

  const content = root.cloneNode(true) as SVGGElement;
  content.removeAttribute("transform");
  content.removeAttribute("data-export-root");
  content.querySelectorAll(UI_ONLY).forEach((el) => el.remove());

  // Recadrage sur le contenu réel (sans les éléments d'interface).
  const hidden = root.querySelectorAll<SVGElement>(UI_ONLY);
  hidden.forEach((el) => (el.style.display = "none"));
  const box = root.getBBox();
  hidden.forEach((el) => (el.style.display = ""));
  if (box.width === 0 || box.height === 0) throw new ExportError(t("export.empty"));

  const x = Math.floor(box.x - MARGIN);
  const y = Math.floor(box.y - MARGIN);
  const width = Math.ceil(box.width + 2 * MARGIN);
  const height = Math.ceil(box.height + 2 * MARGIN);

  const serializer = new XMLSerializer();
  const defs = [...canvas.querySelectorAll(":scope > defs")]
    .filter((d) => d.querySelector("marker"))
    .map((d) => serializer.serializeToString(d))
    .join("");
  let body = defs + serializer.serializeToString(content);
  const names = new Set([...body.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!));
  const values = themeValues(names, options.theme);
  body = body.replace(/var\((--[\w-]+)\)/g, (_, name: string) => values.get(name) || "currentColor");

  const fontCss = await embeddedFontCss(content.textContent ?? "", content.querySelector("[font-style=italic]") !== null);
  const style = fontCss ? `<style>${fontCss}</style>` : "";

  const background = options.background
    ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${options.background}"/>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}"` +
    ` font-family="${FONT_FAMILY.replace(/"/g, "'")}">${style}${background}${body}</svg>`;
  return { svg, width, height };
}

async function rasterize(svg: string, width: number, height: number, options: ExportOptions): Promise<Blob> {
  const scale = options.dpi / 96;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ExportError(t("export.tooLarge"));

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

  const mime = FORMATS.find((f) => f.id === options.format)!.mime;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
  // Le moteur refuse les images trop grandes.
  if (!blob) throw new ExportError(t("export.tooLarge"));
  if (blob.type === mime) return blob;

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
  const { svg, width, height } = await buildSvg({ theme: options.theme, background });
  if (options.format === "svg") return new Blob([svg], { type: "image/svg+xml" });
  return rasterize(svg, width, height, { ...options, background });
}

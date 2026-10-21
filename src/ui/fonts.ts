import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/inter/wght-italic.css";

/**
 * Police embarquée (Inter, licence SIL OFL 1.1) : le schéma est mesuré et dessiné à l'identique
 * sous Windows, macOS et Linux, alors qu'une police système changerait la largeur des boîtes
 * selon l'OS. Elle est aussi intégrée aux exports SVG, que le SVG soit ouvert sur une autre
 * machine ou rendu en image (un SVG chargé comme image n'a pas accès aux polices de la page).
 */

export const FONT_NAME = "Inter Variable";

/** Attend les graisses et styles utilisés par le schéma, avant toute mesure de texte. */
export async function loadFonts(): Promise<void> {
  const variants = ["400", "600", "700", "italic 400", "italic 700"];
  await Promise.all(variants.map((v) => document.fonts.load(`${v} 13px "${FONT_NAME}"`, "Aé")));
}

/**
 * Règles `@font-face` autonomes (police en data URL) couvrant `text`. Seuls les sous-ensembles
 * Unicode réellement utilisés sont intégrés, et l'italique seulement si `italic`.
 */
export async function embeddedFontCss(text: string, italic: boolean): Promise<string> {
  const codePoints = [...new Set([...text].map((c) => c.codePointAt(0)!))];
  const faces = fontFaceRules().filter(
    (rule) =>
      (italic || rule.style.getPropertyValue("font-style") !== "italic") &&
      codePoints.some((cp) => inUnicodeRange(cp, rule.style.getPropertyValue("unicode-range"))),
  );
  const rules = await Promise.all(
    faces.map(async (rule) => {
      const url = /url\("?([^")]+)"?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
      if (!url) {
        return "";
      }
      const data = await dataUrl(url);
      const { style } = rule;
      return (
        `@font-face{font-family:"${FONT_NAME}";font-style:${style.getPropertyValue("font-style")};` +
        `font-weight:${style.getPropertyValue("font-weight")};src:url(${data}) format("woff2");` +
        `unicode-range:${style.getPropertyValue("unicode-range")}}`
      );
    }),
  );
  return rules.join("");
}

function fontFaceRules(): CSSFontFaceRule[] {
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
    .filter((rule) => rule.style.getPropertyValue("font-family").replace(/["']/g, "") === FONT_NAME);
}

/** `unicode-range` absent : la règle couvre tout. */
function inUnicodeRange(codePoint: number, range: string): boolean {
  if (!range) {
    return true;
  }
  return range.split(",").some((part) => {
    const [start, end = start] = part.trim().replace(/^U\+/i, "").split("-");
    return codePoint >= Number.parseInt(start!, 16) && codePoint <= Number.parseInt(end!, 16);
  });
}

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

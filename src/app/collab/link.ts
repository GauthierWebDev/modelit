/**
 * Liens d'invitation (O-05 §4.1, §9 ; D15) : `modelit://join?a=<adresse>&s=<secret>`.
 * `a` : adresse de pair de l'hôte (JSON iroh, encodé base64url) ; `s` : secret du lien, différent
 * pour l'édition et la lecture. Le mot de passe éventuel ne figure jamais dans le lien.
 */

export const LINK_SCHEME = "modelit:";

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");

const fromBase64Url = (value: string) => {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
};

/** Secret de lien : 16 octets aléatoires, en hexadécimal. */
export const newSecret = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function buildLink(addr: string, secret: string): string {
  return `modelit://join?a=${toBase64Url(addr)}&s=${secret}`;
}

/** Lien d'invitation lu ; `null` s'il ne s'agit pas d'un lien ModelIt valide. */
export function parseLink(link: string): { addr: string; secret: string } | null {
  try {
    const url = new URL(link.trim());
    if (url.protocol !== LINK_SCHEME) {
      return null;
    }
    // `modelit://join?…` : « join » est l'hôte de l'URL (selon le moteur, parfois le chemin).
    if (url.hostname !== "join" && url.pathname.replace(/^\/+/, "") !== "join") {
      return null;
    }
    const a = url.searchParams.get("a");
    const s = url.searchParams.get("s");
    if (!(a && s && /^[0-9a-f]{32}$/.test(s))) {
      return null;
    }
    const addr = fromBase64Url(a);
    JSON.parse(addr);
    return { addr, secret: s };
  } catch {
    return null;
  }
}

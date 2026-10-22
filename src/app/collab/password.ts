/**
 * Mot de passe d'une session (O-05 §4.2, §9) : vérifié par l'hôte, par défi-réponse. Le mot de
 * passe ne circule jamais ; l'invité prouve qu'il le connaît en signant (HMAC-SHA-256) un nombre
 * aléatoire de l'hôte avec une clé dérivée du mot de passe (PBKDF2-SHA-256, 600 000 itérations).
 */

const ITERATIONS = 600_000;
/** Longueur minimale imposée à l'hôte (O-05 §4.1). */
export const MIN_PASSWORD_LENGTH = 10;
/** Essais par connexion avant fermeture (O-05 §4.2). */
export const MAX_ATTEMPTS = 3;

/**
 * Attente avant de répondre à une preuve fausse (O-05 §4.2, « attente croissante ») : aucune pour
 * les 3 premières erreurs de la session, puis 1 s, 2 s, 4 s… plafonnée à 30 s. Comptée sur toute
 * la session, une nouvelle connexion ne la remet pas à zéro ; une bonne réponse n'attend jamais.
 */
export const failureDelay = (failures: number) =>
  failures <= MAX_ATTEMPTS ? 0 : Math.min(30_000, 1000 * 2 ** (failures - MAX_ATTEMPTS - 1));

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

export const randomHex = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations: ITERATIONS },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

/** Preuve de l'invité : HMAC du défi avec la clé dérivée du mot de passe. */
export async function prove(password: string, salt: string, nonce: string): Promise<string> {
  const key = await deriveKey(password, salt);
  return hex(await crypto.subtle.sign("HMAC", key, fromHex(nonce)));
}

/** Vérificateur de l'hôte : la clé est dérivée une fois, au démarrage de la session. */
export async function verifier(
  password: string,
): Promise<{ salt: string; verify: (nonce: string, proof: string) => Promise<boolean> }> {
  const salt = randomHex();
  const key = await deriveKey(password, salt);
  return {
    salt,
    verify: (nonce, proof) => crypto.subtle.verify("HMAC", key, fromHex(proof), fromHex(nonce)),
  };
}

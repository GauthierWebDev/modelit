// biome-ignore-all lint/suspicious/noBitwiseOperators: encodage binaire des paquets du vocal
/**
 * Paquet audio du vocal (O-48, D18), transporté en datagramme : 20 ms de voix compressée en Opus.
 *
 *   [1 : version] [n : longueur de l'identifiant] [identifiant UTF-8] [numéro u16] [niveau u8] [Opus]
 *
 * Un invité envoie un identifiant vide ; l'hôte le remplace par celui de l'invité en relayant : un
 * invité ne peut pas parler au nom d'un autre. `level` : niveau de la voix (0–255), pour signaler
 * qui parle sans décoder.
 */

export const PACKET_VERSION = 1;
/** Au-delà, le paquet ne tiendrait pas dans un datagramme QUIC. */
export const MAX_PAYLOAD = 1000;

export interface AudioPacket {
  speaker: string;
  seq: number;
  level: number;
  payload: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodePacket({ speaker, seq, level, payload }: AudioPacket): Uint8Array {
  const id = encoder.encode(speaker);
  if (id.length > 255 || payload.length > MAX_PAYLOAD) {
    throw new Error("paquet audio trop grand");
  }
  const out = new Uint8Array(2 + id.length + 3 + payload.length);
  out[0] = PACKET_VERSION;
  out[1] = id.length;
  out.set(id, 2);
  const at = 2 + id.length;
  out[at] = (seq >> 8) & 0xff;
  out[at + 1] = seq & 0xff;
  out[at + 2] = Math.max(0, Math.min(255, Math.round(level)));
  out.set(payload, at + 3);
  return out;
}

/** Paquet lu ; `null` s'il est malformé ou d'une autre version (ignoré). */
export function decodePacket(data: Uint8Array): AudioPacket | null {
  if (data.length < 5 || data[0] !== PACKET_VERSION) {
    return null;
  }
  const idLength = data[1]!;
  const at = 2 + idLength;
  if (data.length < at + 3) {
    return null;
  }
  const payload = data.slice(at + 3);
  if (payload.length === 0 || payload.length > MAX_PAYLOAD) {
    return null;
  }
  return {
    speaker: decoder.decode(data.subarray(2, at)),
    seq: (data[at]! << 8) | data[at + 1]!,
    level: data[at + 2]!,
    payload,
  };
}

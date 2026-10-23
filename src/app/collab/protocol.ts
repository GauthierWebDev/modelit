import type { ModelDocument } from "@core/index";
import type { ViewMode } from "../document/documentView";
import type { Op } from "./ops";

/**
 * Session collaborative (O-05 ; J-01, phase 5a, D11) : messages entre l'hôte, qui fait foi, et les
 * invités. Le transport (iroh côté Rust, ou la mémoire dans les tests) ne fait que les acheminer.
 */

export type Role = "host" | "editor" | "reader";

export interface Participant {
  id: string;
  name: string;
  color: string;
  role: Role;
  /** Dans le vocal (O-48) ; absent : pas dans le vocal. */
  audio?: { muted: boolean };
}

/**
 * Présence d'un participant (O-05 §5) : éphémère, jamais dans l'historique. `cursor` en
 * coordonnées du modèle, `null` hors du canevas.
 */
export interface Presence {
  view: ViewMode;
  cursor: { x: number; y: number } | null;
  selection: string[];
  /** Cadrage : centre du canevas en coordonnées du modèle, et zoom (« Suivre », O-05 §5) ; absent avant v0.7. */
  viewport?: { center: { x: number; y: number }; zoom: number };
  /** Participant que je suis (« vous suit », O-05 §5). */
  following?: string | null;
}

/** Longueur maximale d'un message du chat (O-05 §6). */
export const CHAT_MAX = 2000;

/**
 * Message du chat (O-05 §6). `kind` : texte d'un participant, ou message de service (arrivée,
 * départ, exclusion) dont `name` désigne le participant concerné.
 */
export interface ChatMessage {
  id: number;
  kind: "text" | "joined" | "left" | "kicked";
  author: string;
  name: string;
  color: string;
  text: string;
  /** Heure d'envoi, horloge de l'hôte (ms). */
  at: number;
}

/** Invité → hôte. */
export type ToHost =
  /**
   * Entrée dans la session : `secret` du lien utilisé (édition ou lecture) ; `proof` : réponse au
   * défi quand la session a un mot de passe (`password.ts`).
   */
  | { type: "hello"; secret: string; name: string; color: string; proof?: string }
  /** Modifications ; `ai` : faites par un assistant IA (O-05 §8). */
  | { type: "ops"; ops: Op[]; ai?: boolean }
  | { type: "identity"; name: string; color: string }
  | { type: "presence"; presence: Presence }
  | { type: "chat"; text: string }
  /** Vocal (O-48) : rejoint ou quitté, micro coupé ou ouvert. */
  | { type: "voice"; joined: boolean; muted: boolean }
  | { type: "leave" };

/** Hôte → invité. */
export type ToGuest =
  /** Session protégée : prouver la connaissance du mot de passe (défi `nonce`, sel `salt`). */
  | { type: "challenge"; nonce: string; salt: string; attemptsLeft: number }
  /** Entrée acceptée ; `chat` : messages déjà échangés pendant la session. */
  | {
      type: "welcome";
      you: string;
      role: Exclude<Role, "host">;
      doc: ModelDocument;
      participants: Participant[];
      aiAllowed: boolean;
      chat: ChatMessage[];
      /** Nom du document partagé (titre de l'onglet de l'invité). */
      title?: string;
    }
  /** Modifications appliquées par l'hôte, dans l'ordre ; `author` : participant d'origine. */
  | { type: "ops"; ops: Op[]; author: string }
  | { type: "participants"; participants: Participant[] }
  /** Présence d'un autre participant, relayée par l'hôte. */
  | { type: "presence"; id: string; presence: Presence }
  | { type: "chat"; message: ChatMessage }
  | { type: "settings"; aiAllowed: boolean }
  /**
   * Demande refusée (lien inconnu, modification d'un lecteur, IA interdite…). `doc` : état de
   * l'hôte, sur lequel l'invité se réaligne (il avait déjà appliqué sa modification chez lui).
   */
  | { type: "rejected"; reason: RejectReason; doc?: ModelDocument }
  | { type: "ended"; reason: "stopped" | "kicked" };

export type RejectReason = "unknown-link" | "bad-password" | "full" | "read-only" | "ai-disabled";

/** Limites d'une session (O-05 §10). */
export const MAX_PARTICIPANTS = 20;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Côté hôte : un canal par invité, désigné par un identifiant de connexion. */
export interface HostLink {
  send: (peer: string, message: ToGuest) => void;
  onMessage: (handler: (peer: string, message: ToHost) => void) => () => void;
  onClose: (handler: (peer: string) => void) => () => void;
  close: (peer: string) => void;
  /** Datagramme (vocal) vers plusieurs invités : non fiable, sans ordre garanti. */
  sendDatagram: (peers: string[], data: Uint8Array) => void;
  onDatagram: (handler: (peer: string, data: Uint8Array) => void) => () => void;
}

/** Côté invité : le canal vers l'hôte. */
export interface GuestLink {
  send: (message: ToHost) => void;
  onMessage: (handler: (message: ToGuest) => void) => () => void;
  onClose: (handler: () => void) => () => void;
  close: () => void;
  sendDatagram: (data: Uint8Array) => void;
  onDatagram: (handler: (data: Uint8Array) => void) => () => void;
}

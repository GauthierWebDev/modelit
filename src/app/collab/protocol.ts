import type { ModelDocument } from "@core/index";
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
}

/** Invité → hôte. */
export type ToHost =
  /** Entrée dans la session : `secret` du lien utilisé (édition ou lecture). */
  | { type: "hello"; secret: string; name: string; color: string }
  /** Modifications ; `ai` : faites par un assistant IA (O-05 §8). */
  | { type: "ops"; ops: Op[]; ai?: boolean }
  | { type: "identity"; name: string; color: string }
  | { type: "leave" };

/** Hôte → invité. */
export type ToGuest =
  | { type: "welcome"; you: string; role: Exclude<Role, "host">; doc: ModelDocument; participants: Participant[]; aiAllowed: boolean }
  /** Modifications appliquées par l'hôte, dans l'ordre ; `author` : participant d'origine. */
  | { type: "ops"; ops: Op[]; author: string }
  | { type: "participants"; participants: Participant[] }
  | { type: "settings"; aiAllowed: boolean }
  /**
   * Demande refusée (lien inconnu, modification d'un lecteur, IA interdite…). `doc` : état de
   * l'hôte, sur lequel l'invité se réaligne (il avait déjà appliqué sa modification chez lui).
   */
  | { type: "rejected"; reason: RejectReason; doc?: ModelDocument }
  | { type: "ended"; reason: "stopped" | "kicked" };

export type RejectReason = "unknown-link" | "read-only" | "ai-disabled";

/** Côté hôte : un canal par invité, désigné par un identifiant de connexion. */
export interface HostLink {
  send(peer: string, message: ToGuest): void;
  onMessage(handler: (peer: string, message: ToHost) => void): () => void;
  onClose(handler: (peer: string) => void): () => void;
  close(peer: string): void;
}

/** Côté invité : le canal vers l'hôte. */
export interface GuestLink {
  send(message: ToHost): void;
  onMessage(handler: (message: ToGuest) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
}

/**
 * Port du moteur du vocal (O-48), défini par la session (`voiceSession.ts`) qui l'utilise ;
 * implémenté par la plateforme (`platform/voice.ts` : micro, Opus WebCodecs, lecture).
 */

/** Paquet produit par le moteur : 20 ms de voix compressée, numéro de séquence, niveau (0–255). */
export interface VoiceFrame {
  seq: number;
  level: number;
  payload: Uint8Array;
}

/** Moteur démarré : micro, lecture et volume de chaque participant. */
export interface VoiceEngine {
  /** Micro coupé : plus rien n'est capturé ni envoyé. */
  setMuted: (muted: boolean) => void;
  /** Voix reçue d'un participant. */
  play: (speaker: string, frame: VoiceFrame) => void;
  /** Volume d'un participant, de 0 à 2 (200 %). */
  setVolume: (speaker: string, gain: number) => void;
  /** Participant parti : sa lecture s'arrête. */
  forget: (speaker: string) => void;
  stop: () => void;
}

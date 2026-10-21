export const SECTIONS = ["properties", "attributes", "mld", "sql", "issues", "session"] as const;

/** Sections affichées seulement à la demande : masquées par défaut (« session » : O-05 §7). */
export const HIDDEN_BY_DEFAULT: SectionId[] = ["session"];

export type SectionId = (typeof SECTIONS)[number];

export type Zone = "right" | "bottom";

export const ZONES: Zone[] = ["right", "bottom"];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Group {
  id: string;
  sections: SectionId[];
  active: SectionId;
  /** Part de la zone occupée (poids relatif entre les groupes d'une zone). */
  weight: number;
  collapsed: boolean;
}

export interface FloatingGroup extends Group {
  /** Géométrie en coordonnées de l'écran (fenêtre native) ou de la page (navigateur). */
  rect: Rect;
}

/** Dernière place d'une section masquée, pour la lui rendre (O-46). */
export type LastPlace = { group: string } | { zone: Zone } | { rect: Rect };

export interface DockLayout {
  zones: Record<Zone, { groups: Group[] /** Largeur (droite) ou hauteur (bas), en px. */; size: number }>;
  floating: FloatingGroup[];
  hidden: SectionId[];
  lastPlace: Partial<Record<SectionId, LastPlace>>;
  toolbar: { floating: boolean; position: { x: number; y: number } | null };
}

/** Ce qu'on glisse : un onglet (une section) ou un groupe entier. */
export type DragItem = { kind: "section"; section: SectionId; group: string } | { kind: "group"; group: string };

/** Où déposer une section ou un groupe. */
export type DropTarget =
  | { kind: "group"; group: string }
  | { kind: "zone"; zone: Zone; index: number }
  | { kind: "float"; rect: Rect };

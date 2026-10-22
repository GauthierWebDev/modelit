import { flushAutosave } from "./app/autosave";
import { joinFromLink, setCollabTransport } from "./app/collab/session";
import { setVoiceBackend } from "./app/collab/voice/voiceSession";
import { setDiagramSizer } from "./app/diagramSizer";
import { setFileAccess } from "./app/fileAccess";
import { setLayoutRunner } from "./app/layoutRunner";
import { setLocalStore } from "./app/localStore";
import { startMcpBridge } from "./app/mcp/bridge";
import { setMcpEndpoint } from "./app/mcp/endpoint";
import { useUiStore } from "./app/uiStore";
import { setUpdateSource } from "./app/updateSource";
import { activeDocument } from "./app/workspace";
import { collabAvailable, connectGuestTransport, onOpenLink, startHostTransport } from "./platform/collab";
import { platformFiles } from "./platform/files";
import { indexedDbStore } from "./platform/localStore";
import { platformMcp } from "./platform/mcp";
import { platformUpdates } from "./platform/updater";
import { startVoice, voiceSupport } from "./platform/voice";
import { autoLayoutTables, workerLayoutRunner } from "./ui/canvas/autoLayout";
import { canvasSizer } from "./ui/canvas/canvasRules";

/**
 * Point d'assemblage de la fenêtre principale (esprit hexagonal, audit A-01 / M-00 L3) : seul endroit qui
 * branche les adaptateurs de la plateforme sur les ports de l'application. Appelé une fois, avant le
 * premier rendu. Les fenêtres flottantes n'en ont pas besoin : elles relaient leurs commandes à la principale.
 */
export function bootstrapMain() {
  setFileAccess(platformFiles);
  setUpdateSource(platformUpdates);
  setLocalStore(indexedDbStore);
  // Tailles des boîtes du schéma : mesurées par l'interface (texte, options d'affichage).
  setDiagramSizer(canvasSizer);
  setLayoutRunner(workerLayoutRunner);
  // Sauvegarde automatique : copies en attente écrites quand la fenêtre passe en arrière-plan ou se ferme.
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushAutosave());
  globalThis.addEventListener("pagehide", flushAutosave);
  // Sessions collaboratives (O-05) et vocal (O-48) : transport natif ; un lien `modelit://` ouvert depuis le
  // système ouvre la boîte de session, qui montre l'avancement (O-05 §4.2).
  // Assistants IA (O-47) : écoute selon les options ; le placement automatique est calculé par l'interface.
  setMcpEndpoint(platformMcp);
  startMcpBridge({ autoLayout: () => autoLayoutTables(activeDocument()) });
  if (collabAvailable()) {
    setCollabTransport({ startHost: startHostTransport, connect: connectGuestTransport });
    setVoiceBackend({ support: voiceSupport, start: startVoice });
    void onOpenLink((url) => {
      useUiStore.getState().setShareOpen(true);
      void joinFromLink(url);
    });
  }
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { GuestLink, HostLink, ToGuest, ToHost } from "@/app/collab/protocol";

/**
 * Transport des sessions collaboratives (O-05 ; J-01, phase 5a) : pair-à-pair iroh, implémenté en
 * Rust (`src-tauri/src/collab.rs`). Seul module du front qui le connaît. Indisponible dans un navigateur.
 */

export const collabAvailable = () => isTauri();

interface Payload {
  peer: string;
  data: string | null;
}

/** Abonnement à un événement Tauri, avec désinscription synchrone. */
function on(event: string, handler: (payload: Payload) => void): () => void {
  let off: (() => void) | undefined;
  let disposed = false;
  void (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const f = await listen<Payload>(event, (e) => handler(e.payload));
    if (disposed) f();
    else off = f;
  })();
  return () => {
    disposed = true;
    off?.();
  };
}

/** Datagrammes (vocal, O-48) : base64 entre l'interface et Rust (événements Tauri en texte). */
const toBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const parse = <T>(data: string | null): T | null => {
  try {
    return data ? (JSON.parse(data) as T) : null;
  } catch {
    return null;
  }
};

/** Démarre l'écoute de l'hôte ; renvoie son adresse (à mettre dans les liens) et son canal. */
export async function startHostTransport(): Promise<{ addr: string; link: HostLink; stop: () => Promise<void> }> {
  const addr = await invoke<string>("collab_host_start");
  const link: HostLink = {
    send: (peer, message: ToGuest) => void invoke("collab_host_send", { peer, data: JSON.stringify(message) }),
    onMessage: (handler) =>
      on("collab://host-message", ({ peer, data }) => {
        const message = parse<ToHost>(data);
        if (message) handler(peer, message);
      }),
    onClose: (handler) => on("collab://host-close", ({ peer }) => handler(peer)),
    close: (peer) => void invoke("collab_host_close", { peer }),
    sendDatagram: (peers, data) => void invoke("collab_host_datagram", { peers, data: toBase64(data) }),
    onDatagram: (handler) => on("collab://host-datagram", ({ peer, data }) => data && handler(peer, fromBase64(data))),
  };
  return { addr, link, stop: () => invoke("collab_host_stop") };
}

/** Rejoint l'hôte d'adresse `addr` (tirée du lien) ; renvoie le canal. */
export async function connectGuestTransport(addr: string): Promise<GuestLink> {
  // Abonnements posés avant la connexion : aucun message de l'hôte n'est perdu.
  const handlers = new Set<(message: ToGuest) => void>();
  const closers = new Set<() => void>();
  const offMessage = on("collab://guest-message", ({ data }) => {
    const message = parse<ToGuest>(data);
    if (message) for (const h of handlers) h(message);
  });
  const offClose = on("collab://guest-close", () => {
    for (const h of closers) h();
  });
  const datagrams = new Set<(data: Uint8Array) => void>();
  const offDatagram = on("collab://guest-datagram", ({ data }) => {
    if (!data) return;
    const bytes = fromBase64(data);
    for (const h of datagrams) h(bytes);
  });
  try {
    await invoke("collab_guest_connect", { addr });
  } catch (e) {
    offMessage();
    offClose();
    offDatagram();
    throw e;
  }
  return {
    send: (message: ToHost) => void invoke("collab_guest_send", { data: JSON.stringify(message) }),
    onMessage: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: (handler) => {
      closers.add(handler);
      return () => closers.delete(handler);
    },
    close: () => {
      offMessage();
      offClose();
      offDatagram();
      void invoke("collab_guest_close");
    },
    sendDatagram: (data) => void invoke("collab_guest_datagram", { data: toBase64(data) }),
    onDatagram: (handler) => {
      datagrams.add(handler);
      return () => datagrams.delete(handler);
    },
  };
}

/** Liens `modelit://` reçus : au lancement de l'application, puis pendant qu'elle tourne. */
export async function onOpenLink(handler: (url: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  for (const url of (await getCurrent()) ?? []) handler(url);
  return onOpenUrl((urls) => urls.forEach(handler));
}

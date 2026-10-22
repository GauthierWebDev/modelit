import type { GuestLink, HostLink, ToGuest, ToHost } from "./protocol";

/** Extrémité d'un invité dans le réseau simulé. */
interface GuestEnd {
  handlers: Set<(m: ToGuest) => void>;
  close: Set<() => void>;
  datagrams: Set<(data: Uint8Array) => void>;
  open: boolean;
}

/** État du réseau simulé : file des livraisons, abonnés de l'hôte, invités. */
interface Net {
  queue: (() => void)[];
  hostHandlers: Set<(peer: string, m: ToHost) => void>;
  hostClose: Set<(peer: string) => void>;
  hostDatagrams: Set<(peer: string, data: Uint8Array) => void>;
  guests: Map<string, GuestEnd>;
  /** Datagrammes perdus (vocal) : `lose(n)` fait perdre les n prochains. */
  toLose: number;
}

const clone = <T>(m: T): T => structuredClone(m);

/**
 * Pour les tests uniquement. Réseau simulé : les messages attendent dans une file et ne sont livrés
 * qu'à `flush()`, dans l'ordre d'envoi. On reproduit ainsi des modifications réellement simultanées.
 */
export function memoryNetwork() {
  const net: Net = {
    queue: [],
    hostHandlers: new Set(),
    hostClose: new Set(),
    hostDatagrams: new Set(),
    guests: new Map(),
    toLose: 0,
  };
  const flush = () => {
    while (net.queue.length > 0) {
      net.queue.shift()!();
    }
  };
  /** Livre tout, y compris ce qu'envoient les traitements asynchrones (vérification du mot de passe). */
  const settle = async () => {
    for (let i = 0; i < 50; i += 1) {
      flush();
      // biome-ignore lint/performance/noAwaitInLoops: un tour de boucle d'événements par passe, séquentiel par nature
      await new Promise((r) => setTimeout(r, 0));
      if (net.queue.length === 0) {
        await new Promise((r) => setTimeout(r, 20));
        if (net.queue.length === 0) {
          return;
        }
      }
    }
  };
  return {
    hostLink: hostLink(net),
    connect: (peer: string) => connect(net, peer),
    flush,
    settle,
    lose: (n: number) => {
      net.toLose = n;
    },
  };
}

/** Datagramme livré, sauf s'il doit être perdu. */
function delivered(net: Net) {
  if (net.toLose > 0) {
    net.toLose -= 1;
    return false;
  }
  return true;
}

function hostLink(net: Net): HostLink {
  const { queue, guests } = net;
  return {
    send: (peer, m) =>
      queue.push(() => {
        const g = guests.get(peer);
        if (g?.open) {
          for (const h of g.handlers) {
            h(clone(m));
          }
        }
      }),
    onMessage: (h) => {
      net.hostHandlers.add(h);
      return () => net.hostHandlers.delete(h);
    },
    onClose: (h) => {
      net.hostClose.add(h);
      return () => net.hostClose.delete(h);
    },
    close: (peer) => {
      const g = guests.get(peer);
      if (!g?.open) {
        return;
      }
      queue.push(() => {
        g.open = false;
        for (const h of g.close) {
          h();
        }
      });
    },
    sendDatagram: (peers, data) => {
      for (const peer of peers) {
        if (!delivered(net)) {
          continue;
        }
        const copy = data.slice();
        queue.push(() => {
          const g = guests.get(peer);
          if (g?.open) {
            for (const h of g.datagrams) {
              h(copy);
            }
          }
        });
      }
    },
    onDatagram: (h) => {
      net.hostDatagrams.add(h);
      return () => net.hostDatagrams.delete(h);
    },
  };
}

function connect(net: Net, peer: string): GuestLink {
  const { queue } = net;
  const g: GuestEnd = { handlers: new Set(), close: new Set(), datagrams: new Set(), open: true };
  net.guests.set(peer, g);
  return {
    send: (m) =>
      queue.push(() => {
        if (g.open) {
          for (const h of net.hostHandlers) {
            h(peer, clone(m));
          }
        }
      }),
    onMessage: (h) => {
      g.handlers.add(h);
      return () => g.handlers.delete(h);
    },
    onClose: (h) => {
      g.close.add(h);
      return () => g.close.delete(h);
    },
    close: () => {
      g.open = false;
      for (const h of net.hostClose) {
        h(peer);
      }
    },
    sendDatagram: (data) => {
      if (!delivered(net)) {
        return;
      }
      const copy = data.slice();
      queue.push(() => {
        if (g.open) {
          for (const h of net.hostDatagrams) {
            h(peer, copy);
          }
        }
      });
    },
    onDatagram: (h) => {
      g.datagrams.add(h);
      return () => g.datagrams.delete(h);
    },
  };
}

import type { GuestLink, HostLink, ToGuest, ToHost } from "./protocol";

/**
 * Pour les tests uniquement. Réseau simulé : les messages attendent dans une file et ne sont livrés
 * qu'à `flush()`, dans l'ordre d'envoi. On reproduit ainsi des modifications réellement simultanées.
 */
export function memoryNetwork() {
  const queue: (() => void)[] = [];
  const hostHandlers = new Set<(peer: string, m: ToHost) => void>();
  const hostClose = new Set<(peer: string) => void>();
  const guests = new Map<string, { handlers: Set<(m: ToGuest) => void>; close: Set<() => void>; open: boolean }>();
  const clone = <T>(m: T): T => structuredClone(m);

  const hostLink: HostLink = {
    send: (peer, m) =>
      queue.push(() => {
        const g = guests.get(peer);
        if (g?.open) for (const h of g.handlers) h(clone(m));
      }),
    onMessage: (h) => {
      hostHandlers.add(h);
      return () => hostHandlers.delete(h);
    },
    onClose: (h) => {
      hostClose.add(h);
      return () => hostClose.delete(h);
    },
    close: (peer) => {
      const g = guests.get(peer);
      if (!g?.open) return;
      queue.push(() => {
        g.open = false;
        for (const h of g.close) h();
      });
    },
  };
  const connect = (peer: string): GuestLink => {
    const g = { handlers: new Set<(m: ToGuest) => void>(), close: new Set<() => void>(), open: true };
    guests.set(peer, g);
    return {
      send: (m) =>
        queue.push(() => {
          if (g.open) for (const h of hostHandlers) h(peer, clone(m));
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
        for (const h of hostClose) h(peer);
      },
    };
  };
  const flush = () => {
    while (queue.length) queue.shift()!();
  };
  /** Livre tout, y compris ce qu'envoient les traitements asynchrones (vérification du mot de passe). */
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      flush();
      await new Promise((r) => setTimeout(r, 0));
      if (!queue.length) {
        await new Promise((r) => setTimeout(r, 20));
        if (!queue.length) return;
      }
    }
  };
  return { hostLink, connect, flush, settle };
}

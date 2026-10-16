import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { updateDock } from "@/app/dock/actions";
import { closeGroup, findGroup, setToolbar } from "@/app/dock/layout";
import { DocumentProvider } from "@/app/document/DocumentContext";
import { usePreferencesStore } from "@/app/preferencesStore";
import type { ToMain, ToReplica } from "@/app/windows/protocol";
import { type Replica, startReplica, useMirrorStore } from "@/app/windows/replica";
import {
  currentInnerRect,
  floatKind,
  focusMain,
  moveOwnWindow,
  onGeometryChange,
  type ResizeEdge,
  replicaChannel,
  setOwnSize,
  startWindowResize,
} from "@/platform/floatWindows";
import { blockNativeContextMenu } from "@/ui/canvas/ContextMenu";
import { TooltipLayer } from "@/ui/common/Tooltip";
import { GroupView } from "@/ui/dock/Dock";
import { setDropDelegate, setScreenOrigin } from "@/ui/dock/drag";
import { useApplyTheme } from "@/ui/theme";
import { Toolbar } from "@/ui/toolbar/Toolbar";
import { setMainCommandRelay } from "./mainCommands";

/**
 * Page d'une fenêtre flottante native (overrides O-45, O-46 ; J-01, phase 4) : barre d'outils ou
 * groupe de sections, affichant le document de l'onglet actif de la fenêtre principale.
 */

type Kind = NonNullable<ReturnType<typeof floatKind>>;

/** Redimensionnement terminé : plus d'événement de géométrie depuis ce délai. */
const SETTLE = 300;
/** Distance (px) à partir de laquelle un appui sur la poignée devient un déplacement. */
const DRAG_THRESHOLD = 3;

type MovedFloat = Extract<ToMain, { type: "moved" }>["float"];

/** Fenêtre courante : canal, identité, géométrie à l'écran, déplacement en cours. */
const self: {
  send: ((message: ToMain) => void) | null;
  float: MovedFloat | null;
  rect: { x: number; y: number; width: number; height: number };
  dragging: boolean;
} = { send: null, float: null, rect: { x: 0, y: 0, width: 0, height: 0 }, dragging: false };

export function FloatRoot({ kind }: { kind: Kind }) {
  const [replica, setReplica] = useState<Replica | null>(null);
  useApplyTheme();
  // Pas de menu contextuel natif dans les fenêtres flottantes non plus (O-53).
  useEffect(() => blockNativeContextMenu(), []);

  useLayoutEffect(() => {
    // Fenêtre transparente : seule la barre ou le groupe (coins arrondis, ombre) est visible.
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    const offs: (() => void)[] = [];
    let disposed = false;
    void (async () => {
      const channel = await replicaChannel<ToMain, ToReplica>();
      if (disposed) return;
      const r = startReplica(channel);
      offs.push(r.stop);
      setMainCommandRelay(r.command);
      setDropDelegate((item, screen) => channel.send({ type: "drop", item, screen }));
      self.send = (m) => channel.send(m);
      self.float = kind.kind === "toolbar" ? { kind: "toolbar" } : { kind: "group", id: kind.id };
      let settle: number | undefined;
      // Géométrie changée hors déplacement par la poignée (redimensionnement…) : enregistrée à la fin.
      const report = async () => {
        self.rect = await currentInnerRect();
        setScreenOrigin(self.rect);
        if (self.dragging) return;
        clearTimeout(settle);
        settle = setTimeout(
          () => channel.send({ type: "moved", float: self.float!, rect: self.rect, pointer: null, final: true }),
          SETTLE,
        );
      };
      self.rect = await currentInnerRect();
      setScreenOrigin(self.rect);
      offs.push(await onGeometryChange(() => void report()));
      setReplica(r);
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, [kind]);

  if (!replica) return null;
  return (
    <DocumentProvider handle={replica.handle}>
      {kind.kind === "toolbar" ? <FloatToolbar /> : <FloatGroup id={kind.id} />}
      <ModalShield />
      <TooltipLayer outside={kind.kind === "toolbar"} />
    </DocumentProvider>
  );
}

/** Boîte modale ouverte dans la fenêtre principale : la flottante est désactivée (O-45). */
function ModalShield() {
  const modal = useMirrorStore((s) => s.state?.modal ?? false);
  if (!modal) return null;
  return <div className="fixed inset-0 z-50 cursor-not-allowed rounded-lg bg-white/50 dark:bg-neutral-900/50" />;
}

/**
 * Double-clic sur la poignée : ancrer ; glisser : déplacer la fenêtre. Le déplacement est géré par
 * la page (et non par le système) pour connaître le relâchement : la fenêtre principale garde la
 * cible d'ancrage allumée tant que la poignée est tenue, et ne décide qu'au relâchement.
 */
function useGrip(onDoubleClick: () => void) {
  const last = useRef(0);
  return (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const now = Date.now();
    if (now - last.current < 350) {
      last.current = 0;
      return onDoubleClick();
    }
    last.current = now;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const start = { x: e.screenX, y: e.screenY };
    const origin = { ...self.rect };
    let moved = false;
    let frame = 0;
    const at = (ev: PointerEvent) => ({
      ...origin,
      x: origin.x + ev.screenX - start.x,
      y: origin.y + ev.screenY - start.y,
    });
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.screenX - start.x, ev.screenY - start.y) < DRAG_THRESHOLD) return;
      moved = true;
      self.dragging = true;
      const rect = at(ev);
      const pointer = { x: ev.screenX, y: ev.screenY };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void moveOwnWindow(rect.x, rect.y);
        self.send?.({ type: "moved", float: self.float!, rect, pointer, final: false });
      });
    };
    const up = (ev: PointerEvent) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      cancelAnimationFrame(frame);
      if (!moved) return;
      const rect = at(ev);
      void moveOwnWindow(rect.x, rect.y);
      self.rect = rect;
      self.dragging = false;
      self.send?.({ type: "moved", float: self.float!, rect, pointer: { x: ev.screenX, y: ev.screenY }, final: true });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };
}

function FloatToolbar() {
  const ref = useRef<HTMLDivElement>(null);
  const onGripDown = useGrip(() => updateDock((l) => setToolbar(l, { floating: false })));

  // La fenêtre épouse la barre (largeur naturelle, indépendante de la fenêtre), et s'agrandit le
  // temps qu'un menu déroulant est ouvert. Redimensionnée seulement si la taille change.
  useEffect(() => {
    let last = "";
    const fit = () => {
      const bar = ref.current?.getBoundingClientRect();
      if (!bar) return;
      // Menus déroulants et infobulles débordent de la barre : la fenêtre les englobe.
      const menus = [...document.querySelectorAll('[role="menu"], [role="tooltip"]')].map((m) =>
        m.getBoundingClientRect(),
      );
      const width = Math.ceil(Math.max(bar.right, ...menus.map((m) => m.right)) + 8);
      const height = Math.ceil(Math.max(bar.bottom, ...menus.map((m) => m.bottom)) + 8);
      const size = `${width}x${height}`;
      if (size === last) return;
      last = size;
      void setOwnSize(width, height);
    };
    fit();
    const resize = new ResizeObserver(fit);
    if (ref.current) resize.observe(ref.current);
    const mutations = new MutationObserver(fit);
    // Ajout d'un menu ou d'une infobulle, et leur placement (style) une fois mesurés.
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);

  // Après un clic, le clavier revient au canevas (raccourcis, O-45) ; une liste garde le focus,
  // le temps de choisir.
  useEffect(() => {
    const giveBack = (e: PointerEvent) => {
      if ((e.target as Element).closest("select")) return;
      setTimeout(() => void focusMain(), 0);
    };
    window.addEventListener("pointerup", giveBack);
    return () => window.removeEventListener("pointerup", giveBack);
  }, []);

  return (
    <div ref={ref} className="w-max p-1">
      <Toolbar floating onGripDown={onGripDown} />
    </div>
  );
}

function FloatGroup({ id }: { id: string }) {
  const group = usePreferencesStore((s) => findGroup(s.dock, id)?.group);
  const onGripDown = useGrip(() => undefined);
  const resize = (edge: ResizeEdge) => (e: ReactPointerEvent) => {
    e.preventDefault();
    void startWindowResize(edge);
  };
  // Groupe disparu de la disposition (ancré, fermé) : la principale va fermer la fenêtre.
  if (!group) return null;
  return (
    <div className="fixed inset-0 overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-600">
      <GroupView
        group={group}
        zone={null}
        onClose={() => updateDock((l) => closeGroup(l, id))}
        onGripDown={onGripDown}
      />
      <div className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize" onPointerDown={resize("East")} />
      <div className="absolute bottom-0 left-0 h-1.5 w-full cursor-row-resize" onPointerDown={resize("South")} />
      <div className="absolute right-0 bottom-0 size-3 cursor-nwse-resize" onPointerDown={resize("SouthEast")} />
    </div>
  );
}

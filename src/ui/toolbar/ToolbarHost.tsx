import { useRef, useState, type PointerEvent } from "react";
import { create } from "zustand";
import { updateDock } from "@/app/dock/actions";
import { setToolbar } from "@/app/dock/layout";
import { usePreferencesStore } from "@/app/preferencesStore";
import { nativeWindows } from "@/platform/floatWindows";
import { toScreen } from "@/ui/dock/drag";
import { Toolbar } from "./Toolbar";

/** Barre flottante native survolant la bande d'ancrage (allumée par la fenêtre principale). */
export const useToolbarBand = create<{ over: boolean }>(() => ({ over: false }));

/**
 * Barre d'outils ancrée ou flottante (override O-45), dans la page. Glisser la poignée vers le bas
 * détache la barre ; la glisser sur la bande du haut l'ancre ; double-clic : l'un ou l'autre.
 */

/** Hauteur de la bande d'ancrage, en haut de la fenêtre. */
const DOCK_BAND = 44;
/** Distance à parcourir vers le bas pour détacher la barre ancrée. */
const DETACH_DISTANCE = 24;

type Drag = { offset: { x: number; y: number }; start: { x: number; y: number }; floating: boolean };

export function ToolbarHost() {
  const toolbar = usePreferencesStore((s) => s.dock.toolbar);
  const [drag, setDrag] = useState<{ position: { x: number; y: number } | null; overBand: boolean } | null>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const lastClick = useRef(0);

  function onGripDown(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const now = Date.now();
    // Double-clic sur la poignée : ancrer / détacher.
    if (now - lastClick.current < 350) {
      lastClick.current = 0;
      updateDock((l) => setToolbar(l, { floating: !l.toolbar.floating }));
      return;
    }
    lastClick.current = now;
    const box = (toolbar.floating ? floatingRef.current : e.currentTarget)?.getBoundingClientRect();
    const state: Drag = {
      offset: { x: e.clientX - (box?.x ?? 0), y: e.clientY - (box?.y ?? 0) },
      start: { x: e.clientX, y: e.clientY },
      floating: toolbar.floating,
    };
    let current: { position: { x: number; y: number } | null; overBand: boolean } | null = null;
    const move = (ev: globalThis.PointerEvent) => {
      if (!state.floating && ev.clientY - state.start.y < DETACH_DISTANCE) return;
      if (!state.floating) {
        state.floating = true;
        state.offset = { x: 16, y: 16 };
      }
      current = { position: { x: ev.clientX - state.offset.x, y: ev.clientY - state.offset.y }, overBand: ev.clientY < DOCK_BAND };
      setDrag(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!current) return;
      const { position, overBand } = current;
      if (nativeWindows()) {
        // La barre devient une fenêtre native, à la même place à l'écran.
        updateDock((l) => setToolbar(l, overBand ? { floating: false } : { floating: true, position: position && toScreen(position) }));
        return;
      }
      // Dans la page, la barre reste entièrement visible (ses dimensions naturelles sont gardées).
      const width = floatingRef.current?.offsetWidth ?? 0;
      const height = floatingRef.current?.offsetHeight ?? 0;
      const clamped = position && {
        x: Math.max(0, Math.min(position.x, window.innerWidth - width)),
        y: Math.max(0, Math.min(position.y, window.innerHeight - height)),
      };
      updateDock((l) => setToolbar(l, overBand ? { floating: false } : { floating: true, position: clamped }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const nativeBand = useToolbarBand((s) => s.over);
  const floating = drag ? true : toolbar.floating;
  const position = drag?.position ?? toolbar.position;
  // Application native : la barre flottante est une fenêtre (FloatManager) ; ici, seule la bande d'ancrage.
  if (nativeWindows() && toolbar.floating && !drag) {
    return nativeBand ? <div className="h-9 flex-none border-b-2 border-blue-500 bg-blue-500/15" /> : null;
  }

  return (
    <>
      {!floating && <Toolbar onGripDown={onGripDown} />}
      {floating && drag?.overBand && <div className="h-9 flex-none border-b-2 border-blue-500 bg-blue-500/15" />}
      {floating && (
        <div
          ref={floatingRef}
          data-floating-toolbar=""
          className="fixed z-40 w-max"
          style={position ? { left: position.x, top: position.y } : { left: "50%", top: 56, transform: "translateX(-50%)" }}
        >
          <Toolbar floating onGripDown={onGripDown} />
        </div>
      )}
    </>
  );
}

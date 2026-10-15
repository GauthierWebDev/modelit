import { useEffect } from "react";
import { updateDock } from "@/app/dock/actions";
import { findGroup, keepOnScreen, moveGroup, setFloatingRect, setToolbar, type DockLayout, type DragItem } from "@/app/dock/layout";
import { usePreferencesStore } from "@/app/preferencesStore";
import { startOwner } from "@/app/windows/owner";
import type { ToMain, ToReplica } from "@/app/windows/protocol";
import {
  closeFloat,
  currentInnerRect,
  groupLabel,
  nativeWindows,
  onGeometryChange,
  openFloat,
  openFloats,
  ownerChannel,
  placeFloat,
  screens,
  toolbarLabel,
  type ScreenRect,
} from "@/platform/floatWindows";
import { dropItem, setScreenOrigin, targetAt, useDragStore } from "@/ui/dock/drag";
import { useToolbarBand } from "@/ui/toolbar/ToolbarHost";
import { runMainCommand } from "./mainCommands";

/**
 * Fenêtres flottantes natives, côté fenêtre principale (overrides O-45, O-46 ; J-01, phase 4) :
 * démarre la synchronisation, ouvre et ferme les fenêtres selon la disposition, et ancre celles
 * qu'on lâche sur une zone. Rattachées à la principale, elles restent devant elle et passent
 * derrière les autres applications avec elle ; on ne les masque ni ne les réaffiche jamais :
 * réafficher une fenêtre lui donne le focus, au détriment du canevas.
 */

/** Bande d'ancrage de la barre, en haut de la fenêtre principale, et sa marge au-dessus. */
const TOOLBAR_BAND = 90;
const TOOLBAR_BAND_ABOVE = 60;
/** Taille de départ de la barre flottante ; la fenêtre s'ajuste ensuite à son contenu. */
const TOOLBAR_START = { width: 900, height: 44 };

let inner: ScreenRect = { x: 0, y: 0, width: 1280, height: 800 };
const applied = new Map<string, string>();

function desiredFloats(layout: DockLayout) {
  const floats = new Map<string, { url: string; rect: ScreenRect; resizable: boolean; focusable: boolean }>();
  if (layout.toolbar.floating) {
    const p = layout.toolbar.position ?? { x: inner.x + (inner.width - TOOLBAR_START.width) / 2, y: inner.y + 56 };
    // Fenêtre focalisable : sous macOS, une fenêtre qui ne peut pas prendre le focus ne reçoit pas le
    // survol (ni effet de survol, ni infobulle). Elle rend le focus après chaque clic (FloatRoot).
    floats.set(toolbarLabel, { url: "/?float=toolbar", rect: { ...p, ...TOOLBAR_START }, resizable: false, focusable: true });
  }
  // Un groupe contient des champs de saisie (Propriétés, Modèle) : il doit pouvoir prendre le focus.
  for (const g of layout.floating) {
    floats.set(groupLabel(g.id), { url: `/?float=group&id=${encodeURIComponent(g.id)}`, rect: g.rect, resizable: true, focusable: true });
  }
  return floats;
}

async function reconcile(layout: DockLayout) {
  const wanted = desiredFloats(layout);
  const open = new Set(await openFloats());
  for (const [label, { url, rect, resizable, focusable }] of wanted) {
    // La barre s'ajuste elle-même à son contenu : seule sa position est imposée après l'ouverture.
    const key = JSON.stringify(label === toolbarLabel ? { x: rect.x, y: rect.y } : rect);
    if (!open.has(label)) await openFloat(label, url, rect, { resizable, focusable });
    else if (applied.get(label) !== key && label !== toolbarLabel) await placeFloat(label, rect);
    applied.set(label, key);
  }
  for (const label of open) {
    if (wanted.has(label)) continue;
    applied.delete(label);
    await closeFloat(label);
  }
}

/** Point de l'écran → point de la page principale. */
const toClient = (p: { x: number; y: number }) => ({ x: p.x - inner.x, y: p.y - inner.y });
/** Marge autour de la fenêtre principale où une cible d'ancrage reste valable. */
const ZONE_MARGIN = 48;
const insideMain = (p: { x: number; y: number }) =>
  p.x >= -ZONE_MARGIN && p.y >= -ZONE_MARGIN && p.x <= inner.width + ZONE_MARGIN && p.y <= inner.height + ZONE_MARGIN;

/**
 * Fenêtre flottante déplacée. Par sa poignée (`pointer`) : bande ou zone d'ancrage allumée tant que
 * la poignée est tenue, ancrage décidé au relâchement (`final`). Sinon : géométrie à enregistrer.
 */
function onMoved(message: Extract<ToMain, { type: "moved" }>) {
  const { float, rect, pointer, final } = message;
  const layout = usePreferencesStore.getState().dock;
  if (!pointer) {
    if (float.kind === "toolbar" && layout.toolbar.floating) updateDock((l) => setToolbar(l, { position: { x: rect.x, y: rect.y } }));
    if (float.kind === "group" && findGroup(layout, float.id)) updateDock((l) => setFloatingRect(l, float.id, rect));
    return;
  }
  const p = toClient(pointer);
  if (float.kind === "toolbar") {
    const over = p.y > -TOOLBAR_BAND_ABOVE && p.y < TOOLBAR_BAND && p.x >= -ZONE_MARGIN && p.x <= inner.width + ZONE_MARGIN;
    if (useToolbarBand.getState().over !== (over && !final)) useToolbarBand.setState({ over: over && !final });
    if (final) updateDock((l) => setToolbar(l, over ? { floating: false } : { floating: true, position: { x: rect.x, y: rect.y } }));
    return;
  }
  const item: DragItem = { kind: "group", group: float.id };
  const target = insideMain(p) ? targetAt(p.x, p.y, item) : null;
  const docking = target?.kind === "zone" ? target : null;
  if (!final) {
    // Mis à jour seulement quand la cible change : pas de clignotement des zones.
    const current = useDragStore.getState();
    const same = current.item !== null && JSON.stringify(current.target) === JSON.stringify(docking);
    if (!same) useDragStore.setState({ item, pointer: null, target: docking });
    return;
  }
  useDragStore.setState({ item: null, pointer: null, target: null });
  if (docking) return updateDock((l) => moveGroup(l, float.id, docking));
  if (findGroup(layout, float.id)) updateDock((l) => setFloatingRect(l, float.id, rect));
}

/** Glisser commencé dans une fenêtre flottante : la cible est décidée ici. */
function onDrop({ item, screen }: Extract<ToMain, { type: "drop" }>) {
  // Hors de la page, seules les fenêtres flottantes sont des cibles ; sinon, flottant sous le pointeur.
  const p = toClient(screen);
  dropItem(item, targetAt(p.x, p.y, item));
}

export function FloatManager() {
  const layout = usePreferencesStore((s) => s.dock);

  useEffect(() => {
    if (!nativeWindows()) return;
    const offs: (() => void)[] = [];
    let disposed = false;
    void (async () => {
      const refresh = async () => {
        inner = await currentInnerRect();
        setScreenOrigin(inner);
      };
      await refresh();
      const channel = await ownerChannel<ToReplica, ToMain>();
      if (disposed) return;
      offs.push(
        startOwner(channel, runMainCommand, {
          onDrop,
          onMoved,
          schedule: (f) => requestAnimationFrame(f),
        }),
      );
      offs.push(await onGeometryChange(() => void refresh()));
      const all = await screens();
      updateDock((l) => keepOnScreen(l, all, inner));
    })();
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, []);

  useEffect(() => {
    if (nativeWindows()) void reconcile(layout);
  }, [layout]);

  return null;
}

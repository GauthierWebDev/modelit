import { useEffect } from "react";
import { APP_NAME } from "@/app/appInfo";
import { startAutosave } from "@/app/autosave";
import { endSessionOnExit } from "@/app/collab/session";
import { DocumentProvider, useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { selectIsDirty } from "@/app/document/documentStore";
import { documentName } from "@/app/documentNames";
import { closeDocument } from "@/app/fileCommands";
import { useUiStore } from "@/app/uiStore";
import { confirmLoseAllChanges } from "@/app/unsavedGuard";
import { scheduleUpdateCheck, showWhatsNew } from "@/app/updates";
import { activeDocument, useActiveDocument, useWorkspaceStore } from "@/app/workspace";
import { t } from "@/i18n";
import { closeAllFloats, nativeWindows } from "@/platform/floatWindows";
import { onCloseRequested, onMenuAbout, onMenuCloseTab, onMenuModelSettings, setWindowTitle } from "@/platform/window";
import { AboutDialog } from "./about/AboutDialog";
import { blockNativeContextMenu, ContextMenuLayer } from "./canvas/ContextMenu";
import { LogicalCanvas } from "./canvas/LogicalCanvas";
import { McdCanvas } from "./canvas/McdCanvas";
import { QuickActions } from "./canvas/QuickActions";
import { useClipboard } from "./clipboard";
import { CollabBridge } from "./collab/CollabBridge";
import { CollabIndicator } from "./collab/CollabIndicator";
import { ShareDialog } from "./collab/ShareDialog";
import { DialogHost } from "./common/DialogHost";
import { TooltipLayer } from "./common/Tooltip";
import { DockZone, DragGhost, FloatingGroups } from "./dock/Dock";
import { ExportDialog } from "./export/ExportDialog";
import { McpIndicator } from "./mcp/McpIndicator";
import { OptionsDialog } from "./options/OptionsDialog";
import { ReverseDialog } from "./reverse/ReverseDialog";
import { ModelSettingsDialog } from "./settings/ModelSettingsDialog";
import { useShortcuts } from "./shortcuts";
import { DbmsTarget } from "./status/DbmsTarget";
import { IssuesStatus, SelectionStatus, ZoomStatus } from "./status/StatusItems";
import { TabBar } from "./tabs/TabBar";
import { useApplyTheme } from "./theme";
import { ToolbarHost } from "./toolbar/ToolbarHost";
import { FloatManager } from "./windows/FloatManager";

const anyDocumentDirty = () => useWorkspaceStore.getState().documents.some((d) => selectIsDirty(d.store.getState()));

/** Fenêtre : fournit le document de l'onglet actif à toute l'interface (override O-44). */
export function App() {
  const active = useActiveDocument();
  return (
    <DocumentProvider handle={active}>
      <Workbench />
    </DocumentProvider>
  );
}

function Workbench() {
  useShortcuts();
  useClipboard();
  useApplyTheme();
  const doc = useDocumentHandle();
  const view = useDocumentView((s) => s.view);
  const dirty = useDocument(selectIsDirty);
  const recovered = useDocument((s) => s.recovered);
  // Le nom suit l'enregistrement (filePath) et la numérotation « Sans titre N ».
  useDocument((s) => s.filePath);
  const untitled = useWorkspaceStore((s) => s.untitled);
  const titles = useWorkspaceStore((s) => s.titles);
  const title = `${documentName(doc, untitled, titles)}${recovered ? ` ${t("app.recovered")}` : ""}`;
  const status = useUiStore((s) => s.status);
  const notify = useUiStore((s) => s.notify);

  useEffect(() => {
    void setWindowTitle(`${dirty ? "• " : ""}${title} — ${APP_NAME}`);
  }, [title, dirty]);

  useEffect(() => startAutosave(), []);
  useEffect(() => blockNativeContextMenu(), []);
  useEffect(() => scheduleUpdateCheck(), []);
  useEffect(() => showWhatsNew(), []);
  useEffect(() => onMenuAbout(() => useUiStore.getState().setAbout("about")), []);
  useEffect(() => onMenuModelSettings(() => useUiStore.getState().setModelSettingsOpen(true)), []);
  useEffect(() => onMenuCloseTab(() => void closeDocument(activeDocument())), []);

  useEffect(
    () =>
      onCloseRequested(async () => {
        const ok = await confirmLoseAllChanges();
        if (ok) {
          await endSessionOnExit();
        }
        // Les fenêtres flottantes se ferment avec la principale (O-45, O-46).
        if (ok && nativeWindows()) {
          await closeAllFloats();
        }
        return ok;
      }, anyDocumentDirty),
    [],
  );

  useEffect(() => {
    if (!status) {
      return;
    }
    const timer = setTimeout(() => notify(null), 3000);
    return () => clearTimeout(timer);
  }, [status, notify]);

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <ToolbarHost />
      <TabBar />
      {/* Remonté à chaque changement d'onglet : gestes en cours et saisies locales repartent de zéro. */}
      <div key={doc.id} className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {view === "mcd" ? <McdCanvas /> : <LogicalCanvas key={view} mode={view} />}
            <QuickActions />
          </div>
          <DockZone zone="bottom" />
        </div>
        <DockZone zone="right" />
      </div>
      <FloatingGroups />
      <FloatManager />
      <DragGhost />
      <ExportDialog />
      <OptionsDialog />
      <ModelSettingsDialog />
      <AboutDialog />
      <ReverseDialog />
      <ShareDialog />
      <CollabBridge />
      <DialogHost />
      <ContextMenuLayer />
      <TooltipLayer />
      <footer className="flex h-6 flex-none items-center gap-3 border-t border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
        <span>
          {title}
          {dirty && ` — ${t("app.modified")}`}
        </span>
        {status && <span className={status.kind === "error" ? "text-red-600" : ""}>{status.text}</span>}
        <div className="ml-auto flex items-center gap-3">
          <SelectionStatus />
          <IssuesStatus />
          <ZoomStatus />
          <CollabIndicator />
          <McpIndicator />
          <DbmsTarget />
        </div>
      </footer>
    </div>
  );
}

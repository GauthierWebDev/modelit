import { useEffect } from "react";
import { APP_NAME } from "@/app/appInfo";
import { startAutosave } from "@/app/autosave";
import { DocumentProvider, useDocument, useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import { selectIsDirty } from "@/app/document/documentStore";
import { closeDocument, confirmLoseAllChanges, documentName } from "@/app/fileCommands";
import { useUiStore } from "@/app/uiStore";
import { scheduleUpdateCheck, showWhatsNew } from "@/app/updates";
import { activeDocument, useActiveDocument, useWorkspaceStore } from "@/app/workspace";
import { t } from "@/i18n";
import { closeAllFloats, nativeWindows } from "@/platform/floatWindows";
import { onCloseRequested, onMenuAbout, onMenuCloseTab, setWindowTitle } from "@/platform/window";
import { FloatManager } from "./windows/FloatManager";
import { McpBridge } from "./mcp/McpBridge";
import { McpIndicator } from "./mcp/McpIndicator";
import { AboutDialog } from "./about/AboutDialog";
import { LogicalCanvas } from "./canvas/LogicalCanvas";
import { McdCanvas } from "./canvas/McdCanvas";
import { DialogHost } from "./common/DialogHost";
import { TooltipLayer } from "./common/Tooltip";
import { ExportDialog } from "./export/ExportDialog";
import { OptionsDialog } from "./options/OptionsDialog";
import { ReverseDialog } from "./reverse/ReverseDialog";
import { TabBar } from "./tabs/TabBar";
import { DockZone, DragGhost, FloatingGroups } from "./dock/Dock";
import { useShortcuts } from "./shortcuts";
import { useApplyTheme } from "./theme";
import { ToolbarHost } from "./toolbar/ToolbarHost";

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
  useEffect(() => scheduleUpdateCheck(), []);
  useEffect(() => showWhatsNew(), []);
  useEffect(() => onMenuAbout(() => useUiStore.getState().setAbout("about")), []);
  useEffect(() => onMenuCloseTab(() => void closeDocument(activeDocument())), []);

  useEffect(
    () =>
      onCloseRequested(async () => {
        const ok = await confirmLoseAllChanges();
        // Les fenêtres flottantes se ferment avec la principale (O-45, O-46).
        if (ok && nativeWindows()) await closeAllFloats();
        return ok;
      }, anyDocumentDirty),
    [],
  );

  useEffect(() => {
    if (!status) return;
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
          <div className="min-h-0 flex-1">
            {view === "mcd" ? <McdCanvas /> : <LogicalCanvas key={view} mode={view} />}
          </div>
          <DockZone zone="bottom" />
        </div>
        <DockZone zone="right" />
      </div>
      <FloatingGroups />
      <FloatManager />
      <McpBridge />
      <DragGhost />
      <ExportDialog />
      <OptionsDialog />
      <AboutDialog />
      <ReverseDialog />
      <DialogHost />
      <TooltipLayer />
      <footer className="flex h-6 flex-none items-center gap-3 border-t border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
        <span>
          {title}
          {dirty && ` — ${t("app.modified")}`}
        </span>
        {status && <span className={status.kind === "error" ? "text-red-600" : ""}>{status.text}</span>}
        <McpIndicator />
      </footer>
    </div>
  );
}

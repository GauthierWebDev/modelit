import { useEffect } from "react";
import { APP_NAME } from "@/app/appInfo";
import { startAutosave } from "@/app/autosave";
import { DocumentProvider, useDocument, useDocumentView } from "@/app/document/DocumentContext";
import { selectIsDirty } from "@/app/document/documentStore";
import { confirmLoseAllChanges, fileName } from "@/app/fileCommands";
import { useUiStore } from "@/app/uiStore";
import { scheduleUpdateCheck, showWhatsNew } from "@/app/updates";
import { useActiveDocument, useWorkspaceStore } from "@/app/workspace";
import { t } from "@/i18n";
import { onCloseRequested, onMenuAbout, setWindowTitle } from "@/platform/window";
import { AboutDialog } from "./about/AboutDialog";
import { LogicalCanvas } from "./canvas/LogicalCanvas";
import { McdCanvas } from "./canvas/McdCanvas";
import { DialogHost } from "./common/DialogHost";
import { TooltipLayer } from "./common/Tooltip";
import { ExportDialog } from "./export/ExportDialog";
import { OptionsDialog } from "./options/OptionsDialog";
import { ReverseDialog } from "./reverse/ReverseDialog";
import { Inspector } from "./panels/Inspector";
import { OutputPanel } from "./panels/OutputPanel";
import { useShortcuts } from "./shortcuts";
import { useApplyTheme } from "./theme";
import { Toolbar } from "./toolbar/Toolbar";

const anyDocumentDirty = () => useWorkspaceStore.getState().documents.some((d) => selectIsDirty(d.store.getState()));

/** Fenêtre : fournit le document actif à toute l'interface (docs/jalons/J-01, phase 1). */
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
  const view = useDocumentView((s) => s.view);
  const filePath = useDocument((s) => s.filePath);
  const dirty = useDocument(selectIsDirty);
  const recovered = useDocument((s) => s.recovered);
  const title = `${fileName(filePath)}${recovered ? ` ${t("app.recovered")}` : ""}`;
  const status = useUiStore((s) => s.status);
  const notify = useUiStore((s) => s.notify);

  useEffect(() => {
    void setWindowTitle(`${dirty ? "• " : ""}${title} — ${APP_NAME}`);
  }, [title, dirty]);

  useEffect(() => startAutosave(), []);
  useEffect(() => scheduleUpdateCheck(), []);
  useEffect(() => showWhatsNew(), []);
  useEffect(() => onMenuAbout(() => useUiStore.getState().setAbout("about")), []);

  useEffect(() => onCloseRequested(confirmLoseAllChanges, anyDocumentDirty), []);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => notify(null), 3000);
    return () => clearTimeout(timer);
  }, [status, notify]);

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {view === "mcd" ? <McdCanvas /> : <LogicalCanvas key={view} mode={view} />}
          </div>
          <div className="h-56 flex-none border-t border-neutral-200 dark:border-neutral-700">
            <OutputPanel />
          </div>
        </div>
        <aside className="w-80 flex-none border-l border-neutral-200 dark:border-neutral-700">
          <Inspector />
        </aside>
      </div>
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
      </footer>
    </div>
  );
}

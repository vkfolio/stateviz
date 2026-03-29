import * as vscode from "vscode";
import { StateVizPanel } from "./sidebar";

export function activate(context: vscode.ExtensionContext): void {
  const panel = new StateVizPanel(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("stateviz.refresh", async () => {
      await panel.refresh();
    }),
    vscode.commands.registerCommand("stateviz.openPreview", async () => {
      await panel.show();
    }),
    vscode.commands.registerCommand("stateviz.reveal", async () => {
      await panel.show();
    }),
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (!editor) {
        return;
      }
      const changed = panel.captureEditorContext(editor);
      if (changed || editor.document.languageId !== "python") {
        await panel.refresh();
      }
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (panel.shouldRefreshForDocument(document)) {
        await panel.refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("stateviz.marker")) {
        await panel.refresh();
      }
    }),
  );
}

export function deactivate(): void {}

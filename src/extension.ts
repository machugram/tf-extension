import * as vscode from "vscode";
import { getSettings } from "./config";
import { checkoutIfNeeded, registerCommands, TfvcHost } from "./commands";
import { log } from "./output";
import { registerContentProvider } from "./scm/contentProvider";
import { TfvcSourceControl } from "./scm/provider";
import { TfvcStatusBar } from "./statusBar";
import { createClient, TfClient } from "./tf/client";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const host = new TfvcExtension(context);
  context.subscriptions.push(host);
  await host.activateClient();
}

export function deactivate(): void {
  // Disposables are registered on the extension context.
}

class TfvcExtension implements vscode.Disposable, TfvcHost {
  private client: TfClient | undefined;
  private scm: TfvcSourceControl | undefined;
  private readonly statusBar: TfvcStatusBar;
  private readonly checkingOut = new Set<string>();
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(readonly context: vscode.ExtensionContext) {
    this.statusBar = new TfvcStatusBar(() => this.scm);
    context.subscriptions.push(
      ...registerCommands(this),
      registerContentProvider(() => this.client),
      this.statusBar,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("tfvc")) {
          void this.activateClient();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.scheme === "file" && getSettings().refreshOnSave) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        void this.maybeCheckout(event);
      }),
    );
    this.watchWorkspace();
  }

  getClient(): TfClient | undefined {
    return this.client;
  }

  getScm(): TfvcSourceControl | undefined {
    return this.scm;
  }

  async activateClient(): Promise<TfClient | undefined> {
    try {
      const next = await createClient(this.context.secrets);
      this.client = next;
      await vscode.commands.executeCommand("setContext", "tfvc.active", Boolean(next));
      if (!next) {
        this.scm?.dispose();
        this.scm = undefined;
        this.statusBar.refresh();
        return undefined;
      }
      if (this.scm) {
        this.scm.setClient(next);
      } else {
        this.scm = new TfvcSourceControl(next);
        this.context.subscriptions.push(this.scm);
      }
      await this.refresh();
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Activation failed: ${message}`);
      await vscode.commands.executeCommand("setContext", "tfvc.active", false);
      this.statusBar.refresh();
      if (/access denied|authenticat|unauthorized|login/i.test(message)) {
        const choice = await vscode.window.showErrorMessage(
          `TFVC authentication failed: ${message}`,
          "Sign In",
        );
        if (choice) {
          await vscode.commands.executeCommand("tfvc.signIn");
        }
      }
      return undefined;
    }
  }

  async refresh(): Promise<void> {
    if (!this.scm) {
      this.statusBar.refresh();
      return;
    }
    try {
      await this.scm.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Refresh failed: ${message}`);
      void vscode.window.setStatusBarMessage(`TFVC refresh failed: ${message}`, 5000);
    }
    this.statusBar.refresh();
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.scm?.dispose();
    this.statusBar.dispose();
  }

  private watchWorkspace(): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const bump = (uri: vscode.Uri) => {
      if (shouldIgnore(uri.fsPath)) {
        return;
      }
      this.scheduleRefresh();
    };
    this.context.subscriptions.push(
      watcher,
      watcher.onDidCreate(bump),
      watcher.onDidChange(bump),
      watcher.onDidDelete(bump),
    );
  }

  private scheduleRefresh(): void {
    if (!this.scm) {
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 750);
  }

  private async maybeCheckout(event: vscode.TextDocumentChangeEvent): Promise<void> {
    const document = event.document;
    if (!this.client || document.uri.scheme !== "file" || document.isUntitled) {
      return;
    }
    if (event.contentChanges.length === 0) {
      return;
    }
    const filePath = document.uri.fsPath;
    if (this.checkingOut.has(filePath) || shouldIgnore(filePath)) {
      return;
    }
    this.checkingOut.add(filePath);
    try {
      await checkoutIfNeeded(this, filePath);
    } catch (error) {
      log(`Auto-checkout failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.checkingOut.delete(filePath);
    }
  }
}

function shouldIgnore(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.some((part) => part === ".tf" || part === "$tf" || part === ".git" || part === "node_modules");
}

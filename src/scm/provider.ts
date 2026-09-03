import * as vscode from "vscode";
import { TfClient } from "../tf/client";
import { log } from "../output";
import { TfvcModel } from "./model";
import { toTfvcUri, TfvcResource } from "./resource";

export class TfvcSourceControl implements vscode.Disposable, vscode.QuickDiffProvider {
  readonly sourceControl: vscode.SourceControl;
  readonly model = new TfvcModel();
  private readonly conflicts: vscode.SourceControlResourceGroup;
  private readonly included: vscode.SourceControlResourceGroup;
  private readonly excluded: vscode.SourceControlResourceGroup;
  private readonly disposable: vscode.Disposable[] = [];
  private refreshing = false;

  constructor(private client: TfClient) {
    this.sourceControl = vscode.scm.createSourceControl("tfvc", "TFVC", vscode.Uri.file(client.root));
    this.sourceControl.quickDiffProvider = this;
    this.sourceControl.acceptInputCommand = { command: "tfvc.checkin", title: "Check In" };
    this.sourceControl.inputBox.placeholder = "Check-in comment. Use #123 to associate work items.";
    this.conflicts = this.sourceControl.createResourceGroup("conflicts", "Conflicts");
    this.included = this.sourceControl.createResourceGroup("included", "Included Changes");
    this.excluded = this.sourceControl.createResourceGroup("excluded", "Excluded Changes");
    this.conflicts.hideWhenEmpty = true;
    this.included.hideWhenEmpty = false;
    this.excluded.hideWhenEmpty = true;

    this.disposable.push(
      this.sourceControl,
      this.model.onDidChange(() => this.render()),
    );
  }

  get current(): TfClient {
    return this.client;
  }

  setClient(client: TfClient): void {
    this.client = client;
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    this.sourceControl.statusBarCommands = [
      {
        command: "tfvc.refresh",
        title: "$(sync~spin) TFVC",
        tooltip: "Refreshing pending changes",
      },
    ];
    try {
      const changes = await this.client.status();
      this.model.apply(changes);
      log(`Status: ${changes.length} pending change(s)`);
    } finally {
      this.refreshing = false;
      this.render();
    }
  }

  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (uri.scheme !== "file") {
      return undefined;
    }
    return toTfvcUri(uri.fsPath, "W");
  }

  includedPaths(): string[] {
    return this.model.included.map((resource) => resource.change.localItem).filter(Boolean);
  }

  dispose(): void {
    for (const item of this.disposable) {
      item.dispose();
    }
  }

  private render(): void {
    this.conflicts.resourceStates = this.model.conflicts;
    this.included.resourceStates = this.model.included;
    this.excluded.resourceStates = this.model.detected;
    this.sourceControl.count = this.model.conflicts.length + this.model.included.length;
    const name = this.client.workspace.name;
    this.sourceControl.statusBarCommands = [
      {
        command: "tfvc.workspaceInfo",
        title: `$(database) ${name}`,
        tooltip: `${name} — ${this.client.workspace.collection}`,
      },
    ];
    void vscode.commands.executeCommand(
      "setContext",
      "tfvc.hasChanges",
      this.sourceControl.count > 0,
    );
  }
}

export function asResources(args: unknown[]): TfvcResource[] {
  const collected: TfvcResource[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      collected.push(...asResources(arg));
    } else if (arg instanceof TfvcResource) {
      collected.push(arg);
    }
  }
  return uniqueResources(collected);
}

function uniqueResources(resources: TfvcResource[]): TfvcResource[] {
  const seen = new Set<string>();
  const result: TfvcResource[] = [];
  for (const resource of resources) {
    const key = resource.change.localItem || resource.change.serverItem;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(resource);
  }
  return result;
}

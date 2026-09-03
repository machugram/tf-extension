import * as path from "path";
import * as vscode from "vscode";
import { primaryChangeType } from "../tf/parseStatus";
import { ChangeKind, PendingChange } from "../types";

export const TFVC_SCHEME = "tfvc";

export class TfvcResource implements vscode.SourceControlResourceState {
  constructor(
    readonly change: PendingChange,
    readonly groupId: "conflicts" | "included" | "excluded",
  ) {}

  get resourceUri(): vscode.Uri {
    return vscode.Uri.file(this.change.localItem || this.change.serverItem);
  }

  get command(): vscode.Command {
    return {
      command: this.groupId === "excluded" ? "tfvc.openFile" : "tfvc.openDiff",
      title: "Open",
      arguments: [this],
    };
  }

  get decorations(): vscode.SourceControlResourceDecorations {
    const kind = primaryChangeType(this.change);
    return {
      strikeThrough: kind === "delete",
      faded: this.change.isCandidate,
      tooltip: this.tooltip,
      iconPath: iconFor(kind),
    };
  }

  get tooltip(): string {
    const kind = this.change.changeTypes.join(", ");
    const server = this.change.serverItem || path.basename(this.change.localItem);
    return `${server} (${kind})`;
  }

  get letter(): string {
    return letterFor(primaryChangeType(this.change));
  }
}

export function toTfvcUri(fsPath: string, version = "W"): vscode.Uri {
  return vscode.Uri.file(fsPath).with({
    scheme: TFVC_SCHEME,
    query: `version=${encodeURIComponent(version)}`,
  });
}

function iconFor(kind: ChangeKind): vscode.ThemeIcon {
  switch (kind) {
    case "add":
      return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
    case "delete":
      return new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("gitDecoration.deletedResourceForeground"));
    case "rename":
      return new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground"));
    case "conflict":
      return new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
    default:
      return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
  }
}

function letterFor(kind: ChangeKind): string {
  switch (kind) {
    case "add":
      return "A";
    case "delete":
      return "D";
    case "rename":
      return "R";
    case "conflict":
      return "C";
    case "edit":
      return "M";
    default:
      return kind.charAt(0).toUpperCase();
  }
}

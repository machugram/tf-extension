import * as vscode from "vscode";
import { TfvcSourceControl } from "./scm/provider";

export class TfvcStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposable: vscode.Disposable[] = [];

  constructor(private readonly getScm: () => TfvcSourceControl | undefined) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    this.item.command = "tfvc.workspaceInfo";
    this.disposable.push(this.item);
  }

  refresh(): void {
    const scm = this.getScm();
    if (!scm) {
      this.item.hide();
      return;
    }
    const count = scm.sourceControl.count ?? 0;
    const name = scm.current.workspace.name;
    this.item.text = count > 0 ? `$(database) ${name} • ${count}` : `$(database) ${name}`;
    this.item.tooltip = `${name}\n${scm.current.workspace.collection}\n${count} included change(s)`;
    this.item.show();
  }

  dispose(): void {
    for (const item of this.disposable) {
      item.dispose();
    }
  }
}

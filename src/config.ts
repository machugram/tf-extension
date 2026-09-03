import * as vscode from "vscode";

export interface TfvcSettings {
  path: string;
  collection: string;
  login: string;
  autoCheckout: boolean;
  restrictToWorkspaceFolder: boolean;
  refreshOnSave: boolean;
}

export function getSettings(): TfvcSettings {
  const config = vscode.workspace.getConfiguration("tfvc");
  return {
    path: config.get<string>("path", "").trim(),
    collection: config.get<string>("collection", "").trim(),
    login: config.get<string>("login", "").trim(),
    autoCheckout: config.get<boolean>("autoCheckout", true),
    restrictToWorkspaceFolder: config.get<boolean>("restrictToWorkspaceFolder", true),
    refreshOnSave: config.get<boolean>("refreshOnSave", true),
  };
}

export async function setTfPath(tfPath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("tfvc");
  await config.update("path", tfPath, vscode.ConfigurationTarget.Workspace);
}

export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

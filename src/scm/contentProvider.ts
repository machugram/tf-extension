import * as vscode from "vscode";
import { TfClient } from "../tf/client";
import { TFVC_SCHEME } from "./resource";

export class TfvcContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly getClient: () => TfClient | undefined) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const client = this.getClient();
    if (!client) {
      return "";
    }
    const version = new URLSearchParams(uri.query).get("version") ?? undefined;
    try {
      return await client.view(uri.fsPath, version ?? undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to load TFVC content: ${message}`);
    }
  }
}

export function registerContentProvider(getClient: () => TfClient | undefined): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(TFVC_SCHEME, new TfvcContentProvider(getClient));
}

import * as vscode from "vscode";

const CHANNEL_NAME = "TFVC";

let channel: vscode.OutputChannel | undefined;

export function getOutput(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

export function log(message: string): void {
  const stamp = new Date().toISOString();
  getOutput().appendLine(`[${stamp}] ${message}`);
}

export function logBlock(title: string, body: string): void {
  log(title);
  if (body.trim()) {
    getOutput().appendLine(body.trimEnd());
  }
}

export function showOutput(): void {
  getOutput().show(true);
}

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getSettings, setTfPath } from "./config";
import { log, showOutput } from "./output";
import { asResources, TfvcSourceControl } from "./scm/provider";
import { toTfvcUri, TfvcResource } from "./scm/resource";
import { workItemIds } from "./tf/args";
import { SECRET_PASSWORD, TfClient } from "./tf/client";
import { locateTf } from "./tf/locator";
import { TfError } from "./types";

export interface TfvcHost {
  context: vscode.ExtensionContext;
  getClient(): TfClient | undefined;
  getScm(): TfvcSourceControl | undefined;
  activateClient(): Promise<TfClient | undefined>;
  refresh(): Promise<void>;
}

export function registerCommands(host: TfvcHost): vscode.Disposable[] {
  const wrap = (fn: (...args: unknown[]) => Promise<void>) => {
    return async (...args: unknown[]) => {
      try {
        await fn(...args);
      } catch (error) {
        await showError(host, error);
      }
    };
  };

  return [
    vscode.commands.registerCommand("tfvc.getLatest", wrap(async () => {
      const client = await requireClient(host);
      await runProgress("TFVC: Get Latest", () => client.get());
      await host.refresh();
      void vscode.window.showInformationMessage("Get latest completed.");
    })),
    vscode.commands.registerCommand("tfvc.getLatestFile", wrap(async (...args) => {
      const client = await requireClient(host);
      const paths = collectPaths(host, args);
      await runProgress("TFVC: Get Latest", () => client.get(paths, true));
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.checkout", wrap(async (...args) => {
      const client = await requireClient(host);
      const paths = collectPaths(host, args);
      await runProgress("TFVC: Check Out", () => client.checkout(paths));
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.checkin", wrap(async () => {
      const client = await requireClient(host);
      const scm = host.getScm();
      const paths = scm?.includedPaths() ?? [];
      if (paths.length === 0) {
        void vscode.window.showWarningMessage("There are no included TFVC changes to check in.");
        return;
      }
      const comment = scm?.sourceControl.inputBox.value ?? "";
      if (!comment.trim()) {
        const typed = await vscode.window.showInputBox({
          prompt: "Check-in comment",
          placeHolder: "Describe the change. Use #123 to associate work items.",
        });
        if (typed === undefined) {
          return;
        }
        await runCheckin(host, client, paths, typed);
        return;
      }
      await runCheckin(host, client, paths, comment);
    })),
    vscode.commands.registerCommand("tfvc.add", wrap(async (...args) => {
      const client = await requireClient(host);
      const resources = asResources(args);
      const paths = resources.length > 0 ? resources.map((r) => r.change.localItem) : collectPaths(host, args);
      await runProgress("TFVC: Add", () => client.add(paths));
      host.getScm()?.model.include(resources);
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.undo", wrap(async (...args) => {
      const client = await requireClient(host);
      const paths = collectPaths(host, args);
      const confirmed = await confirm(`Undo pending changes on ${paths.length} item(s)?`);
      if (!confirmed) {
        return;
      }
      await runProgress("TFVC: Undo", () => client.undo(paths));
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.delete", wrap(async (...args) => {
      const client = await requireClient(host);
      const paths = collectPaths(host, args);
      const confirmed = await confirm(`Delete ${paths.length} item(s) from TFVC?`);
      if (!confirmed) {
        return;
      }
      await runProgress("TFVC: Delete", () => client.delete(paths));
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.rename", wrap(async (...args) => {
      const client = await requireClient(host);
      const source = collectPaths(host, args)[0];
      const next = await vscode.window.showInputBox({
        prompt: "New file name or path",
        value: path.basename(source),
      });
      if (!next) {
        return;
      }
      const destination = path.isAbsolute(next) ? next : path.join(path.dirname(source), next);
      await runProgress("TFVC: Rename", () => client.rename(source, destination));
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.refresh", wrap(async () => {
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.history", wrap(async (...args) => {
      const client = await requireClient(host);
      const filePath = collectPaths(host, args)[0];
      const entries = await runProgress("TFVC: History", () => client.history(filePath));
      if (entries.length === 0) {
        void vscode.window.showInformationMessage("No history found.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
          label: `C${entry.changeset}`,
          description: entry.user,
          detail: [entry.date, entry.comment].filter(Boolean).join(" — "),
          entry,
        })),
        { placeHolder: `History for ${path.basename(filePath)}` },
      );
      if (!picked) {
        return;
      }
      const body = [
        `Changeset: ${picked.entry.changeset}`,
        `User: ${picked.entry.user}`,
        `Date: ${picked.entry.date}`,
        "",
        "Comment:",
        picked.entry.comment || "(none)",
        "",
        "Items:",
        ...picked.entry.items,
      ].join("\n");
      const doc = await vscode.workspace.openTextDocument({ content: body, language: "text" });
      await vscode.window.showTextDocument(doc, { preview: true });
    })),
    vscode.commands.registerCommand("tfvc.diff", wrap(async (...args) => {
      await openDiff(host, collectPaths(host, args)[0]);
    })),
    vscode.commands.registerCommand("tfvc.openFile", wrap(async (...args) => {
      const resource = asResources(args)[0];
      const filePath = resource?.change.localItem ?? collectPaths(host, args)[0];
      const uri = vscode.Uri.file(filePath);
      await vscode.window.showTextDocument(uri, { preview: true });
    })),
    vscode.commands.registerCommand("tfvc.openDiff", wrap(async (...args) => {
      const resource = asResources(args)[0];
      const filePath = resource?.change.localItem ?? collectPaths(host, args)[0];
      await openDiff(host, filePath, resource);
    })),
    vscode.commands.registerCommand("tfvc.include", wrap(async (...args) => {
      const scm = requireScm(host);
      const resources = asResources(args);
      scm.model.include(resources);
      const candidates = resources.filter((resource) => resource.change.isCandidate);
      if (candidates.length > 0) {
        const client = await requireClient(host);
        await client.add(candidates.map((resource) => resource.change.localItem));
        await host.refresh();
      }
    })),
    vscode.commands.registerCommand("tfvc.exclude", wrap(async (...args) => {
      requireScm(host).model.exclude(asResources(args));
    })),
    vscode.commands.registerCommand("tfvc.includeAll", wrap(async () => {
      const scm = requireScm(host);
      const candidates = scm.model.detected.filter((resource) => resource.change.isCandidate);
      scm.model.includeAll();
      if (candidates.length > 0) {
        const client = await requireClient(host);
        await client.add(candidates.map((resource) => resource.change.localItem));
        await host.refresh();
      }
    })),
    vscode.commands.registerCommand("tfvc.excludeAll", wrap(async () => {
      requireScm(host).model.excludeAll();
    })),
    vscode.commands.registerCommand("tfvc.shelve", wrap(async () => {
      const client = await requireClient(host);
      const scm = requireScm(host);
      const paths = scm.includedPaths();
      if (paths.length === 0) {
        void vscode.window.showWarningMessage("There are no included changes to shelve.");
        return;
      }
      const name = await vscode.window.showInputBox({ prompt: "Shelveset name" });
      if (!name) {
        return;
      }
      const comment = scm.sourceControl.inputBox.value;
      await runProgress("TFVC: Shelve", () => client.shelve(name, paths, comment));
      void vscode.window.showInformationMessage(`Shelved ${paths.length} change(s) as ${name}.`);
    })),
    vscode.commands.registerCommand("tfvc.unshelve", wrap(async () => {
      const client = await requireClient(host);
      const sets = await runProgress("TFVC: Shelvesets", () => client.shelvesets());
      if (sets.length === 0) {
        void vscode.window.showInformationMessage("No shelvesets found.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        sets.map((set) => ({
          label: set.name,
          description: set.owner,
          detail: [set.date, set.comment].filter(Boolean).join(" — "),
          set,
        })),
        { placeHolder: "Select a shelveset to unshelve" },
      );
      if (!picked) {
        return;
      }
      await runProgress("TFVC: Unshelve", () => client.unshelve(picked.set.name, picked.set.owner || undefined));
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.showOutput", () => {
      showOutput();
    }),
    vscode.commands.registerCommand("tfvc.chooseTfPath", wrap(async () => {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        title: "Select tf.exe or the TEE tf script",
      });
      if (!selected?.[0]) {
        return;
      }
      await setTfPath(selected[0].fsPath);
      await host.activateClient();
    })),
    vscode.commands.registerCommand("tfvc.signIn", wrap(async () => {
      const username = await vscode.window.showInputBox({
        prompt: "TFVC username",
        value: getSettings().login,
      });
      if (!username) {
        return;
      }
      const password = await vscode.window.showInputBox({
        prompt: "Password or personal access token",
        password: true,
      });
      if (password === undefined) {
        return;
      }
      await vscode.workspace.getConfiguration("tfvc").update("login", username, vscode.ConfigurationTarget.Workspace);
      await host.context.secrets.store(SECRET_PASSWORD, password);
      await host.activateClient();
      void vscode.window.showInformationMessage("TFVC credentials saved for this workspace.");
    })),
    vscode.commands.registerCommand("tfvc.workspaceInfo", wrap(async () => {
      const client = await requireClient(host);
      const mappings = client.workspace.mappings
        .map((mapping) =>
          mapping.cloaked
            ? `(cloaked) ${mapping.serverPath}`
            : `${mapping.serverPath} → ${mapping.localPath ?? ""}`,
        )
        .join("\n");
      const body = [
        `tf: ${client.located.path} (${client.located.flavor})`,
        `Workspace: ${client.workspace.name}`,
        `Collection: ${client.workspace.collection}`,
        `Team project: ${client.workspace.teamProject}`,
        "",
        "Mappings:",
        mappings,
      ].join("\n");
      const doc = await vscode.workspace.openTextDocument({ content: body, language: "text" });
      await vscode.window.showTextDocument(doc, { preview: true });
    })),
    vscode.commands.registerCommand("tfvc.resolveKeepYours", wrap(async (...args) => {
      const client = await requireClient(host);
      const paths = collectPaths(host, args);
      await client.resolve(paths, "KeepYours");
      await host.refresh();
    })),
    vscode.commands.registerCommand("tfvc.resolveTakeTheirs", wrap(async (...args) => {
      const client = await requireClient(host);
      const paths = collectPaths(host, args);
      await client.resolve(paths, "TakeTheirs");
      await host.refresh();
    })),
  ];
}

export async function checkoutIfNeeded(host: TfvcHost, filePath: string): Promise<boolean> {
  if (!getSettings().autoCheckout) {
    return false;
  }
  const client = host.getClient();
  if (!client) {
    return false;
  }
  try {
    await fs.access(filePath, fs.constants.W_OK);
    return false;
  } catch {
    log(`Auto-checkout ${filePath}`);
    await client.checkout([filePath]);
    await host.refresh();
    return true;
  }
}

async function runCheckin(host: TfvcHost, client: TfClient, paths: string[], comment: string): Promise<void> {
  const ids = workItemIds(comment);
  const changeset = await runProgress("TFVC: Check In", () => client.checkin(paths, comment, ids));
  const scm = host.getScm();
  if (scm) {
    scm.sourceControl.inputBox.value = "";
  }
  await host.refresh();
  void vscode.window.showInformationMessage(
    changeset ? `Checked in changeset ${changeset}.` : "Check-in completed.",
  );
}

async function openDiff(host: TfvcHost, filePath: string, resource?: TfvcResource): Promise<void> {
  await requireClient(host);
  const right = vscode.Uri.file(filePath);
  const left = toTfvcUri(filePath, "W");
  const title = `${path.basename(filePath)} (Workspace) ↔ ${path.basename(filePath)}`;
  if (resource?.change.changeTypes.includes("delete")) {
    await vscode.commands.executeCommand("vscode.diff", left, right.with({ scheme: "file" }), title);
    return;
  }
  await vscode.commands.executeCommand("vscode.diff", left, right, title);
}

function collectPaths(host: TfvcHost, args: unknown[]): string[] {
  const fromResources = asResources(args)
    .map((resource) => resource.change.localItem)
    .filter(Boolean);
  if (fromResources.length > 0) {
    return unique(fromResources);
  }
  const uris = collectUris(args);
  if (uris.length > 0) {
    return unique(uris.map((uri) => uri.fsPath));
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") {
    return [active.fsPath];
  }
  const root = host.getClient()?.root;
  if (root) {
    return [root];
  }
  throw new Error("Select a file in the explorer, editor, or Source Control view.");
}

function collectUris(args: unknown[]): vscode.Uri[] {
  const uris: vscode.Uri[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      uris.push(...collectUris(arg));
    } else if (arg instanceof vscode.Uri) {
      uris.push(arg);
    } else if (arg && typeof arg === "object" && "resourceUri" in arg) {
      const uri = (arg as { resourceUri?: vscode.Uri }).resourceUri;
      if (uri) {
        uris.push(uri);
      }
    }
  }
  return uris;
}

async function requireClient(host: TfvcHost): Promise<TfClient> {
  const existing = host.getClient() ?? (await host.activateClient());
  if (existing) {
    return existing;
  }
  const located = await locateTf(getSettings().path);
  if (!located) {
    const choice = await vscode.window.showErrorMessage(
      "tf.exe was not found. Install Visual Studio Team Explorer, TEE CLC, or set the path.",
      "Choose tf.exe",
    );
    if (choice) {
      await vscode.commands.executeCommand("tfvc.chooseTfPath");
    }
    throw new Error("tf.exe was not found.");
  }
  throw new Error("This folder is not mapped to a TFVC workspace. Open a mapped folder or run tf workfold.");
}

function requireScm(host: TfvcHost): TfvcSourceControl {
  const scm = host.getScm();
  if (!scm) {
    throw new Error("TFVC source control is not active.");
  }
  return scm;
}

async function runProgress<T>(title: string, fn: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.SourceControl, title },
    fn,
  );
}

async function confirm(message: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Continue");
  return choice === "Continue";
}

async function showError(host: TfvcHost, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  log(`Error: ${message}`);
  if (error instanceof TfError) {
    showOutput();
  }
  if (/access denied|authenticat|unauthorized|login/i.test(message)) {
    const choice = await vscode.window.showErrorMessage(message, "Sign In", "Show Output");
    if (choice === "Sign In") {
      await vscode.commands.executeCommand("tfvc.signIn");
    } else if (choice === "Show Output") {
      showOutput();
    }
    return;
  }
  const choice = await vscode.window.showErrorMessage(message, "Show Output");
  if (choice) {
    showOutput();
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

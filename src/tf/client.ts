import { getSettings, workspaceRoot } from "../config";
import { log } from "../output";
import {
  HistoryEntry,
  PendingChange,
  RunResult,
  Shelveset,
  TfError,
  TfWorkspace,
} from "../types";
import { locateTf, LocatedTf } from "./locator";
import { parseChangesetNumber, parseHistory, parseShelvesets } from "./parseHistory";
import { parseStatus } from "./parseStatus";
import { localPathIsInside, parseWorkfold } from "./parseWorkfold";
import { TfRunner } from "./runner";

const SECRET_PASSWORD = "tfvc.password";

export interface ClientContext {
  secrets: { get(key: string): Thenable<string | undefined> };
}

export class TfClient {
  constructor(
    readonly located: LocatedTf,
    readonly runner: TfRunner,
    readonly workspace: TfWorkspace,
    readonly root: string,
  ) {}

  async status(paths?: string[]): Promise<PendingChange[]> {
    const itemspec = paths && paths.length > 0 ? paths : this.defaultItemspec();
    const format = this.runner.flavor === "clc" ? "xml" : "detailed";
    const args = this.runner.args("status", [
      this.runner.flag("format", format),
      this.runner.flag("recursive"),
      ...itemspec,
    ]);
    const result = await this.runner.runOk(args);
    return parseStatus(result.stdout);
  }

  async get(paths?: string[], recursive = true): Promise<string> {
    const itemspec = paths && paths.length > 0 ? paths : this.defaultItemspec();
    const extra = [this.runner.flag("noprompt")];
    if (recursive) {
      extra.push(this.runner.flag("recursive"));
    }
    extra.push(...itemspec);
    const result = await this.runner.runOk(this.runner.args("get", extra), { timeoutMs: 300_000 });
    return result.stdout.trim();
  }

  async checkout(paths: string[]): Promise<void> {
    await this.runner.runOk(
      this.runner.args("checkout", [this.runner.flag("noprompt"), ...requirePaths(paths)]),
    );
  }

  async add(paths: string[]): Promise<void> {
    await this.runner.runOk(this.runner.args("add", [this.runner.flag("noprompt"), ...requirePaths(paths)]));
  }

  async undo(paths: string[]): Promise<void> {
    await this.runner.runOk(
      this.runner.args("undo", [this.runner.flag("noprompt"), ...requirePaths(paths)]),
    );
  }

  async delete(paths: string[]): Promise<void> {
    await this.runner.runOk(
      this.runner.args("delete", [this.runner.flag("noprompt"), ...requirePaths(paths)]),
    );
  }

  async rename(source: string, destination: string): Promise<void> {
    await this.runner.runOk(this.runner.args("rename", [this.runner.flag("noprompt"), source, destination]));
  }

  async checkin(paths: string[], comment: string, workItemIds: number[] = []): Promise<string | undefined> {
    const extra = [this.runner.flag("noprompt"), ...requirePaths(paths)];
    if (comment.trim()) {
      extra.push(this.runner.flag("comment", flattenComment(comment)));
    }
    if (workItemIds.length > 0 && this.runner.flavor === "clc") {
      extra.push(this.runner.flag("associate", workItemIds.join(",")));
    }
    const result = await this.runner.run(this.runner.args("checkin", extra, { skipCollection: this.runner.flavor === "exe" }));
    if (result.exitCode !== 0) {
      throw this.runner.toError(this.runner.args("checkin"), result);
    }
    return parseChangesetNumber(result.stdout);
  }

  async history(path: string, stopAfter = 50): Promise<HistoryEntry[]> {
    const extra = [
      this.runner.flag("noprompt"),
      this.runner.flag("format", "detailed"),
      this.runner.flag("stopafter", String(stopAfter)),
      path,
    ];
    const result = await this.runner.runOk(this.runner.args("history", extra));
    return parseHistory(result.stdout);
  }

  async view(path: string, version?: string): Promise<string> {
    const command = this.runner.flavor === "exe" ? "view" : "print";
    const extra = [this.runner.flag("noprompt")];
    if (this.runner.flavor === "exe") {
      extra.push(this.runner.flag("console"));
    }
    if (version) {
      extra.push(this.runner.flag("version", version));
    }
    extra.push(path);
    const result = await this.runner.run(this.runner.args(command, extra), {
      acceptExit: (code) => code === 0,
    });
    if (result.exitCode !== 0) {
      if (isMissingVersion(result)) {
        return "";
      }
      throw this.runner.toError(this.runner.args(command), result);
    }
    return stripWarnings(result.stdout);
  }

  async shelve(name: string, paths: string[], comment: string, replace = true): Promise<void> {
    const extra = [name, this.runner.flag("noprompt")];
    if (replace) {
      extra.push(this.runner.flag("replace"));
    }
    if (comment.trim()) {
      extra.push(this.runner.flag("comment", flattenComment(comment)));
    }
    extra.push(...requirePaths(paths));
    await this.runner.runOk(this.runner.args("shelve", extra));
  }

  async shelvesets(): Promise<Shelveset[]> {
    const result = await this.runner.runOk(
      this.runner.args("shelvesets", [this.runner.flag("format", "detailed")]),
    );
    return parseShelvesets(result.stdout);
  }

  async unshelve(name: string, owner?: string): Promise<void> {
    const spec = owner ? `${name};${owner}` : name;
    await this.runner.runOk(this.runner.args("unshelve", [spec, this.runner.flag("noprompt")]));
  }

  async resolve(paths: string[], auto: "KeepYours" | "TakeTheirs"): Promise<void> {
    await this.runner.runOk(
      this.runner.args("resolve", [
        this.runner.flag("auto", auto),
        this.runner.flag("noprompt"),
        ...requirePaths(paths),
      ]),
    );
  }

  defaultItemspec(): string[] {
    const settings = getSettings();
    if (settings.restrictToWorkspaceFolder) {
      return [this.root];
    }
    return [];
  }
}

export async function createClient(secrets: ClientContext["secrets"]): Promise<TfClient | undefined> {
  const root = workspaceRoot();
  if (!root) {
    return undefined;
  }
  const settings = getSettings();
  const located = await locateTf(settings.path);
  if (!located) {
    log("tf.exe was not found. Set tfvc.path or install Visual Studio Team Explorer / TEE CLC.");
    return undefined;
  }
  log(`Using ${located.flavor} client at ${located.path}`);

  const password = await secrets.get(SECRET_PASSWORD);
  const login = settings.login && password ? `${settings.login},${password}` : settings.login || undefined;
  const runner = new TfRunner({
    cwd: root,
    tfPath: located.path,
    flavor: located.flavor,
    collection: settings.collection || undefined,
    login,
  });

  const workspace = await detectWorkspace(runner, root, settings.restrictToWorkspaceFolder);
  if (!workspace) {
    log("No TFVC workspace mapping found for this folder.");
    return undefined;
  }
  log(`Workspace ${workspace.name} (${workspace.collection})`);
  return new TfClient(located, runner, workspace, root);
}

export { SECRET_PASSWORD };

async function detectWorkspace(runner: TfRunner, root: string, restrict: boolean): Promise<TfWorkspace | undefined> {
  const extra: string[] = [];
  if (restrict) {
    extra.push(root);
  } else if (runner.flavor === "clc") {
    extra.push(runner.flag("login", "fake,fake"));
  }
  const args = runner.args("workfold", extra, { skipCollection: true });
  let result: RunResult;
  try {
    result = await runner.run(args, { cwd: root });
  } catch (error) {
    log(`workfold failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (result.exitCode !== 0 && !result.stdout.includes("$/")) {
    throwIfAuth(result, args, runner);
    log(`workfold exit ${result.exitCode}: ${result.stderr || result.stdout}`);
    return undefined;
  }
  const parsed = parseWorkfold(result.stdout, runner.flavor === "exe");
  if (!parsed) {
    return undefined;
  }
  if (restrict) {
    const mapping = parsed.mappings.find((item) => item.localPath && localPathIsInside(root, item.localPath));
    if (mapping) {
      parsed.teamProject = mapping.serverPath.startsWith("$/")
        ? mapping.serverPath.split("/")[1] ?? parsed.teamProject
        : parsed.teamProject;
    }
  }
  return parsed;
}

function throwIfAuth(result: RunResult, args: string[], runner: TfRunner): void {
  const text = `${result.stderr}\n${result.stdout}`;
  if (/access denied|authenticat|unauthorized|login/i.test(text)) {
    throw runner.toError(args, result);
  }
}

function requirePaths(paths: string[]): string[] {
  if (paths.length === 0) {
    throw new TfError("No items selected", { stdout: "", stderr: "No items selected", exitCode: 1 }, []);
  }
  return paths;
}

function flattenComment(comment: string): string {
  return comment.replace(/\r\n/g, " ").replace(/\n/g, " ").trim();
}

function isMissingVersion(result: RunResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return /does not exist at the specified version/i.test(text) || /No file matches/i.test(text);
}

function stripWarnings(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .filter((line) => !/^WARNING:/i.test(line))
    .join("\n");
}

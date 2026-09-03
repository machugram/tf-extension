export type TfFlavor = "exe" | "clc";

export type ChangeKind =
  | "edit"
  | "add"
  | "delete"
  | "rename"
  | "merge"
  | "branch"
  | "undelete"
  | "lock"
  | "encoding"
  | "property"
  | "rollback"
  | "conflict"
  | "unknown";

export interface PendingChange {
  serverItem: string;
  localItem: string;
  version: string;
  owner: string;
  date: string;
  lock: string;
  changeTypes: ChangeKind[];
  workspace: string;
  computer: string;
  isCandidate: boolean;
  sourceItem?: string;
}

export interface WorkspaceMapping {
  serverPath: string;
  localPath?: string;
  cloaked: boolean;
}

export interface TfWorkspace {
  name: string;
  collection: string;
  teamProject: string;
  mappings: WorkspaceMapping[];
}

export interface HistoryEntry {
  changeset: string;
  user: string;
  date: string;
  comment: string;
  items: string[];
}

export interface Shelveset {
  name: string;
  owner: string;
  date?: string;
  comment?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class TfError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly args: string[];

  constructor(message: string, result: RunResult, args: string[]) {
    super(message);
    this.name = "TfError";
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.exitCode = result.exitCode;
    this.args = args;
  }
}

export function parseChangeTypes(raw: string | undefined): ChangeKind[] {
  if (!raw) {
    return ["unknown"];
  }
  const kinds = raw
    .split(/[,|]/)
    .map((part) => normalizeChangeKind(part.trim()))
    .filter((part): part is ChangeKind => part !== undefined);
  return kinds.length > 0 ? unique(kinds) : ["unknown"];
}

export function normalizeChangeKind(raw: string): ChangeKind | undefined {
  const value = raw.toLowerCase().replace(/\s+/g, "");
  if (!value) {
    return undefined;
  }
  if (value.includes("conflict")) {
    return "conflict";
  }
  switch (value) {
    case "edit":
    case "add":
    case "delete":
    case "rename":
    case "merge":
    case "branch":
    case "undelete":
    case "lock":
    case "encoding":
    case "property":
    case "rollback":
      return value;
    default:
      return "unknown";
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

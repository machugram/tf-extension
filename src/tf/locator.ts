import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { TfFlavor } from "../types";

const VS_EDITIONS = ["Enterprise", "Professional", "Community", "BuildTools", "Preview"] as const;
const VS_YEARS = ["2022", "2019", "2017"] as const;

export interface LocatedTf {
  path: string;
  flavor: TfFlavor;
}

export async function locateTf(configuredPath?: string): Promise<LocatedTf | undefined> {
  const candidates = unique(
    [
      configuredPath,
      process.env.TFVC_TF_PATH,
      process.env.TF_EXE,
      ...(await pathLookups()),
      ...wellKnownWindowsPaths(),
      ...(await vswherePaths()),
    ].filter((value): value is string => Boolean(value && value.trim())),
  );

  for (const candidate of candidates) {
    const resolved = resolveCandidate(candidate);
    if (!resolved) {
      continue;
    }
    return {
      path: resolved,
      flavor: inferFlavor(resolved),
    };
  }
  return undefined;
}

export function inferFlavor(tfPath: string): TfFlavor {
  const base = path.basename(tfPath).toLowerCase();
  if (base === "tf.exe") {
    return "exe";
  }
  if (base === "tf.cmd" || base === "tf.bat") {
    return "clc";
  }
  return process.platform === "win32" ? "exe" : "clc";
}

function resolveCandidate(candidate: string): string | undefined {
  const expanded = expandHome(candidate);
  if (path.isAbsolute(expanded) || expanded.includes("/") || expanded.includes("\\")) {
    return fs.existsSync(expanded) ? expanded : undefined;
  }
  return undefined;
}

async function pathLookups(): Promise<string[]> {
  const commands = process.platform === "win32" ? ["tf.exe", "tf"] : ["tf"];
  const found: string[] = [];
  for (const command of commands) {
    const located = await which(command);
    if (located) {
      found.push(located);
    }
  }
  return found;
}

function wellKnownWindowsPaths(): string[] {
  if (process.platform !== "win32") {
    return [];
  }
  const roots = [
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
  ].filter((value): value is string => Boolean(value));
  const paths: string[] = [];
  for (const root of roots) {
    for (const year of VS_YEARS) {
      for (const edition of VS_EDITIONS) {
        paths.push(
          path.join(
            root,
            "Microsoft Visual Studio",
            year,
            edition,
            "Common7",
            "IDE",
            "CommonExtensions",
            "Microsoft",
            "TeamFoundation",
            "Team Explorer",
            "TF.exe",
          ),
        );
      }
    }
    paths.push(path.join(root, "Microsoft Visual Studio 14.0", "Common7", "IDE", "TF.exe"));
    paths.push(path.join(root, "Microsoft Visual Studio 12.0", "Common7", "IDE", "TF.exe"));
  }
  return paths;
}

async function vswherePaths(): Promise<string[]> {
  if (process.platform !== "win32") {
    return [];
  }
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  if (!fs.existsSync(vswhere)) {
    return [];
  }
  try {
    const stdout = await runCapture(vswhere, [
      "-latest",
      "-products",
      "*",
      "-find",
      "Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe",
    ]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function which(command: string): Promise<string | undefined> {
  const finder = process.platform === "win32" ? "where" : "which";
  return runCapture(finder, [command])
    .then((stdout) => stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean))
    .catch(() => undefined);
}

function runCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `exit ${code}`));
      }
    });
  });
}

function expandHome(value: string): string {
  if (value.startsWith("~")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return path.join(home, value.slice(1));
  }
  return value;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = process.platform === "win32" ? item.toLowerCase() : item;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

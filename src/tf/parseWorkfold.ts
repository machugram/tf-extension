import { TfWorkspace, WorkspaceMapping } from "../types";

export function parseWorkfold(output: string, exeStyleName = false): TfWorkspace | undefined {
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  let headerSeen = false;
  let name = "";
  let collection = "";
  const mappings: WorkspaceMapping[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      continue;
    }
    if (/^=+$/.test(line.trim())) {
      headerSeen = true;
      continue;
    }
    if (!headerSeen && !/^(Workspace|Collection)\s*:/i.test(line.trim())) {
      continue;
    }
    headerSeen = true;

    if (/^Workspace\s*:/i.test(line.trim())) {
      name = valueAfterColon(line);
    } else if (/^Collection\s*:/i.test(line.trim())) {
      collection = valueAfterColon(line);
    } else {
      const mapping = parseMapping(line);
      if (mapping) {
        mappings.push(mapping);
      }
    }
  }

  if (mappings.length === 0) {
    return undefined;
  }

  if (exeStyleName) {
    const paren = name.lastIndexOf(" (");
    if (paren >= 0) {
      name = name.slice(0, paren).trim();
    }
  }

  const teamProject = teamProjectFromServerPath(mappings.find((m) => !m.cloaked)?.serverPath ?? "");
  return {
    name,
    collection: decodeURI(collection),
    teamProject: decodeURI(teamProject),
    mappings,
  };
}

export function parseMapping(line: string): WorkspaceMapping | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("Access denied")) {
    return undefined;
  }
  const cloaked = /^\(cloaked\)/i.test(trimmed);
  const body = cloaked ? trimmed.replace(/^\(cloaked\)\s*/i, "") : trimmed;
  const colon = findMappingColon(body);
  if (colon < 0) {
    if (cloaked && body.startsWith("$/")) {
      return { serverPath: body.replace(/:$/, "").trim(), cloaked: true };
    }
    return undefined;
  }
  const serverPath = body.slice(0, colon).trim();
  const localPath = body.slice(colon + 1).trim() || undefined;
  if (!serverPath.startsWith("$/") && !cloaked) {
    return undefined;
  }
  return { serverPath, localPath, cloaked };
}

export function teamProjectFromServerPath(serverPath: string): string {
  if (!serverPath.startsWith("$/") || serverPath.length <= 2) {
    return "";
  }
  const slash = serverPath.indexOf("/", 2);
  return slash > 0 ? serverPath.slice(2, slash) : serverPath.slice(2);
}

function valueAfterColon(line: string): string {
  const index = line.indexOf(":");
  return index >= 0 ? line.slice(index + 1).trim() : "";
}

function findMappingColon(line: string): number {
  const windowsDrive = line.search(/: [A-Za-z]:[\\/]/);
  if (windowsDrive >= 0) {
    return windowsDrive;
  }
  return line.indexOf(": ");
}

export function localPathIsInside(openedPath: string, workspacePath: string): boolean {
  const opened = normalizeDir(openedPath);
  const mapped = normalizeDir(workspacePath);
  return opened.startsWith(mapped);
}

function normalizeDir(value: string): string {
  const slash = value.replace(/\\/g, "/").toLowerCase();
  return slash.endsWith("/") ? slash : `${slash}/`;
}

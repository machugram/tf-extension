import { ChangeKind, PendingChange, parseChangeTypes } from "../types";

const CHANGESET_SUFFIX = /;C(\d+)$/;

export function parseStatus(output: string): PendingChange[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }
  if (looksLikeXml(trimmed)) {
    return parseStatusXml(trimmed);
  }
  return parseStatusDetailed(trimmed);
}

export function parseStatusXml(xml: string): PendingChange[] {
  const pending = extractSection(xml, "pendingchanges");
  const candidates = extractSection(xml, "candidatependingchanges");
  return [
    ...parsePendingChangeTags(pending, false),
    ...parsePendingChangeTags(candidates, true),
  ];
}

export function parseStatusDetailed(text: string): PendingChange[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const changes: PendingChange[] = [];
  let detected = false;
  let current: PendingChange | undefined;

  const flush = () => {
    if (current) {
      changes.push(current);
      current = undefined;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (/detected change\(s\)/i.test(line) && /\d/.test(line) && !line.endsWith(":")) {
      break;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^-+$/.test(line.trim()) || /^detected changes:\s*$/i.test(line.trim())) {
      detected = true;
      continue;
    }
    if (line.startsWith("$/")) {
      flush();
      const match = line.match(CHANGESET_SUFFIX);
      current = emptyChange({
        serverItem: match ? line.slice(0, match.index) : line,
        version: match ? match[1] : "0",
        isCandidate: detected,
      });
      continue;
    }
    if (!current) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    applyDetailedProperty(current, name, value);
  }
  flush();
  return changes;
}

function looksLikeXml(text: string): boolean {
  return text.startsWith("<") || text.includes("<status");
}

function extractSection(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1] : "";
}

function parsePendingChangeTags(section: string, isCandidate: boolean): PendingChange[] {
  if (!section) {
    return [];
  }
  const tags = section.match(/<pendingchange\b[^>]*\/?>/gi) ?? [];
  return tags.map((tag) => {
    const attrs = parseAttributes(tag);
    return {
      serverItem: attrs.serveritem ?? "",
      localItem: attrs.localitem ?? "",
      version: attrs.version ?? "0",
      owner: attrs.owner ?? "",
      date: attrs.date ?? "",
      lock: attrs.lock ?? "",
      changeTypes: parseChangeTypes(attrs.changetype ?? attrs.changetypes),
      workspace: attrs.workspace ?? "",
      computer: attrs.computer ?? "",
      isCandidate,
      sourceItem: attrs.sourceitem || undefined,
    };
  });
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) {
    attrs[match[1].toLowerCase()] = decodeXml(match[2]);
  }
  return attrs;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function emptyChange(partial: Partial<PendingChange> & Pick<PendingChange, "serverItem">): PendingChange {
  return {
    serverItem: partial.serverItem,
    localItem: partial.localItem ?? "",
    version: partial.version ?? "0",
    owner: partial.owner ?? "",
    date: partial.date ?? "",
    lock: partial.lock ?? "",
    changeTypes: partial.changeTypes ?? ["unknown"],
    workspace: partial.workspace ?? "",
    computer: partial.computer ?? "",
    isCandidate: partial.isCandidate ?? false,
    sourceItem: partial.sourceItem,
  };
}

function applyDetailedProperty(change: PendingChange, name: string, value: string): void {
  switch (name) {
    case "local item": {
      const parts = value.split("] ");
      if (parts.length === 2 && parts[0].startsWith("[")) {
        change.computer = parts[0].slice(1);
        change.localItem = parts[1];
      } else {
        change.localItem = value;
      }
      break;
    }
    case "source item":
      change.sourceItem = value;
      break;
    case "user":
      change.owner = value;
      break;
    case "date":
      change.date = value;
      break;
    case "lock":
      change.lock = value;
      break;
    case "change":
      change.changeTypes = parseChangeTypes(value);
      break;
    case "workspace":
      change.workspace = value;
      break;
    default:
      break;
  }
}

export function primaryChangeType(change: PendingChange): ChangeKind {
  if (change.changeTypes.includes("conflict")) {
    return "conflict";
  }
  if (change.changeTypes.includes("delete")) {
    return "delete";
  }
  if (change.changeTypes.includes("add")) {
    return "add";
  }
  if (change.changeTypes.includes("rename")) {
    return "rename";
  }
  if (change.changeTypes.includes("edit")) {
    return "edit";
  }
  return change.changeTypes[0] ?? "unknown";
}

export function hasChangeType(change: PendingChange, kind: ChangeKind): boolean {
  return change.changeTypes.includes(kind);
}

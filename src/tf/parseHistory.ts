import { HistoryEntry, Shelveset } from "../types";

export function parseHistory(output: string): HistoryEntry[] {
  const text = output.replace(/\r\n/g, "\n");
  const blocks = text.split(/^-{10,}\s*$/m).map((block) => block.trim()).filter(Boolean);
  const entries: HistoryEntry[] = [];

  for (const block of blocks) {
    const changeset = field(block, "Changeset") ?? field(block, "Changeset number");
    if (!changeset) {
      continue;
    }
    entries.push({
      changeset,
      user: field(block, "User") ?? field(block, "Owner") ?? "",
      date: field(block, "Date") ?? "",
      comment: commentFrom(block),
      items: itemsFrom(block),
    });
  }
  return entries;
}

export function parseShelvesets(output: string): Shelveset[] {
  const text = output.replace(/\r\n/g, "\n").trim();
  if (!text) {
    return [];
  }
  if (looksDetailed(text)) {
    return parseShelvesetsDetailed(text);
  }
  return parseShelvesetsBrief(text);
}

function looksDetailed(text: string): boolean {
  return /^Shelveset\s*:/im.test(text) || /^-{10,}/m.test(text);
}

function parseShelvesetsDetailed(text: string): Shelveset[] {
  const blocks = text.split(/^-{10,}\s*$/m).map((block) => block.trim()).filter(Boolean);
  const sets: Shelveset[] = [];
  for (const block of blocks) {
    const name = field(block, "Shelveset");
    if (!name) {
      continue;
    }
    const { shelveset, owner } = splitOwner(name);
    sets.push({
      name: shelveset,
      owner,
      date: field(block, "Date"),
      comment: commentFrom(block),
    });
  }
  return sets;
}

function parseShelvesetsBrief(text: string): Shelveset[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const sets: Shelveset[] = [];
  for (const line of lines) {
    if (/^shelvesets?:/i.test(line) || /^name\s+owner/i.test(line) || /^-+$/.test(line)) {
      continue;
    }
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    sets.push({ name: match[1], owner: match[2].trim() });
  }
  return sets;
}

function field(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`^${name}\\s*:\\s*(.*)$`, "im"));
  return match ? match[1].trim() : undefined;
}

function commentFrom(block: string): string {
  const match = block.match(/^Comment:\s*(?:\n|$)/im);
  if (!match || match.index === undefined) {
    const inline = field(block, "Comment");
    return inline ?? "";
  }
  const after = block.slice(match.index + match[0].length);
  const stop = after.search(/^(Items|Associated work items)\s*:/im);
  const body = (stop >= 0 ? after.slice(0, stop) : after).trim();
  return body;
}

function itemsFrom(block: string): string[] {
  const match = block.match(/^Items:\s*$/im);
  if (!match || match.index === undefined) {
    return [];
  }
  const after = block.slice(match.index + match[0].length);
  const stop = after.search(/^Associated work items\s*:/im);
  const body = stop >= 0 ? after.slice(0, stop) : after;
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitOwner(name: string): { shelveset: string; owner: string } {
  const match = name.match(/^(.*)\s+\((.+)\)\s*$/);
  if (match) {
    return { shelveset: match[1].trim(), owner: match[2].trim() };
  }
  return { shelveset: name, owner: "" };
}

export function parseChangesetNumber(output: string): string | undefined {
  const match = output.match(/Changeset\s+#?(\d+)\s+checked in/i);
  return match?.[1];
}

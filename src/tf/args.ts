import { TfFlavor } from "../types";

export class TfArgs {
  constructor(
    readonly flavor: TfFlavor,
    private readonly collection?: string,
    private readonly login?: string,
  ) {}

  flag(name: string, value?: string): string {
    const prefix = this.flavor === "clc" ? "-" : "/";
    return value === undefined || value === "" ? `${prefix}${name}` : `${prefix}${name}:${value}`;
  }

  args(command: string, extra: string[] = [], options?: { skipCollection?: boolean }): string[] {
    const built = [command, ...extra];
    if (this.collection && !options?.skipCollection && !hasSwitch(built, "collection")) {
      built.push(this.flag("collection", this.collection));
    }
    if (this.login && !hasSwitch(built, "login")) {
      built.push(this.flag("login", this.login));
    }
    return built;
  }
}

export function hasSwitch(args: string[], name: string): boolean {
  const re = new RegExp(`^[-/]${name}(:|$)`, "i");
  return args.some((arg) => re.test(arg));
}

export function redactLogin(value: string): string {
  return value.replace(/([-/]login:)([^,\s]+),([^\s]+)/gi, "$1$2,******");
}

export function workItemIds(comment: string): number[] {
  const matches = comment.match(/#(\d+)/g) ?? [];
  const ids = matches.map((match) => Number(match.slice(1))).filter((id) => !Number.isNaN(id));
  return [...new Set(ids)];
}

import * as vscode from "vscode";
import { hasChangeType, primaryChangeType } from "../tf/parseStatus";
import { PendingChange } from "../types";
import { TfvcResource } from "./resource";

export class TfvcModel {
  private excluded = new Set<string>();
  private _conflicts: TfvcResource[] = [];
  private _included: TfvcResource[] = [];
  private _detected: TfvcResource[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  get conflicts(): TfvcResource[] {
    return this._conflicts;
  }

  get included(): TfvcResource[] {
    return this._included;
  }

  get detected(): TfvcResource[] {
    return this._detected;
  }

  apply(changes: PendingChange[]): void {
    const conflicts: TfvcResource[] = [];
    const included: TfvcResource[] = [];
    const detected: TfvcResource[] = [];

    for (const change of changes) {
      const key = keyOf(change);
      if (hasChangeType(change, "conflict") || primaryChangeType(change) === "conflict") {
        conflicts.push(new TfvcResource(change, "conflicts"));
        continue;
      }
      if (change.isCandidate || this.excluded.has(key)) {
        detected.push(new TfvcResource(change, "excluded"));
        continue;
      }
      included.push(new TfvcResource(change, "included"));
    }

    this._conflicts = conflicts;
    this._included = included;
    this._detected = detected;
    this._onDidChange.fire();
  }

  include(resources: TfvcResource[]): void {
    for (const resource of resources) {
      this.excluded.delete(keyOf(resource.change));
    }
    this.rebalance();
  }

  exclude(resources: TfvcResource[]): void {
    for (const resource of resources) {
      this.excluded.add(keyOf(resource.change));
    }
    this.rebalance();
  }

  includeAll(): void {
    this.include([...this._detected]);
  }

  excludeAll(): void {
    this.exclude([...this._included]);
  }

  private rebalance(): void {
    const all = [...this._conflicts, ...this._included, ...this._detected].map((resource) => resource.change);
    this.apply(all);
  }
}

function keyOf(change: PendingChange): string {
  return (change.localItem || change.serverItem).toLowerCase();
}

import { spawn } from "child_process";
import { RunResult, TfError, TfFlavor } from "../types";
import { log, logBlock } from "../output";
import { redactLogin, TfArgs } from "./args";

export interface RunnerOptions {
  cwd: string;
  tfPath: string;
  flavor: TfFlavor;
  collection?: string;
  login?: string;
  timeoutMs?: number;
}

export class TfRunner {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly tfArgs: TfArgs;

  constructor(private readonly options: RunnerOptions) {
    this.tfArgs = new TfArgs(options.flavor, options.collection, options.login);
  }

  get flavor(): TfFlavor {
    return this.options.flavor;
  }

  get cwd(): string {
    return this.options.cwd;
  }

  get tfPath(): string {
    return this.options.tfPath;
  }

  flag(name: string, value?: string): string {
    return this.tfArgs.flag(name, value);
  }

  args(command: string, extra: string[] = [], options?: { skipCollection?: boolean }): string[] {
    return this.tfArgs.args(command, extra, options);
  }

  run(args: string[], exec?: { cwd?: string; timeoutMs?: number; acceptExit?: (code: number) => boolean }): Promise<RunResult> {
    const task = this.chain.then(() => this.spawn(args, exec));
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async runOk(args: string[], exec?: { cwd?: string; timeoutMs?: number }): Promise<RunResult> {
    const result = await this.run(args, exec);
    if (result.exitCode !== 0) {
      throw this.toError(args, result);
    }
    return result;
  }

  toError(args: string[], result: RunResult): TfError {
    const detail = (result.stderr || result.stdout || `tf exited with code ${result.exitCode}`).trim();
    return new TfError(firstLine(detail), result, args);
  }

  private spawn(args: string[], exec?: { cwd?: string; timeoutMs?: number; acceptExit?: (code: number) => boolean }): Promise<RunResult> {
    const cwd = exec?.cwd ?? this.options.cwd;
    const timeoutMs = exec?.timeoutMs ?? this.options.timeoutMs ?? 120_000;
    log(`> ${quote(this.options.tfPath)} ${args.map((arg) => quote(redactLogin(arg))).join(" ")}`);

    return new Promise((resolve, reject) => {
      const child = spawn(this.options.tfPath, args, {
        cwd,
        windowsHide: true,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`tf timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const result: RunResult = { stdout, stderr, exitCode: code ?? 1 };
        if (stdout.trim()) {
          logBlock("stdout", stdout);
        }
        if (stderr.trim()) {
          logBlock("stderr", redactLogin(stderr));
        }
        log(`exit ${result.exitCode}`);
        resolve(result);
      });
    });
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? text;
}

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}


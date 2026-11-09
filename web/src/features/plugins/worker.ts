// One plug-in's Web Worker on the main thread: starts its code, forwards its
// calls to the host, and maps its errors to the plug-in's own line numbers. A
// worker is one of: a plug-in run from the editor, a plug-in kept alive for its
// menu items, or the script console's (code null, expressions only).

import { workerSource, type WorkerApi } from "./bootstrap.ts";
import { SandboxedWorker, type SandboxError } from "./sandbox.ts";

export interface PluginError {
  readonly name: string;
  readonly message: string;
  /** the line of the plug-in's code that failed (1 is its first line), or null */
  readonly line: number | null;
}

export type Outcome = { readonly ok: true; readonly text?: string; readonly value?: unknown } | { readonly ok: false; readonly error: PluginError };

export type LogLevel = "log" | "warn" | "error";

export interface WorkerEvents {
  /** an openvwx call from the plug-in; its result (plain data) or error goes back to it */
  call(method: string, args: unknown[]): Promise<unknown>;
  log(level: LogLevel, text: string, line: number | null): void;
  /** the plug-in added a menu item */
  menu(id: string, label: string): void;
  /** the plug-in added a render engine (openvwx.render.engine), described by `spec` (plain data, unchecked) */
  engine?(id: string, spec: unknown): void;
  /** an error nothing in the plug-in caught (a timer, a rejected promise nobody awaited) */
  uncaught(error: PluginError): void;
}

interface Message {
  readonly type: string;
  readonly id?: number;
  readonly ok?: boolean;
  readonly text?: string;
  readonly error?: { name?: string; message?: string; line?: number | null };
  readonly method?: string;
  readonly args?: unknown[];
  readonly label?: string;
  readonly spec?: unknown;
  readonly value?: unknown;
  readonly level?: string;
  readonly line?: number | null;
}

/** "SyntaxError: x", "Uncaught TypeError: y" or plain text, as a name and a message. */
export function splitMessage(raw: string): { name: string; message: string } {
  const m = /^(?:Uncaught\s+)?([A-Za-z]*Error)\b:?\s*([\s\S]*)$/.exec(raw);
  if (m) return { name: m[1], message: m[2] || raw };
  return { name: "Error", message: raw };
}

export class PluginWorker {
  private worker: SandboxedWorker | null = null;
  private seq = 0;
  private ready = false;
  private readonly waiting = new Map<number, (outcome: Outcome) => void>();
  private readonly offset: number;
  private failed: PluginError | null = null;

  /** `code` is the plug-in's code, or null for the script console's worker; `api` what openvwx offers it. */
  constructor(
    code: string | null,
    private readonly events: WorkerEvents,
    api?: WorkerApi,
  ) {
    const src = workerSource(code, api);
    this.offset = src.offset;
    try {
      this.worker = new SandboxedWorker(src.source);
      this.worker.onmessage = (e) => this.onMessage(e.data as Message);
      this.worker.onerror = (e: SandboxError) => {
        const { name, message } = splitMessage(e.message || "The plug-in failed to load.");
        const error: PluginError = { name, message, line: this.userLine(e.lineno) };
        // before the bootstrap ran, the script itself did not load: a syntax error in the code
        if (!this.ready) this.fail(error);
        else this.events.uncaught(error);
      };
    } catch (err) {
      this.kill();
      this.failed = { name: "Error", message: err instanceof Error ? err.message : String(err), line: null };
    }
  }

  /** Runs the plug-in's code (its top level). */
  start(): Promise<Outcome> {
    return this.request("start", {});
  }

  /** Runs one menu item the plug-in added. */
  invoke(menuId: string): Promise<Outcome> {
    return this.request("invoke", { menu: menuId });
  }

  /** Has one of the plug-in's render engines make a picture of `job` (plain data); its pictures come back as the outcome's value. */
  render(engineId: string, job: unknown): Promise<Outcome> {
    return this.request("render", { engine: engineId, job });
  }

  /** Evaluates one line of the script console: an expression's value, or a body's result. */
  evaluate(code: string): Promise<Outcome> {
    return this.request("eval", { code });
  }

  /** Stops the worker. Anything still waiting for it is answered with "Stopped". */
  kill(): void {
    const w = this.worker;
    this.worker = null;
    if (w) w.terminate();
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    for (const resolve of waiting) resolve({ ok: false, error: { name: "Stopped", message: "Stopped.", line: null } });
  }

  get alive(): boolean {
    return this.worker !== null;
  }

  private request(type: string, extra: Record<string, unknown>): Promise<Outcome> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve(this.failed ? { ok: false, error: this.failed } : { ok: false, error: { name: "Stopped", message: "Stopped.", line: null } });
        return;
      }
      const id = ++this.seq;
      this.waiting.set(id, resolve);
      try {
        this.worker.postMessage({ type, id, ...extra });
      } catch (err) {
        this.waiting.delete(id);
        resolve({ ok: false, error: { name: "Error", message: String(err), line: null } });
      }
    });
  }

  /** The plug-in's line for a script line: the code starts after the bootstrap. */
  private userLine(raw: number | null | undefined): number | null {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    const n = raw - this.offset;
    return n >= 1 ? n : null;
  }

  private mapError(e: Message["error"]): PluginError {
    return { name: e?.name ?? "Error", message: e?.message ?? "Error", line: this.userLine(e?.line) };
  }

  private fail(error: PluginError): void {
    this.failed = error;
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    this.kill();
    for (const resolve of waiting) resolve({ ok: false, error });
  }

  private onMessage(m: Message): void {
    switch (m.type) {
      case "ready":
        this.ready = true;
        return;
      case "log":
        this.events.log((m.level as LogLevel) ?? "log", String(m.text ?? ""), this.userLine(m.line));
        return;
      case "menu":
        this.events.menu(String(m.id), String(m.label ?? ""));
        return;
      case "engine":
        this.events.engine?.(String(m.id), m.spec);
        return;
      case "uncaught":
        this.events.uncaught(this.mapError(m.error));
        return;
      case "call":
        this.answerCall(m);
        return;
      case "done":
      case "invoked":
      case "evaluated":
      case "rendered": {
        const resolve = m.id !== undefined ? this.waiting.get(m.id) : undefined;
        if (!resolve) return;
        this.waiting.delete(m.id as number);
        resolve(m.ok ? { ok: true, text: m.text, value: m.value } : { ok: false, error: this.mapError(m.error) });
        return;
      }
      default:
        return;
    }
  }

  private answerCall(m: Message): void {
    const id = m.id as number;
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(this.events.call(String(m.method), Array.isArray(m.args) ? m.args : []));
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (value) => this.reply(id, true, value, undefined),
      (err: unknown) => this.reply(id, false, undefined, err),
    );
  }

  private reply(id: number, ok: boolean, value: unknown, err: unknown): void {
    const w = this.worker;
    if (!w) return;
    const error = ok ? undefined : errorInfo(err);
    try {
      w.postMessage({ type: "reply", id, ok, value, error });
    } catch (e) {
      // a value that cannot be copied to the plug-in is an error there
      w.postMessage({ type: "reply", id, ok: false, error: errorInfo(e) });
    }
  }
}

function errorInfo(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}

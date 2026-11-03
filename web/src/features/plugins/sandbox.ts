// A plug-in's Web Worker, started inside a hidden sandboxed iframe. The iframe's
// origin is opaque, so code that gets past the bootstrap's stubs (a nested worker
// has a fetch of its own) still can't reach this site's cookies, storage or /api,
// and its content policy blocks network requests wherever browsers apply it to
// workers. openvwx.fetch, asked of the host, stays the one way out. Eval is allowed in
// here (the Script Console compiles what is typed): the code is the plug-in's own anyway.

const SANDBOX_DOC = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; worker-src blob: data:">
<script>
onmessage = function (e) {
  if (e.source !== parent || !e.data || e.data.type !== "openvwx-plugin" || !e.ports[0]) return;
  var port = e.ports[0];
  var w;
  try {
    w = new Worker(URL.createObjectURL(new Blob([e.data.source], { type: "text/javascript" })));
  } catch (err) {
    // some browsers refuse blob workers in an opaque origin; a data: URL worker is opaque too
    w = new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(e.data.source));
  }
  w.onmessage = function (m) { port.postMessage({ k: "m", d: m.data }); };
  w.onerror = function (ev) {
    ev.preventDefault();
    port.postMessage({ k: "e", message: String(ev.message || ""), lineno: typeof ev.lineno === "number" ? ev.lineno : null });
  };
  port.onmessage = function (m) { w.postMessage(m.data); };
};
</script>`;

export interface SandboxError {
  readonly message: string;
  readonly lineno: number | null;
}

interface FromSandbox {
  readonly k: "m" | "e";
  readonly d?: unknown;
  readonly message?: string;
  readonly lineno?: number | null;
}

/** The parts of Worker the plug-in host uses, backed by a worker in its own sandboxed iframe. */
export class SandboxedWorker {
  onmessage: ((e: { readonly data: unknown }) => void) | null = null;
  onerror: ((e: SandboxError) => void) | null = null;
  private frame: HTMLIFrameElement | null;
  private readonly port: MessagePort;

  constructor(source: string) {
    const channel = new MessageChannel();
    this.port = channel.port1;
    // messages posted before the iframe is up wait in the channel
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data as FromSandbox;
      if (m.k === "m") this.onmessage?.({ data: m.d });
      else this.onerror?.({ message: m.message ?? "", lineno: m.lineno ?? null });
    };
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.display = "none";
    frame.srcdoc = SANDBOX_DOC;
    frame.addEventListener(
      "load",
      () => frame.contentWindow?.postMessage({ type: "openvwx-plugin", source }, "*", [channel.port2]),
      { once: true },
    );
    document.body.append(frame);
    this.frame = frame;
  }

  postMessage(message: unknown): void {
    this.port.postMessage(message);
  }

  /** Stops the worker: removing its iframe ends it. */
  terminate(): void {
    this.port.close();
    this.frame?.remove();
    this.frame = null;
  }
}

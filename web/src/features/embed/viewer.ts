// The embed runtime: the page another site frames to show a drawing (?embed). It loads the drawing,
// opens it view only, applies the address's options (the layer or sheet, 2D or 3D and where it starts,
// a slow turn), mounts the viewer's controls and talks to the host page over postMessage (bridge.ts).
// embed.css hides the editor's own chrome. Nothing here saves the visitor's preferences: the look and
// the render mode are set for this page only.

import { setActiveLayer } from "../../app/commands.ts";
import { nextPaint } from "../../app/dom.ts";
import { type AppContext, type DocumentSource, documentSource } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
import { ApiError, serverConfig, sharing } from "../../platform/api.ts";
import type { SharedFile } from "../../platform/protocol.ts";
import { type HostMessage, type SelectedObject, type ViewerMessage, findLayer, layerChoices, outgoing, parseHostMessage } from "./bridge.ts";
import { type ChromeActions, type ChromeState, type EmbedChrome, dropPoster, mountChrome, posterStatus, showEmbedError, showPoster } from "./chrome.ts";
import { fetchLinked, isLocalHost, openAny } from "./fromUrl.ts";
import { type EmbedOptions, type EmbedSource, type Xyz, displayName, openUrlFor, parseOptions } from "./options.ts";
import { normalizeFileUrl } from "./remote.ts";

declare global {
  interface Window {
    /** started by the server's inline script on an embed page (server/src/embed.ts) */
    openvwxPreload?: { readonly info: Promise<Response | null>; readonly content: Promise<Response | null> };
  }
}

const NO_SOURCE = "This embed doesn't say which drawing to show.";
const NO_SERVER = "This drawing is on a Rodeo server that can't be reached.";
const GONE = "This drawing isn't shared any more.";
const FAILED = "The drawing couldn't be loaded. Try again in a minute.";
const NOT_SUPPORTED = "This kind of file can't be shown in an embed yet.";

/** A share token's shape, as the server checks it (server/src/embed.ts). */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** A failure whose message is meant for the visitor, shown as it is; any other error shows FAILED. */
class Shown extends Error {}

/** The 3D view turns this many degrees a second: a full turn in about 36 seconds. */
const TURN_DEGREES_PER_SECOND = 10;
/** The longest step a turn takes, so a stalled tab doesn't jump when it wakes. */
const MAX_TURN_STEP_SECONDS = 0.1;
/** The most selected objects a host page is sent at once. */
const MAX_SELECTED = 50;

/** Before the editor's first paint: the embed's body classes and look. Writes nothing to storage. */
export function prepareEmbedPage(params: URLSearchParams): void {
  const o = parseOptions(params);
  document.body.classList.add("embed", `embed-ui-${o.ui}`);
  // set directly, not with setTheme, which would save the visitor's own choice
  document.documentElement.dataset.theme = o.theme === "auto" ? "system" : o.theme;
}

/** ?embed: loads the drawing, opens it view only, applies the address's options, mounts the controls and talks to the host page. */
export async function startEmbed(token: string, params: URLSearchParams, ctx: AppContext): Promise<void> {
  const o = parseOptions(params);
  const address = params.get("url") ?? "";
  const source: EmbedSource | null = token ? { token } : address ? { url: address } : null;
  let openUrl: string | null = null;
  try {
    if (!source) throw new Shown(NO_SOURCE);
    openUrl = openUrlFor(location.origin, source);
    const { name, owner } = "token" in source ? await openShare(source.token, ctx) : await openPublicFile(source.url, ctx);
    const title = displayName(name);
    document.title = `${title} · Rodeo`;
    await new Embed(ctx, o).start(title, owner, openUrl);
  } catch (err) {
    // an unexpected failure is logged, and the visitor sees the plain message
    if (!(err instanceof Shown)) console.warn("openvwx: embed", err);
    const message = err instanceof Shown ? err.message : FAILED;
    showEmbedError(message, openUrl);
    post({ type: "error", message });
  }
}

/** A share link's drawing, opened view only; its name and owner for the controls. Uses the page's preload when it came. */
async function openShare(token: string, ctx: AppContext): Promise<{ name: string; owner: string | null }> {
  // the token goes into a request path, so anything but a token's characters is refused before a request
  if (!TOKEN.test(token)) throw new Shown(NO_SOURCE);
  if (!(await serverConfig())) throw new Shown(NO_SERVER);
  // the server's first-paint script started both requests, so they are used rather than sent again
  const preload = window.openvwxPreload;
  delete window.openvwxPreload;
  const pair: [Response | null, Response | null] = preload ? await Promise.all([preload.info, preload.content]) : [null, null];
  const [infoRes, contentRes] = pair;
  let info: SharedFile;
  let bytes: Uint8Array;
  try {
    info = infoRes?.ok ? ((await infoRes.json()) as SharedFile) : await sharing.shared(token);
    bytes = contentRes?.ok ? new Uint8Array(await contentRes.arrayBuffer()) : (await sharing.sharedContent(token)).bytes;
  } catch (err) {
    // a revoked or unknown link answers 404, which the page says in words rather than as an error
    if (err instanceof ApiError && err.status === 404) throw new Shown(GONE);
    throw err;
  }
  const src: DocumentSource = { kind: "share", label: "Shared", readOnly: true };
  await ctx.openDocument(bytes, info.fileName, { source: src });
  // the open was refused (unsaved changes were kept): nothing of the link is shown
  if (documentSource() !== src) throw new Shown(FAILED);
  return { name: info.fileName, owner: info.ownerName };
}

/** A public file, fetched in the visitor's browser and opened view only. The poster shows its progress. */
async function openPublicFile(address: string, ctx: AppContext): Promise<{ name: string; owner: null }> {
  const link = normalizeFileUrl(address, isLocalHost());
  if ("error" in link) throw new Shown(link.error);
  showPoster(displayName(link.name));
  let bytes: Uint8Array;
  try {
    bytes = await fetchLinked(link, (text) => posterStatus(text));
  } catch (err) {
    throw new Shown(errorMessage(err));
  }
  const opened = await openAny(ctx, bytes, link.name, { kind: "url", label: "Web", readOnly: true });
  if (!opened) throw new Shown(NOT_SUPPORTED);
  return { name: link.name, owner: null };
}

/** A document point as the 3D view takes it. */
function vec(p: Xyz): { x: number; y: number; z: number } {
  return { x: p[0], y: p[1], z: p[2] };
}

/** Tells the host page, when this page is framed. Only the viewer's four message types are sent. */
function post(m: ViewerMessage): void {
  if (window.parent !== window) window.parent.postMessage(outgoing(m), "*");
}

/** A drawing open in the embed: its view, its controls, and its messages with the host page. */
class Embed {
  /** false once the drawing turned out to have no 3D model, or WebGL is missing: 3D is then not offered */
  private can3d = true;
  /** whether the 3D view is turning (the Turn control, the rotate option, or a host's rotate) */
  private turning = false;
  private frame = 0;
  private last = 0;
  /** actions run one after another, so a host's setView and then its rotate take effect in that order */
  private queue: Promise<void> = Promise.resolve();
  private chrome: EmbedChrome | null = null;
  private readonly ctx: AppContext;
  private readonly o: EmbedOptions;

  constructor(ctx: AppContext, o: EmbedOptions) {
    this.ctx = ctx;
    this.o = o;
  }

  /** Shows the drawing as the options ask, mounts the controls, and tells the host page it is ready. */
  async start(title: string, owner: string | null, openUrl: string): Promise<void> {
    const { ctx, o } = this;
    ctx.setTool("pan");
    if (o.layer) {
      const layer = findLayer(ctx.scene.layers(), o.layer);
      if (layer) {
        setActiveLayer(layer.id);
        // a sheet is fitted to its page, as the editor fits one when it is chosen
        if (layer.kind === "sheet") ctx.fit();
      }
    }
    if (o.view === "3d") await this.enter3d(true);
    else if (o.view === "2d") ctx.show2d();
    // a start view given as a centre and a width is for the 2D drawing; a 3D embed takes its camera instead
    if (o.at && !store.view3d) {
      ctx.view.cx = o.at.x;
      ctx.view.cy = o.at.y;
      ctx.view.scale = ctx.view.width / o.at.span;
      store.emit("view");
      ctx.requestDraw();
    }

    const actions: ChromeActions = {
      view: (view) => this.act(() => (view === "3d" ? this.enter3d(false) : this.leave3d())),
      fit: () => this.act(() => ctx.fit()),
      rotate: (on) => this.act(() => this.setTurning(on)),
      layer: (id) => this.act(() => this.pickLayer(id)),
    };
    this.chrome = mountChrome({ ui: o.ui, title, owner, openUrl }, this.state(), actions);
    store.on(["view3d", "layer"], () => this.chrome?.update(this.state()));

    // a press or a wheel turn on the model stops the turn, so the visitor is never fought for the view
    const host = document.getElementById("view3d-host");
    for (const type of ["pointerdown", "wheel"]) {
      host?.addEventListener(type, () => this.setTurning(false), { capture: true, passive: true });
    }

    // two frames pass so the drawing is painted before the poster is taken away
    await nextPaint();
    await nextPaint();
    dropPoster();

    // the layers the picker offers (and setLayer accepts): design layers that aren't hidden, and sheets
    const offered = new Set(layerChoices(ctx.scene.layers()).map((c) => c.id));
    post({
      type: "ready",
      name: title,
      owner,
      view: store.view3d ? "3d" : "2d",
      layers: ctx.scene.layers().filter((l) => offered.has(l.id)).map((l) => ({ id: l.id, name: l.name, kind: l.kind })),
    });
    store.on("view3d", () => post({ type: "view", view: store.view3d ? "3d" : "2d" }));
    store.on("selection", () => post({ type: "selection", objects: this.selectedObjects() }));
    window.addEventListener("message", (e) => this.onMessage(e));
  }

  /** Shows the 3D view with the address's render mode and, on the first show, its start view and its turn. */
  private async enter3d(first: boolean): Promise<void> {
    const { ctx, o } = this;
    const v = await ctx.show3d();
    if (!v) {
      // WebGL is missing: the drawing stays in 2D, and 3D is no longer offered
      this.can3d = false;
      return;
    }
    // a drawing with nothing to model in 3D stays in 2D
    if (v.modelFaces().length === 0 && v.visibleContent().length === 0) {
      this.can3d = false;
      ctx.show2d();
      return;
    }
    // set on this page only (setMode does not save it, unlike setRenderMode)
    if (o.render) v.setMode(o.render);
    ctx.setTool("select");
    if (!first) return;
    if (o.cam) v.lookFrom(vec(o.cam.position), vec(o.cam.target));
    else v.setView(o.preset ?? "iso");
    if (o.rotate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) this.setTurning(true);
  }

  /** Back to the 2D drawing, with the turn stopped and the pan tool back. */
  private leave3d(): void {
    this.setTurning(false);
    this.ctx.show2d();
    this.ctx.setTool("pan");
  }

  /** Chooses a layer or sheet. A sheet leaves the 3D view, since a sheet is a page; then the view is fitted. */
  private pickLayer(id: string): void {
    const sheet = this.ctx.scene.layer(id)?.kind === "sheet";
    setActiveLayer(id);
    if (sheet && store.view3d) this.leave3d();
    this.ctx.fit();
  }

  /** Starts or stops the slow turn of the 3D view. It can only start in 3D. */
  private setTurning(on: boolean): void {
    if (on === this.turning || (on && !store.view3d)) return;
    this.turning = on;
    if (on) {
      this.last = performance.now();
      this.frame = requestAnimationFrame((now) => this.spin(now));
    } else {
      cancelAnimationFrame(this.frame);
    }
    this.chrome?.update(this.state());
  }

  /** One frame of the turn: the view moves on by the time since the last frame. */
  private spin(now: number): void {
    const v = store.view3d ? this.ctx.view3d() : null;
    if (!this.turning || !v) {
      this.setTurning(false);
      return;
    }
    const seconds = Math.min(MAX_TURN_STEP_SECONDS, (now - this.last) / 1000);
    this.last = now;
    v.rotateView(0, 0, TURN_DEGREES_PER_SECOND * seconds);
    this.frame = requestAnimationFrame((t) => this.spin(t));
  }

  /** Runs one action after the ones before it, then brings the controls up to date. */
  private act(task: () => void | Promise<void>): void {
    this.queue = this.queue
      .then(task)
      .catch((err: unknown) => console.warn("openvwx: embed", err))
      .then(() => this.chrome?.update(this.state()));
  }

  /** Carries out one host message. */
  private async apply(m: HostMessage): Promise<void> {
    switch (m.type) {
      case "setView":
        if (m.view === "3d") {
          await this.enter3d(false);
          if (m.preset && store.view3d) this.ctx.view3d()?.setView(m.preset);
        } else {
          this.leave3d();
        }
        return;
      case "fit":
        this.ctx.fit();
        return;
      case "rotate":
        this.setTurning(m.on);
        return;
      case "layer": {
        const layer = findLayer(this.ctx.scene.layers(), m.layer);
        if (layer) this.pickLayer(layer.id);
        return;
      }
    }
  }

  /** Accepts a command only from the page that frames this one; a message from anywhere else is ignored. */
  private onMessage(e: MessageEvent): void {
    if (window.parent === window || e.source !== window.parent) return;
    const m = parseHostMessage(e.data);
    if (m) this.act(() => this.apply(m));
  }

  /** What the controls show now. */
  private state(): ChromeState {
    return {
      view: store.view3d ? "3d" : "2d",
      can3d: this.can3d,
      rotating: this.turning,
      layers: layerChoices(this.ctx.scene.layers()),
      layerId: store.activeLayerId,
    };
  }

  /** The first selected objects, as the host page reads them: id, name, type, layer and class name. */
  private selectedObjects(): SelectedObject[] {
    const doc = store.session?.doc;
    if (!doc) return [];
    return [...store.selection].slice(0, MAX_SELECTED).flatMap((id) => {
      const obj = doc.object(id);
      if (!obj) return [];
      return [
        {
          id: obj.id,
          name: obj.name ?? "",
          type: obj.typeName,
          layer: this.ctx.scene.layer(obj.layerId)?.name ?? "",
          className: obj.className,
        },
      ];
    });
  }
}

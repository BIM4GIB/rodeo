// Follow mode: your view follows a collaborator's (their plan view in 2D, their camera in 3D)
// until you move your own view, press Esc, or click the banner over the drawing. The banner
// names them in their colour.

import { setActiveLayer } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import type { AppContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import type { View3D } from "../../app/view3d.ts";
import type { Presence } from "../../platform/protocol.ts";
import { collab } from "./engine.ts";
import { followedId, isQuiet, onLive, peerColor, quietly, setFollowed, view3d } from "./live.ts";

let app: AppContext | null = null;
let banner: HTMLElement | null = null;
let bannerText: HTMLElement | null = null;
/** a 3D view is being shown for a follow */
let showing = false;

/** Starts following a collaborator, or stops when they are the one followed. */
export function toggleFollow(clientId: string): void {
  if (followedId() === clientId) {
    setFollowed(null);
    return;
  }
  setFollowed(clientId);
  applyFollow();
}

export function stopFollow(): void {
  setFollowed(null);
}

/** A view change the user made (not one a follow made) stops following. */
export function userMoved(): void {
  if (!isQuiet()) setFollowed(null);
}

const SAME = 1e-9;

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME * Math.max(1, Math.abs(a), Math.abs(b));
}

function followView(ctx: AppContext, to: NonNullable<Presence["view"]>): void {
  const v = ctx.view;
  if (same(v.cx, to.cx) && same(v.cy, to.cy) && same(v.scale, to.scale)) return;
  quietly(() => {
    v.setCenterAndScale(to.cx, to.cy, to.scale);
    store.emit("view");
  });
  ctx.requestDraw();
}

function followCamera(v: View3D, position: readonly number[], target: readonly number[]): void {
  const p = v.activeCamera.position;
  const t = v.orbitTarget;
  const still = same(p.x, position[0]) && same(p.y, position[1]) && same(p.z, position[2]) && same(t.x, target[0]) && same(t.y, target[1]) && same(t.z, target[2]);
  if (still) return;
  quietly(() => v.lookFrom({ x: position[0], y: position[1], z: position[2] }, { x: target[0], y: target[1], z: target[2] }));
}

/** Shows the 3D view for a followed collaborator who is in it, then follows them there. */
function show3dFor(ctx: AppContext): void {
  if (showing) return;
  showing = true;
  ctx.show3d().then(
    (v) => {
      showing = false;
      if (v) applyFollow();
      else setFollowed(null);
    },
    () => {
      showing = false;
      setFollowed(null);
    },
  );
}

/** Moves the view or camera to the followed collaborator's, and their layer. Called as they move. */
export function applyFollow(): void {
  const id = followedId();
  const s = collab();
  const ctx = app;
  if (!id || !s || !ctx) return;
  if (!s.peers().some((p) => p.clientId === id)) {
    setFollowed(null);
    return;
  }
  const pr = s.presence(id);
  if (!pr) return;
  if (pr.layerId && pr.layerId !== store.activeLayerId && store.session?.doc.layers().some((l) => l.id === pr.layerId)) {
    setActiveLayer(pr.layerId);
  }
  if (pr.mode === "3d") {
    if (!store.view3d) {
      show3dFor(ctx);
      return;
    }
    const v = view3d();
    if (v && pr.camera) followCamera(v, pr.camera.position, pr.camera.target);
  } else if (!store.view3d && pr.view) {
    followView(ctx, pr.view);
  }
}

/** The banner over the drawing, the canvas's pointer and wheel stop a follow, and Esc too. */
export function mountFollow(ctx: AppContext): void {
  app = ctx;
  bannerText = h("span", { cls: "collab-follow-text" });
  banner = h("div", { cls: "collab-follow", title: "Stop following", hidden: true }, bannerText);
  banner.addEventListener("click", stopFollow);
  ctx.canvas.parentElement?.append(banner);
  ctx.canvas.addEventListener("pointerdown", stopFollow);
  ctx.canvas.addEventListener("wheel", stopFollow, { passive: true });
  onLive(renderBanner);
  renderBanner();
}

function renderBanner(): void {
  const b = banner;
  const text = bannerText;
  if (!b || !text) return;
  const id = followedId();
  const peer = id ? collab()?.peers().find((p) => p.clientId === id) : undefined;
  b.hidden = !peer;
  if (!peer) return;
  b.style.setProperty("--peer", peerColor(peer.color));
  text.textContent = `Following ${peer.name} · Esc to stop`;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && followedId() !== null) stopFollow();
});

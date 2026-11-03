// Shared pieces of the collab feature: the change listeners the parts redraw from, who is
// followed, the peers' colours and initials, and the DOM and canvas helpers they share.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import type { View3D } from "../../app/view3d.ts";
import type { Peer, Role } from "../../platform/protocol.ts";

const listeners = new Set<() => void>();

/** Calls `fn` whenever the live session, its peers, their status or who is followed changes. */
export function onLive(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitLive(): void {
  for (const fn of [...listeners]) fn();
}

let followed: string | null = null;

/** The clientId of the collaborator being followed, or null. */
export function followedId(): string | null {
  return followed;
}

export function setFollowed(clientId: string | null): void {
  if (followed === clientId) return;
  followed = clientId;
  emitLive();
}

// A follow moves the view itself: those changes run quietly, so they do not stop the follow.
let quiet = 0;

export function quietly(change: () => void): void {
  quiet++;
  try {
    change();
  } finally {
    quiet--;
  }
}

export function isQuiet(): boolean {
  return quiet > 0;
}

/** The 3D view if it has been created. */
export function view3d(): View3D | null {
  return appContext()?.view3d() ?? null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A peer's colour, as the server gives it (a hex colour), or grey. */
export function peerColor(color: string): string {
  return HEX.test(color) ? color : "#8e8e93";
}

/** Dark or light ink, whichever reads on the colour. */
export function inkFor(color: string): string {
  const c = peerColor(color);
  const lum = 0.299 * parseInt(c.slice(1, 3), 16) + 0.587 * parseInt(c.slice(3, 5), 16) + 0.114 * parseInt(c.slice(5, 7), 16);
  return lum > 150 ? "#111111" : "#ffffff";
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "editor":
      return "Editor";
    case "reviewer":
      return "Reviewer";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}

/** Up to two letters for a name without a picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

/** The avatar picture, when it is a web address (anything else is not shown). */
function avatarSrc(url: string | null): string | null {
  return url !== null && /^https?:\/\//.test(url) ? url : null;
}

function face(p: Peer): HTMLElement {
  const fallback = (): HTMLElement => h("span", { cls: "collab-initials", text: initials(p.name) });
  const src = avatarSrc(p.avatarUrl);
  if (!src) return fallback();
  const img = h("img", { attrs: { src, alt: "" } });
  img.addEventListener("error", () => img.replaceWith(fallback()));
  return img;
}

/** A peer's avatar: a picture or initials, ringed in their colour. `tag` says whether it is a button. */
export function avatarEl(p: Peer, tag: "button" | "span", extra = ""): HTMLElement {
  const el = h(tag, {
    cls: ["collab-avatar", extra].filter(Boolean).join(" "),
    title: `${p.name} · ${roleLabel(p.role)}`,
    attrs: tag === "button" ? { type: "button" } : {},
  });
  el.style.setProperty("--peer", peerColor(p.color));
  el.append(face(p));
  return el;
}

/** A rounded rectangle as a path on a 2D context (for pills), with corner radius r. */
export function pillPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hgt, r);
  g.arcTo(x + w, y + hgt, x, y + hgt, r);
  g.arcTo(x, y + hgt, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// The top bar's collaboration end: everyone in the drawing as overlapping avatars (you first;
// click a collaborator's avatar to follow them), a status dot, and Invite for an editor.
// Hidden without a live session.

import { h } from "../../app/dom.ts";
import { CAN_EDIT } from "../../platform/protocol.ts";
import { openShareDialog } from "../cloud/share.ts";
import { collab, type CollabSession, type CollabStatus } from "./engine.ts";
import { toggleFollow } from "./follow.ts";
import { avatarEl, followedId, onLive } from "./live.ts";

/** avatars shown before the rest are counted */
const MAX_AVATARS = 5;

const STATUS_TEXT: Record<CollabStatus, string> = {
  live: "Live",
  connecting: "Connecting…",
  offline: "Offline",
};

export function buildTopBar(): HTMLElement {
  const root = h("div", { cls: "collab-bar", hidden: true });
  let shown: string | null = null;
  const render = (): void => {
    const s = collab();
    root.hidden = !s;
    const key = s ? keyOf(s) : "";
    if (key === shown) return;
    shown = key;
    root.replaceChildren(...(s ? contents(s) : []));
  };
  onLive(render);
  render();
  return root;
}

/** What the bar shows, so presence moving (which is most of the traffic) does not rebuild it. */
function keyOf(s: CollabSession): string {
  return JSON.stringify([s.fileId, s.role, s.status(), followedId(), s.you, s.peers()]);
}

function contents(s: CollabSession): HTMLElement[] {
  const peers = s.peers();
  const followed = followedId();
  const avatars = peers.slice(0, MAX_AVATARS).map((p) => {
    const on = p.clientId === followed;
    const el = avatarEl(p, "button", on ? "following" : "");
    el.setAttribute("aria-pressed", String(on));
    el.addEventListener("click", () => toggleFollow(p.clientId));
    return el;
  });
  const hidden = peers.length - MAX_AVATARS;
  const group = h(
    "div",
    { cls: "collab-avatars" },
    avatarEl(s.you, "span", "self"),
    ...avatars,
    hidden > 0 ? h("span", { cls: "collab-avatar collab-more", text: `+${hidden}`, title: `${hidden} more in this drawing` }) : null,
  );
  const status = s.status();
  const dot = h("span", { cls: `collab-dot ${status}`, title: `Live collaboration: ${STATUS_TEXT[status]}` });
  const nodes: HTMLElement[] = [group, dot];
  if (CAN_EDIT.includes(s.role)) {
    const invite = h("button", { cls: "tb-btn collab-invite", text: "Invite", title: "Invite people to this drawing", attrs: { type: "button" } });
    invite.addEventListener("click", () => openShareDialog(s.fileId));
    nodes.push(invite);
  }
  return nodes;
}

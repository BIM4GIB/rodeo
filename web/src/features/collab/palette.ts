// Window > Collaborators: a palette listing everyone in the drawing, what each is on (their
// layer, and 2D or 3D), and Follow or Stop for each.

import type { PaletteSpec } from "../../app/dock.ts";
import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { PALETTE_ICON } from "../../app/icons.ts";
import type { Row } from "../../app/menu.ts";
import { store } from "../../app/state.ts";
import { collab, type CollabSession } from "./engine.ts";
import { toggleFollow } from "./follow.ts";
import { avatarEl, followedId, onLive, roleLabel } from "./live.ts";

export const PALETTE_ID = "collab";

/** The palette, hidden until Window > Collaborators shows it. */
export function collaboratorsPalette(): PaletteSpec {
  const body = h("div", { cls: "panel-body collab-palette" });
  let shown: string | null = null;
  const render = (): void => {
    const s = collab();
    const key = s ? keyOf(s) : "";
    if (key === shown) return;
    shown = key;
    body.replaceChildren(...(s ? rowsOf(s) : [h("p", { cls: "collab-empty", text: "Live collaboration starts when a cloud drawing is open." })]));
  };
  onLive(render);
  render();
  return { id: PALETTE_ID, title: "Collaborators", body, side: "right", icon: PALETTE_ICON.people, hidden: true };
}

/** The Window menu's row, which shows and hides the palette. */
export function windowRows(): readonly Row[] {
  return [
    {
      label: "Collaborators",
      checked: () => appContext()?.palettes.isShown(PALETTE_ID) ?? false,
      run: () => appContext()?.palettes.toggle(PALETTE_ID),
    },
  ];
}

function keyOf(s: CollabSession): string {
  return JSON.stringify([s.fileId, s.role, s.status(), followedId(), s.you, s.peers(), s.peers().map((p) => whereOf(s, p.clientId))]);
}

function whereOf(s: CollabSession, clientId: string): string {
  const pr = s.presence(clientId);
  if (!pr) return "Joining…";
  const place = pr.mode === "3d" ? "3D" : "2D";
  const layer = pr.layerId ? store.session?.doc.layers().find((l) => l.id === pr.layerId)?.name : undefined;
  return layer ? `${layer} · ${place}` : place;
}

function rowsOf(s: CollabSession): HTMLElement[] {
  const followed = followedId();
  const out: HTMLElement[] = [row(avatarEl(s.you, "span"), `${s.you.name} (you)`, roleLabel(s.you.role), null)];
  if (s.peers().length === 0) out.push(h("p", { cls: "collab-empty", text: "No one else is in this drawing." }));
  for (const p of s.peers()) {
    const on = p.clientId === followed;
    const action = h("button", {
      cls: "btn",
      text: on ? "Stop" : "Follow",
      title: on ? "Stop following" : `Follow ${p.name}`,
      attrs: { type: "button" },
    });
    action.addEventListener("click", () => toggleFollow(p.clientId));
    out.push(row(avatarEl(p, "span"), p.name, `${roleLabel(p.role)} · ${whereOf(s, p.clientId)}`, action));
  }
  return out;
}

function row(avatar: HTMLElement, name: string, detail: string, action: HTMLElement | null): HTMLElement {
  return h(
    "div",
    { cls: "collab-row" },
    avatar,
    h("div", { cls: "collab-who" }, h("span", { cls: "collab-name", text: name, title: name }), h("span", { cls: "collab-where", text: detail })),
    action,
  );
}

// Project Sharing, as Vectorworks has it for a drawing several people work on: a member checks
// layers out to change them alone, and the others can't change those layers (their edits are
// refused, naming the holder) until they are released. Layers no one holds stay open to every
// editor, live. The Layers list marks each held layer with a lock (its holder in the tooltip) and offers Check Out and
// Release on its right-click menu; File > Project Sharing… lists every layer with its holder, to
// check out or release several at once. The drawing's owner can release anyone's checkout.
// Checkouts are kept by the server and outlast a holder's connection.

import { h } from "../../app/dom.ts";
import { registerLayerExtension } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { CAN_EDIT, type Checkout } from "../../platform/protocol.ts";
import { collab, type CollabSession } from "./engine.ts";
import { emitLive } from "./live.ts";

const LOCK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';

registerLayerExtension({ mark, rows: layerRows });

function holderOf(s: CollabSession, layerId: string): Checkout | undefined {
  return s.checkouts().find((c) => c.layerId === layerId);
}

function layerName(layerId: string): string {
  return store.session?.doc.layers().find((l) => l.id === layerId)?.name ?? "a layer";
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function mark(layerId: string): { html: string; title: string; cls: string } | null {
  const s = collab();
  const k = s && holderOf(s, layerId);
  if (!s || !k) return null;
  const mine = k.userId === s.you.userId;
  // a lock alone, in the accent colour for one's own and amber for another's, leaves the name its room
  return {
    html: LOCK,
    title: mine ? "Checked out by you: only you can change this layer" : `Checked out by ${k.name}: only they can change this layer`,
    cls: mine ? "mine" : "theirs",
  };
}

/** The layer's Check Out or Release row, in a live drawing the member can change. */
function layerRows(layerId: string): Row[] {
  const s = collab();
  if (!s) return [];
  const k = holderOf(s, layerId);
  if (!CAN_EDIT.includes(s.role)) return k ? [{ label: `Checked Out by ${k.name}`, enabled: () => false, run: () => {} }] : [];
  if (!k) return [{ label: "Check Out Layer", run: () => checkOut(s, [layerId]) }];
  if (k.userId === s.you.userId) return [{ label: "Release Layer", run: () => release(s, [layerId]) }];
  if (s.role === "owner") return [{ label: `Release ${firstName(k.name)}’s Checkout`, run: () => release(s, [layerId]) }];
  return [{ label: `Checked Out by ${k.name}`, enabled: () => false, run: () => {} }];
}

/** layers this client asked to release, so their going isn't announced as someone else's doing */
const releasing = new Set<string>();

function checkOut(s: CollabSession, layerIds: readonly string[]): void {
  if (!layerIds.length) return;
  if (!s.checkOut(layerIds)) toast("Not connected: check out again once live collaboration is back.", "error");
}

function release(s: CollabSession, layerIds: readonly string[]): void {
  if (!layerIds.length) return;
  for (const id of layerIds) releasing.add(id);
  if (!s.release(layerIds)) {
    for (const id of layerIds) releasing.delete(id);
    toast("Not connected: release again once live collaboration is back.", "error");
  }
}

/** Ties the Layers list and the notices to a live session's checkouts; returns a function that unties them. */
export function attachSharing(s: CollabSession): () => void {
  let before = new Map(s.checkouts().map((c) => [c.layerId, c]));
  const changed = (): void => {
    const now = new Map(s.checkouts().map((c) => [c.layerId, c]));
    const taken = [...now.values()].filter((c) => c.userId !== s.you.userId && before.get(c.layerId)?.userId !== c.userId);
    for (const [name, list] of byHolder(taken)) toast(`${name} checked out ${names(list)}`, "info");
    const lost = [...before.values()].filter((c) => c.userId === s.you.userId && !now.has(c.layerId) && !releasing.has(c.layerId));
    if (lost.length) toast(`Your checkout of ${names(lost)} was released by the drawing’s owner`, "info");
    for (const id of [...releasing]) if (!now.has(id)) releasing.delete(id);
    before = now;
    store.emit("layer");
    emitLive();
  };
  const off = s.onCheckouts(changed);
  store.emit("layer");
  return () => {
    off();
    releasing.clear();
    // the marks go with the session
    store.emit("layer");
  };
}

function byHolder(list: readonly Checkout[]): Map<string, Checkout[]> {
  const out = new Map<string, Checkout[]>();
  for (const c of list) out.set(c.name, [...(out.get(c.name) ?? []), c]);
  return out;
}

function names(list: readonly Checkout[]): string {
  const all = list.map((c) => layerName(c.layerId));
  return all.length <= 3 ? all.join(", ") : `${all.slice(0, 2).join(", ")} and ${all.length - 2} more layers`;
}

/** File > Project Sharing…: every layer with its holder, to check out and release. */
export async function projectSharingDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const s = collab();
  if (!s) {
    await showDialog({
      title: "Project Sharing",
      okLabel: "OK",
      body: [
        h("p", {
          text: "Project Sharing works in a drawing kept in the cloud: save it with File > Save to Cloud…, invite people with File > Share > People and Links…, and each editor can check layers out here, to change them alone while the others work live on the rest.",
        }),
      ],
      check: () => ({ value: true }),
    });
    return;
  }
  const canEdit = CAN_EDIT.includes(s.role);
  const list = h("div", { cls: "sharing-list", attrs: { role: "list" } });
  const freeBtn = h("button", { cls: "btn", text: "Check Out All Free", attrs: { type: "button" } });
  const mineBtn = h("button", { cls: "btn", text: "Release All Mine", attrs: { type: "button" } });
  const layers = (): { id: string; name: string; sheet: boolean }[] =>
    (store.session?.doc.layers() ?? []).map((l) => ({ id: l.id, name: l.name, sheet: l.kind === "sheet" }));
  const render = (): void => {
    const all = layers();
    const rows = all.map((l) => {
      const k = holderOf(s, l.id);
      const mine = k?.userId === s.you.userId;
      const who = h("span", { cls: `sharing-who${k ? (mine ? " mine" : " theirs") : ""}`, text: k ? (mine ? "You" : k.name) : "—" });
      if (k) who.title = `Checked out ${new Date(k.at).toLocaleString()}`;
      let action: HTMLElement | null = null;
      if (canEdit && (!k || mine || s.role === "owner")) {
        const btn = h("button", { cls: "btn", text: !k ? "Check Out" : "Release", attrs: { type: "button" } });
        btn.addEventListener("click", () => (k ? release(s, [l.id]) : checkOut(s, [l.id])));
        action = btn;
      }
      return h(
        "div",
        { cls: "sharing-row", attrs: { role: "listitem" } },
        h("span", { cls: "sharing-name", text: l.name, title: l.name }),
        l.sheet ? h("span", { cls: "badge sheet", text: "Sheet" }) : null,
        who,
        action ?? h("span", { cls: "sharing-none" }),
      );
    });
    list.replaceChildren(...rows);
    const free = all.filter((l) => !holderOf(s, l.id));
    const mineNow = s.checkouts().filter((c) => c.userId === s.you.userId);
    freeBtn.disabled = !canEdit || free.length === 0;
    mineBtn.disabled = !canEdit || mineNow.length === 0;
  };
  freeBtn.addEventListener("click", () =>
    checkOut(
      s,
      layers()
        .filter((l) => !holderOf(s, l.id))
        .map((l) => l.id),
    ),
  );
  mineBtn.addEventListener("click", () =>
    release(
      s,
      s
        .checkouts()
        .filter((c) => c.userId === s.you.userId)
        .map((c) => c.layerId),
    ),
  );
  const off = s.onCheckouts(render);
  render();
  try {
    await showDialog({
      title: "Project Sharing",
      okLabel: "Done",
      body: [
        h("p", {
          cls: "muted",
          text: canEdit
            ? "Check a layer out to change it alone: the others can still see it, but can't change it until you release it. Layers no one holds stay open to every editor."
            : "You can view this drawing; editors check layers out to change them alone.",
        }),
        list,
        ...(canEdit ? [h("div", { cls: "sharing-actions" }, freeBtn, mineBtn)] : []),
      ],
      check: () => ({ value: true }),
    });
  } finally {
    off();
  }
}

// A comment thread in the popover: its number, the comment and its replies
// (text and voice notes), Resolve or Reopen, Delete for the author or the
// owner, and a reply box for those who may comment.

import { setActiveLayer } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { comments as api, currentUser } from "../../platform/api.ts";
import type { Comment } from "../../platform/protocol.ts";
import { anchorScreen } from "./anchor.ts";
import { composer } from "./composer.ts";
import { GLYPH } from "./glyphs.ts";
import { closePopover, showPopover } from "./popover.ts";
import { crit, type Thread } from "./state.ts";
import { focus3d } from "./view3d.ts";
import { clock, fullDate, timeAgo } from "./util.ts";

function canDelete(c: Comment): boolean {
  const me = currentUser();
  return (!!me && c.authorId === me.id) || crit.role === "owner";
}

function kindOf(t: Thread): string {
  if (t.root.strokes.length > 0) return "Redline";
  if (t.root.anchor?.kind === "3d") return "3D pin";
  return "Pin";
}

/** Opens the thread's popover beside its pin (replacing any other popover). */
export function openThread(id: string): void {
  const first = crit.thread(id);
  if (!first) return;
  const head = h("div", { cls: "crit-thread-head" });
  const list = h("div", { cls: "crit-thread-list" });
  const reply = crit.canComment
    ? composer({ label: "Reply", placeholder: "Reply…", submit: "Reply", onSubmit: (body, audio) => sendReply(id, body, audio) }).el
    : h("p", { cls: "crit-note", text: "Viewers can read comments but cannot reply." });
  const body = h("div", { cls: "crit-thread" }, head, list, reply);

  let unsubscribe = (): void => {};
  showPopover(body, "thread", () => anchorScreen(first.root.anchor), () => {
    unsubscribe();
    if (crit.selected === id) crit.selected = null;
    crit.changed();
  });
  unsubscribe = crit.subscribe(() => {
    const t = crit.thread(id);
    if (!t) {
      closePopover();
      return;
    }
    render(t);
  });
  crit.selected = id;
  render(first);
  crit.changed();

  function render(t: Thread): void {
    head.replaceChildren(headOf(t));
    list.replaceChildren(message(t.root, true), ...t.replies.map((r) => message(r, false)));
  }
}

/** The thread's title row: its number, whether it is open, and its actions. */
function headOf(t: Thread): HTMLElement {
  const root = t.root;
  const toggle = crit.canComment
    ? iconButton(root.resolved ? GLYPH.reopen : GLYPH.check, root.resolved ? "Reopen" : "Resolve", () => void setResolved(root))
    : null;
  const remove = canDelete(root) ? iconButton(GLYPH.trash, "Delete", () => void removeComment(root, true), "danger") : null;
  const close = iconButton(GLYPH.close, "Close", () => closePopover());
  return h(
    "div",
    { cls: "crit-head-row" },
    h("span", { cls: `crit-num${root.resolved ? " resolved" : ""}`, text: String(t.number) }),
    h(
      "div",
      { cls: "crit-head-text" },
      h("strong", { text: `${kindOf(t)} ${t.number}` }),
      h("span", { cls: "crit-meta", text: root.resolved ? "Resolved" : "Open" }),
    ),
    toggle,
    remove,
    close,
  );
}

function iconButton(glyph: string, label: string, run: () => void, extra = ""): HTMLElement {
  const btn = h("button", { cls: `crit-icon-btn ${extra}`.trim(), attrs: { type: "button", title: label, "aria-label": label } });
  btn.innerHTML = glyph;
  btn.addEventListener("click", run);
  return btn;
}

/** One comment: its author and time, its text, and its voice note. */
function message(c: Comment, root: boolean): HTMLElement {
  const del = canDelete(c)
    ? h("button", { cls: "crit-link danger", text: "Delete", attrs: { type: "button" } })
    : null;
  del?.addEventListener("click", () => void removeComment(c, root));
  const audio = c.audio
    ? h(
        "div",
        { cls: "crit-audio" },
        h("audio", { attrs: { controls: "", preload: "none", src: api.audioUrl(c.audio.id) } }),
        h("span", { cls: "crit-meta", text: clock(c.audio.durationMs) }),
      )
    : null;
  return h(
    "article",
    { cls: root ? "crit-msg root" : "crit-msg" },
    h(
      "header",
      { cls: "crit-msg-meta" },
      h("strong", { text: c.authorName }),
      h("time", { text: timeAgo(c.createdAt), attrs: { datetime: c.createdAt, title: fullDate(c.createdAt) } }),
      del,
    ),
    c.body ? h("p", { cls: "crit-msg-body", text: c.body }) : null,
    audio,
  );
}

async function sendReply(parentId: string, body: string, audio: NonNullable<Comment["audio"]> | null): Promise<void> {
  const fileId = crit.fileId;
  if (!fileId) throw new Error("This drawing is not in the cloud.");
  crit.upsert(await api.add(fileId, { parentId, body, anchor: null, strokes: [], audio }));
}

async function setResolved(root: Comment): Promise<void> {
  try {
    crit.upsert(await api.update(root.id, { resolved: !root.resolved }));
  } catch (err) {
    toast(`Could not change the thread: ${errorMessage(err)}`);
  }
}

async function removeComment(c: Comment, root: boolean): Promise<void> {
  const ok = await confirmDialog(
    root ? "Delete comment" : "Delete reply",
    root ? "Delete this comment and its replies? This cannot be undone." : "Delete this reply? This cannot be undone.",
    "Delete",
  );
  if (!ok) return;
  try {
    await api.remove(c.id);
    crit.remove(c.id);
  } catch (err) {
    toast(`Could not delete: ${errorMessage(err)}`);
  }
}

/** Opens a thread from the list: centres the view on its pin (keeping the scale), makes its layer active, and opens it. */
export function focusThread(id: string): void {
  const t = crit.thread(id);
  if (!t) return;
  const ctx = appContext();
  const a = t.root.anchor;
  if (ctx && a?.kind === "2d") {
    if (store.activeLayerId !== a.layerId && ctx.scene.layer(a.layerId)) setActiveLayer(a.layerId);
    if (!store.view3d) {
      ctx.view.setCenterAndScale(a.x, a.y, ctx.view.scale);
      store.emit("view");
      ctx.requestDraw();
    }
  } else if (a?.kind === "3d" && store.view3d) {
    focus3d(a);
  }
  openThread(id);
}

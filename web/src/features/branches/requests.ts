// Merge requests in the editor: the Merge Requests palette, listing the family's requests (open
// ones first), and a request's detail with its approvals, its discussion and the buttons its author,
// the owner, editors and reviewers may press. A request's discussion is the branch drawing's
// general comments (crit's comments with no anchor). Merging is in mergeFlow.ts. review.ts
// registers the palette and its menu rows.

import type { PaletteSpec } from "../../app/dock.ts";
import { h, nextPaint } from "../../app/dom.ts";
import { appContext, documentSource } from "../../app/ext.ts";
import { confirmDialog, showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { comments, currentUser, files } from "../../platform/api.ts";
import { CAN_COMMENT, CAN_EDIT, type Comment } from "../../platform/protocol.ts";
import { setCritMode } from "../crit/mode.ts";
import { cloudCall, explainFailure, isVersionSource, onCloudChanged, openCloudFile } from "../cloud/cloud.ts";
import { field, note, timeAgo } from "../cloud/ui.ts";
import { branches, mergeRequests } from "./api.ts";
import { startCompare } from "./compare.ts";
import { diffDocuments } from "./diff.ts";
import { type FamilyState, familyState, onBranch, onFamily } from "./family.ts";
import { MERGE } from "./glyphs.ts";
import { deleteBranch, mergeRequest } from "./mergeFlow.ts";
import { MERGE_BODY_MAX, MERGE_TITLE_MAX, type MergeRequest, type MergeState } from "./wire.ts";

/** The palette's id, for Window > Palettes and for showing it. */
export const REQUESTS_PALETTE_ID = "branches-requests";
/** Most characters of a comment a reply or a new comment takes here (the server cuts at the same length). */
const COMMENT_MAX = 4000;
const STATE_TEXT: Record<MergeState, string> = { open: "Open", merged: "Merged", closed: "Closed" };

/** What the palette shows: the list, or one request by its id. */
type View = { readonly kind: "list" } | { readonly kind: "detail"; readonly id: string };

const body = h("div", { cls: "br-reqs" });

/** The Merge Requests palette: on the right, hidden until it is opened. */
export const requestsPalette: PaletteSpec = {
  id: REQUESTS_PALETTE_ID,
  title: "Merge Requests",
  body,
  side: "right",
  icon: MERGE,
  hidden: true,
  fill: true,
};

let view: View = { kind: "list" };
/** the family's requests as last read, open ones first */
let requests: MergeRequest[] = [];
/** the family whose requests are in `requests`, or null before the first read */
let loadedFor: string | null = null;
/** true while the palette is on screen: the requests are read only then */
let shown = false;
/** counts the reads, so a slow one that ends late does not replace a newer list */
let reads = 0;

// the palette's body is on screen when it intersects the window (a rolled-up or hidden one does not)
new IntersectionObserver((entries) => {
  shown = entries.some((e) => e.isIntersecting);
  if (shown) void refresh();
}).observe(body);
onFamily(() => void refresh());
onCloudChanged(() => void refresh());

/** Opens the Merge Requests palette (File › Branches › Merge Requests). */
export function showRequests(): void {
  appContext()?.palettes.show(REQUESTS_PALETTE_ID);
  void refresh();
}

/** File › Branches › New Merge Request…: names the request, shows what changed, and asks to merge the open branch. */
export async function newMergeRequest(): Promise<void> {
  const s = familyState();
  const ctx = appContext();
  if (!s || s.current.main || !ctx) return;
  if (!CAN_EDIT.includes(s.family.role)) {
    toast("Only the owner or an editor can ask to merge.", "info");
    return;
  }
  const branchId = s.fileId;
  const title = h("input", {
    cls: "menu-dialog-input",
    value: s.current.name,
    attrs: { type: "text", maxlength: String(MERGE_TITLE_MAX), "aria-label": "Title" },
  });
  const text = h("textarea", {
    cls: "menu-dialog-input br-body",
    attrs: { rows: "4", maxlength: String(MERGE_BODY_MAX), "aria-label": "Description" },
  });
  const counts = h("p", { cls: "menu-dialog-text", text: "Working out what changed…" });
  const asked = showDialog<{ title: string; body: string }>({
    title: "New merge request",
    okLabel: "Ask to Merge",
    body: [field("Title", title), field("Description", text), counts],
    check: () => {
      const t = title.value.trim();
      if (!t) return { error: "Give the merge request a title.", focus: title };
      return { value: { title: t, body: text.value.trim() } };
    },
  });
  void countChanges(branchId, counts);
  const ask = await asked;
  if (!ask) return;
  // the request covers the saved branch, so unsaved changes are saved first
  if (store.session?.dirty) {
    try {
      await ctx.save();
    } catch (err) {
      toast(`The request was not sent, because the drawing was not saved: ${errorMessage(err)}`);
      return;
    }
  }
  const made = await cloudCall("Asking to merge…", "New merge request", () => mergeRequests.create(branchId, ask.title, ask.body));
  if (!made) return;
  view = { kind: "detail", id: made.id };
  showRequests();
}

/** Writes what changed since the branch started, as object counts, into `line`. */
async function countChanges(branchId: string, line: HTMLElement): Promise<void> {
  try {
    const [base, head] = await Promise.all([branches.base(branchId), files.content(branchId)]);
    // the comparison is heavy for a big drawing: the dialog is painted first
    await nextPaint();
    const diff = diffDocuments(base, head.bytes);
    const objects = (items: readonly { readonly what: string }[]): number => items.filter((i) => i.what === "object").length;
    line.textContent = `${objects(diff.added)} added, ${objects(diff.removed)} removed, ${objects(diff.changed)} changed since this branch started.`;
  } catch (err) {
    line.textContent = `Could not work out the changes: ${errorMessage(err)}`;
  }
}

/** Reads the family's requests into the palette, when it is on screen. */
async function refresh(): Promise<void> {
  if (!shown) return;
  const mine = ++reads;
  const s = familyState();
  if (!s) {
    body.replaceChildren(note("Open a cloud drawing to see its merge requests."));
    return;
  }
  let list: MergeRequest[];
  try {
    list = await mergeRequests.list(s.family.rootId, true);
  } catch (err) {
    if (mine === reads) body.replaceChildren(note(`Could not load the merge requests: ${errorMessage(err)}`));
    return;
  }
  if (mine !== reads) return;
  requests = list;
  loadedFor = s.family.rootId;
  render();
}

/** Shows the list, or the open request's detail, from what was last read. */
function render(): void {
  const s = familyState();
  if (!s) return;
  if (loadedFor !== s.family.rootId) {
    body.replaceChildren(note("Loading the merge requests…"));
    return;
  }
  const now = view;
  const current = now.kind === "detail" ? requests.find((r) => r.id === now.id) : undefined;
  if (now.kind === "detail" && !current) view = { kind: "list" };
  body.replaceChildren(current ? detailView(current, s) : listView(s));
}

/** Opens a request's detail, or the list, and reads again. */
function setView(next: View): void {
  view = next;
  render();
  void refresh();
}

/** The list: one row per request, and New Merge Request… when the open drawing is a branch the caller may edit. */
function listView(s: FamilyState): HTMLElement {
  const rows = requests.map((r) => h("li", {}, requestRow(r)));
  const canAsk = onBranch() && CAN_EDIT.includes(s.family.role) && !isVersionSource(documentSource());
  return h(
    "div",
    { cls: "br-reqs-list" },
    rows.length > 0 ? h("ul", { cls: "br-req-list" }, ...rows) : note("No merge requests yet."),
    canAsk ? h("div", { cls: "br-foot" }, button("New Merge Request…", "btn", () => void newMergeRequest())) : null,
  );
}

/** One request in the list: its state, title, and who asked, when, and how many approved it. */
function requestRow(r: MergeRequest): HTMLButtonElement {
  const count = r.approvals.length;
  const meta = [r.branchName, r.author?.name ?? "Former member", timeAgo(r.createdAt), count === 1 ? "1 approval" : count > 1 ? `${count} approvals` : ""]
    .filter((part) => part !== "")
    .join(" · ");
  const row = h(
    "button",
    { cls: "br-req-row", attrs: { type: "button" } },
    stateChip(r.state),
    h("span", { cls: "br-req-text" }, h("span", { cls: "br-req-title", text: r.title }), h("span", { cls: "br-req-meta", text: meta })),
  );
  row.addEventListener("click", () => setView({ kind: "detail", id: r.id }));
  return row;
}

/** A request's state as a solid chip. */
function stateChip(state: MergeState): HTMLElement {
  return h("span", { cls: `br-state br-state-${state}`, text: STATE_TEXT[state] });
}

/** The detail of one request: its text, approvals, the actions the caller may take, and the discussion. */
function detailView(r: MergeRequest, s: FamilyState): HTMLElement {
  const me = currentUser()?.id ?? null;
  const role = s.family.role;
  const mine = me !== null && r.author?.id === me;
  const approvedByMe = me !== null && r.approvals.some((a) => a.user.id === me);
  const branch = s.family.branches.find((b) => b.fileId === r.sourceFileId);
  const open = r.state === "open";
  const thread = h("div", { cls: "br-thread" }, note("Loading the discussion…"));
  const crit = h("p", { cls: "br-note" });

  const actions: HTMLElement[] = [];
  if (branch) actions.push(button("Review Changes", "btn", () => void reviewChanges(r)));
  if (open && CAN_COMMENT.includes(role) && !mine) {
    actions.push(
      approvedByMe
        ? button("Withdraw Approval", "btn", () => void act("Withdrawing…", "Withdraw approval", () => mergeRequests.unapprove(r.id)))
        : button("Approve", "btn", () => void act("Approving…", "Approve", () => mergeRequests.approve(r.id))),
    );
  }
  if (open && CAN_EDIT.includes(role)) actions.push(button("Merge…", "btn primary", () => void mergeRequest(r)));
  if (r.state !== "merged" && (role === "owner" || mine)) {
    if (open) actions.push(button("Close", "btn", () => void act("Closing…", "Close", () => mergeRequests.edit(r.id, { state: "closed" }))));
    else actions.push(button("Reopen", "btn", () => void act("Reopening…", "Reopen", () => mergeRequests.edit(r.id, { state: "open" }))));
  }
  if (r.state === "merged" && branch && (role === "owner" || (me !== null && branch.createdBy?.id === me))) {
    actions.push(button("Delete Branch", "btn", () => void removeBranch(r)));
  }

  const meta = [`Branch ${r.branchName}`, r.author ? `Asked by ${r.author.name}` : "", timeAgo(r.createdAt)].filter((p) => p !== "").join(" · ");
  const approvals = r.approvals.map((a) =>
    h("div", { cls: "br-approval", text: `Approved by ${a.user.name}${a.current ? "" : " (on an older version)"}` }),
  );
  const merged =
    r.state === "merged" && r.mergedBy ? h("p", { cls: "br-note", text: `Merged by ${r.mergedBy.name}${r.mergedAt ? ` · ${timeAgo(r.mergedAt)}` : ""}` }) : null;
  void loadDiscussion(r, thread, crit);

  return h(
    "div",
    { cls: "br-detail" },
    button("‹ All requests", "br-link br-back", () => setView({ kind: "list" })),
    h("div", { cls: "br-detail-head" }, stateChip(r.state), h("h3", { cls: "br-detail-title", text: r.title })),
    h("p", { cls: "br-note", text: meta }),
    merged,
    r.body ? h("p", { cls: "br-detail-body", text: r.body }) : null,
    h("div", { cls: "br-section", text: "Approvals" }),
    ...(approvals.length > 0 ? approvals : [note("No approvals yet.")]),
    actions.length > 0 ? h("div", { cls: "br-actions" }, ...actions) : null,
    h("div", { cls: "br-crit" }, crit, branch ? button("Open in Crit Mode", "btn", () => void openCrit(r)) : null),
    h("div", { cls: "br-section", text: "Discussion" }),
    thread,
    CAN_COMMENT.includes(role) ? composer(r, thread, crit) : null,
  );
}

/** The box for a new general comment on the request's discussion. */
function composer(r: MergeRequest, thread: HTMLElement, crit: HTMLElement): HTMLElement {
  const input = h("textarea", { cls: "menu-dialog-input br-body", attrs: { rows: "2", maxlength: String(COMMENT_MAX), "aria-label": "Comment" } });
  const send = button("Comment", "btn", () => void post(r, input, null, thread, crit));
  return h("div", { cls: "br-reply" }, input, send);
}

/** Reads the branch's general comments into `thread`, and counts its anchored comments (pins and red-lines) into `crit`. */
async function loadDiscussion(r: MergeRequest, thread: HTMLElement, crit: HTMLElement): Promise<void> {
  let all: Comment[];
  try {
    all = await comments.list(r.sourceFileId);
  } catch (err) {
    thread.replaceChildren(note(`Could not load the discussion: ${errorMessage(err)}`));
    return;
  }
  const anchored = all.filter((c) => c.anchor !== null).length;
  crit.textContent = `${anchored} ${anchored === 1 ? "comment" : "comments"} on the drawing`;
  const general = all.filter((c) => c.anchor === null).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const roots = general.filter((c) => c.parentId === null);
  if (roots.length === 0) {
    thread.replaceChildren(note("No comments yet."));
    return;
  }
  const canReply = CAN_COMMENT.includes(familyState()?.family.role ?? "viewer");
  thread.replaceChildren(
    h(
      "ol",
      { cls: "br-thread-list" },
      ...roots.map((root) => {
        const replies = general.filter((c) => c.parentId === root.id);
        const item = h(
          "li",
          { cls: "br-comment-root" },
          commentBox(root),
          replies.length > 0 ? h("ol", { cls: "br-replies" }, ...replies.map((c) => h("li", {}, commentBox(c)))) : null,
        );
        if (canReply) {
          const reply = button("Reply", "br-link", () => {
            if (item.querySelector(".br-reply")) return;
            item.append(replyBox(r, root.id, thread, crit));
          });
          item.append(reply);
        }
        return item;
      }),
    ),
  );
}

/** One comment: who wrote it, when, and the body as text (never as markup). */
function commentBox(c: Comment): HTMLElement {
  return h(
    "div",
    { cls: "br-comment" },
    h("div", { cls: "br-comment-head", text: `${c.authorName} · ${timeAgo(c.createdAt)}` }),
    h("div", { cls: "br-comment-body", text: c.body }),
  );
}

/** The box that replies to a comment on the request's discussion. */
function replyBox(r: MergeRequest, parentId: string, thread: HTMLElement, crit: HTMLElement): HTMLElement {
  const input = h("textarea", { cls: "menu-dialog-input br-body", attrs: { rows: "2", maxlength: String(COMMENT_MAX), "aria-label": "Reply" } });
  const send = button("Reply", "btn", () => void post(r, input, parentId, thread, crit));
  return h("div", { cls: "br-reply" }, input, send);
}

/** Posts a general comment or a reply, then reads the discussion again. */
async function post(r: MergeRequest, input: HTMLTextAreaElement, parentId: string | null, thread: HTMLElement, crit: HTMLElement): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  try {
    await comments.add(r.sourceFileId, { parentId, body: text, anchor: null, strokes: [], audio: null });
  } catch (err) {
    await explainFailure("Comment", err);
    return;
  }
  input.value = "";
  await loadDiscussion(r, thread, crit);
}

/** Runs one request action behind the overlay, then reads the palette again. */
async function act(label: string, action: string, run: () => Promise<MergeRequest>): Promise<void> {
  const changed = await cloudCall(label, action, run);
  if (changed) void refresh();
}

/** Review Changes: opens the branch and compares it with where it started. */
async function reviewChanges(r: MergeRequest): Promise<void> {
  if (!(await openCloudFile(r.sourceFileId))) return;
  const base = await cloudCall("Reading the starting point…", "Review changes", () => branches.base(r.sourceFileId));
  if (base) await startCompare({ label: "Where this branch started", bytes: base });
}

/** Open in Crit Mode: opens the branch and turns crit mode on, for its pins and red-lines. */
async function openCrit(r: MergeRequest): Promise<void> {
  if (await openCloudFile(r.sourceFileId)) setCritMode(true);
}

/** Delete Branch, for a merged request: asks first, then deletes the branch and its versions. */
async function removeBranch(r: MergeRequest): Promise<void> {
  const root = familyState()?.family.rootId;
  if (!root) return;
  const ok = await confirmDialog("Delete branch", `Delete the branch "${r.branchName}" and its versions? Main isn't changed.`, "Delete Branch");
  if (!ok) return;
  await deleteBranch(r.sourceFileId, root);
  void refresh();
}

/** A button with its label and click handler. */
function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const btn = h("button", { cls, text, attrs: { type: "button" } });
  btn.addEventListener("click", onClick);
  return btn;
}

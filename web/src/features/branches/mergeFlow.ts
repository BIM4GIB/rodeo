// Merging a branch: a merge request's branch into Main, or Main into the open branch (File ›
// Branches › Update from Main…). The common ancestor, Main and the branch are fetched and split
// into units; the user settles the changes both sides made; the merged drawing is checked to open
// again, then written as a new version. The merge runs here, in the browser (merge.ts); the server
// checks the heads it was merged from and refuses a write over a newer one, which merges again.

import { h, nextPaint } from "../../app/dom.ts";
import { appContext, documentSource } from "../../app/ext.ts";
import { reportFailure } from "../../app/reports.ts";
import { showLoading } from "../../app/loading.ts";
import { type DialogCheck, showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { openVwx } from "../../core/index.ts";
import { ApiError, files, type Progress } from "../../platform/api.ts";
import type { Version } from "../../platform/protocol.ts";
import { cloudCall, cloudChanged, explainFailure, headVersion, isVersionSource, openCloudDrawing, openCloudFile } from "../cloud/cloud.ts";
import { revealObject } from "../search/select.ts";
import { branches, mergeRequests } from "./api.ts";
import type { ChangeKind } from "./diff.ts";
import { familyState, loadFamily } from "./family.ts";
import { type Choice, type Conflict, type MergeResult, mergeUnits } from "./merge.ts";
import { readUnits } from "./units.ts";
import { MAIN_NAME, type MergeRequest } from "./wire.ts";

/** Larger drawings are not merged in the browser yet. */
const MERGE_MAX = 200 * 1024 * 1024;
/** Merges again this many times when Main or the branch moved while they were read. */
const MOVED_TRIES = 3;
/** Waits this many times for live changes to be saved, LIVE_WAIT_MS each: two minutes. */
const LIVE_WAITS = 8;
const LIVE_WAIT_MS = 15_000;
/** After a merge into the open drawing, its window reopens this long after if it still holds the old head. */
const RELOAD_AFTER_MS = 1500;
const NOT_MERGED = "Rodeo couldn't merge these drawings safely. Nothing was changed.";
/** What a side did to a change, after its name: "Main changed it; Option B deleted it." */
const VERB: Record<ChangeKind, string> = { changed: "changed it", removed: "deleted it", added: "added it" };

/** One way to merge: which drawing takes the changes, which gives them, and how the merged bytes are written. */
interface Direction {
  /** the branch, which is always one side: its common ancestor is the base */
  readonly branchId: string;
  /** the drawing the changes go into: Main for a merge request, the open branch for an update */
  readonly intoId: string;
  /** the drawing the changes come from */
  readonly fromId: string;
  readonly intoName: string;
  readonly fromName: string;
  /** the merge request, for a merge (it offers to delete the branch); null for an update */
  readonly request: MergeRequest | null;
  /** the confirm button's label, which also names the action in a failure ("Merge failed: …") */
  readonly okLabel: string;
  /** writes the merged bytes, given the head versions they were merged from */
  readonly write: (bytes: Uint8Array, intoVersion: string, fromVersion: string, onProgress: Progress) => Promise<Version>;
}

/** What the user chose in a dialog: the side for each clash, and whether to delete the branch after. */
interface Picked {
  readonly choices: Map<string, Choice>;
  readonly deleteBranch: boolean;
}

/** True while a merge runs: a second one would merge the same drawings. */
let busy = false;

/** Merges a merge request's branch into Main, and marks the request merged. */
export function mergeRequest(req: MergeRequest): Promise<void> {
  return runMerge({
    branchId: req.sourceFileId,
    intoId: req.targetFileId,
    fromId: req.sourceFileId,
    intoName: MAIN_NAME,
    fromName: req.branchName,
    request: req,
    okLabel: "Merge",
    write: async (bytes, into, from, onProgress) => (await mergeRequests.merge(req.id, bytes, into, from, onProgress)).version,
  });
}

/** File › Branches › Update from Main…: merges Main into the open branch. */
export async function updateFromMain(): Promise<void> {
  const s = familyState();
  if (!s || s.current.main) return;
  const branchId = s.fileId;
  await runMerge({
    branchId,
    intoId: branchId,
    fromId: s.family.rootId,
    intoName: s.current.name,
    fromName: MAIN_NAME,
    request: null,
    okLabel: "Update",
    write: (bytes, into, from, onProgress) => branches.update(branchId, bytes, into, from, onProgress),
  });
}

/** Runs one merge, one at a time. */
async function runMerge(dir: Direction): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await mergeLoop(dir);
  } finally {
    busy = false;
  }
}

/** The merge itself: fetch, settle, write, and merge again when a drawing moved or a live session is saving. */
async function mergeLoop(dir: Direction): Promise<void> {
  // the merge reads the saved heads, so the open drawing's unsaved changes are saved first
  const open = openCloudDrawing();
  if (open && (open.id === dir.intoId || open.id === dir.fromId) && store.session?.dirty) {
    try {
      await appContext()?.save();
    } catch (err) {
      toast(`The ${dir.okLabel.toLowerCase()} was not started, because the drawing was not saved: ${errorMessage(err)}`);
      return;
    }
  }

  // the choices outlive a retry, so a merge that moved on keeps what the user picked
  let choices = new Map<string, Choice>();
  let plan: { deleteBranch: boolean } | null = null;
  let tries = 0;
  let waits = 0;
  let version: Version | null = null;
  for (;;) {
    const fetched = await cloudCall("Fetching the drawings…", dir.okLabel, () =>
      Promise.all([branches.base(dir.branchId), files.content(dir.intoId), files.content(dir.fromId)]),
    );
    if (!fetched) return;
    const [baseBytes, into, from] = fetched;
    if (baseBytes.length > MERGE_MAX || into.bytes.length > MERGE_MAX || from.bytes.length > MERGE_MAX) {
      toast("This drawing is too large to merge in the browser yet.", "info");
      return;
    }

    const split = await working("Reading the drawings…", () => ({
      base: readUnits(baseBytes),
      into: readUnits(into.bytes),
      from: readUnits(from.bytes),
    }));
    if (!split) return;
    let result = await working("Merging…", () => mergeUnits(split.base, split.into, split.from, choices));
    if (!result) return;

    if (result.conflicts.some((c) => !choices.has(c.key))) {
      const picked = await conflictDialog(result, dir, choices);
      if (!picked) return;
      choices = picked.choices;
      plan = { deleteBranch: picked.deleteBranch };
      result = await working("Merging…", () => mergeUnits(split.base, split.into, split.from, choices));
      if (!result) return;
    } else if (!plan) {
      // no clashes: the summary is the one confirmation (asked once, not again on a retry)
      plan = await summaryDialog(result, dir);
      if (!plan) return;
    }

    const bytes = result.bytes;
    if (!bytes) {
      toast(NOT_MERGED);
      return;
    }
    // a drawing that does not open again is never written
    const opens = await working("Checking the merged drawing…", () => {
      openVwx(bytes, "merged.vwx");
      return true;
    });
    if (!opens) return;

    const saving = showLoading("Saving the merge…");
    let failure: unknown = null;
    try {
      version = await dir.write(bytes, into.versionId, from.versionId, (sent, total) => saving.progress(total > 0 ? sent / total : null));
    } catch (err) {
      failure = err;
    } finally {
      saving();
    }
    if (version) break;

    if (failure instanceof ApiError && failure.code === "moved") {
      if (++tries > MOVED_TRIES) {
        toast("The drawings keep changing. Try the merge again in a moment.");
        return;
      }
      toast("The drawings changed while you were merging. Merging again…", "info");
      continue;
    }
    if (failure instanceof ApiError && failure.code === "live") {
      if (++waits > LIVE_WAITS) {
        toast("Someone is still editing. Try the merge again in a minute.");
        return;
      }
      if (!(await pause("Waiting for live changes to be saved…", LIVE_WAIT_MS))) return;
      continue;
    }
    if (!(failure instanceof ApiError)) reportFailure("branches", failure, { action: dir.okLabel.toLowerCase() });
    await explainFailure(dir.okLabel, failure);
    return;
  }

  // the merged drawing is the head now: the windows that show Main reload onto it
  cloudChanged();
  await loadFamily(true);
  if (openCloudDrawing()?.id === dir.intoId) reloadSoon(dir.intoId, version.id);
  if (plan?.deleteBranch && dir.request) await deleteBranch(dir.branchId, dir.intoId);
  toast(dir.request ? `Merged ${dir.fromName} into ${dir.intoName}.` : `Updated ${dir.intoName} from ${dir.fromName}.`, "info");
}

/** Runs `work` behind the loading overlay. A failure is reported and says nothing was merged, and gives null. */
async function working<T>(label: string, work: () => T): Promise<T | null> {
  const done = showLoading(label);
  await nextPaint();
  try {
    return work();
  } catch (err) {
    reportFailure("branches", err, { action: "merge" });
    toast(NOT_MERGED);
    return null;
  } finally {
    done();
  }
}

/** Waits `ms` behind the loading overlay, whose Cancel ends the wait early. Resolves false when cancelled. */
function pause(label: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const hide = showLoading(label, () => finish(false));
    const timer = window.setTimeout(() => finish(true), ms);
    function finish(go: boolean): void {
      window.clearTimeout(timer);
      hide();
      resolve(go);
    }
  });
}

/** After a merge into the open drawing: if its window still holds the old head a moment later, it reopens on the merged one. */
function reloadSoon(fileId: string, versionId: string): void {
  window.setTimeout(() => {
    if (openCloudDrawing()?.id === fileId && headVersion(fileId) !== versionId) void openCloudFile(fileId);
  }, RELOAD_AFTER_MS);
}

/** Deletes a branch and its versions, Main unchanged. When the window shows the branch, Main opens first, so no window holds a deleted drawing. */
export async function deleteBranch(branchId: string, rootId: string): Promise<void> {
  // Main takes the branch's tab, so no tab is left on a drawing that's gone
  if (openCloudDrawing()?.id === branchId) await openCloudFile(rootId, { replace: true });
  const removed = await cloudCall("Deleting the branch…", "Delete branch", () => branches.remove(branchId).then(() => true));
  if (removed) cloudChanged();
}

/** The conflict picker: each change both sides made, with the side to keep. Resolves with the picks, or null on Cancel. */
function conflictDialog(result: MergeResult, dir: Direction, choices: ReadonlyMap<string, Choice>): Promise<Picked | null> {
  const picks: { readonly key: string; readonly ours: HTMLInputElement; readonly theirs: HTMLInputElement }[] = [];
  const rows = result.conflicts.map((c, i) => {
    // one radio group per row: the two sides of a change are chosen apart from the others
    const name = `pick-${i}`;
    const ours = h("input", { attrs: { type: "radio", name, value: "ours" }, checked: choices.get(c.key) === "ours" });
    const theirs = h("input", { attrs: { type: "radio", name, value: "theirs" }, checked: choices.get(c.key) === "theirs" });
    picks.push({ key: c.key, ours, theirs });
    return h(
      "div",
      { cls: "br-conflict" },
      h("div", { cls: "br-conflict-label", text: c.label }),
      h("div", { cls: "br-conflict-what", text: `${dir.intoName} ${VERB[c.ours]}; ${dir.fromName} ${VERB[c.theirs]}.` }),
      h(
        "div",
        { cls: "br-conflict-pick" },
        h("label", {}, ours, ` Keep ${dir.intoName}'s`),
        h("label", {}, theirs, ` Take ${dir.fromName}'s`),
        showButton(c, dir),
      ),
    );
  });

  const keepAll = h("button", { cls: "br-link", text: `Keep all ${dir.intoName}'s`, attrs: { type: "button" } });
  keepAll.addEventListener("click", () => {
    for (const p of picks) p.ours.checked = true;
  });
  const takeAll = h("button", { cls: "br-link", text: `Take all ${dir.fromName}'s`, attrs: { type: "button" } });
  takeAll.addEventListener("click", () => {
    for (const p of picks) p.theirs.checked = true;
  });

  const clashes = result.conflicts.length;
  const body: Node[] = [
    h("p", {
      cls: "menu-dialog-text",
      text: `${takenText(result.taken)} in from ${dir.fromName} without a clash. ${clashes === 1 ? "One change was" : `${clashes} changes were`} made on both sides, or changed on one side and removed on the other. Choose which to keep:`,
    }),
    h("div", { cls: "br-conflicts" }, ...rows),
    h("div", { cls: "br-bulk" }, keepAll, takeAll),
    ...result.notes.map((n) => h("p", { cls: "br-note", text: n })),
  ];
  const box = deleteBox(dir, body);

  return showDialog<Picked>({
    title: "Resolve Changes",
    okLabel: dir.okLabel,
    cls: "br-merge-dialog",
    body,
    check: (): DialogCheck<Picked> => {
      const picked = new Map<string, Choice>();
      for (const p of picks) {
        if (!p.ours.checked && !p.theirs.checked) return { error: "Choose for every change listed.", focus: p.ours };
        picked.set(p.key, p.ours.checked ? "ours" : "theirs");
      }
      return { value: { choices: picked, deleteBranch: box?.checked ?? false } };
    },
  });
}

/** The summary shown when nothing clashes: how much comes in, and what goes. Resolves with the delete choice, or null on Cancel. */
function summaryDialog(result: MergeResult, dir: Direction): Promise<{ deleteBranch: boolean } | null> {
  const body: Node[] = [
    h("p", { cls: "menu-dialog-text", text: `Merge ${dir.fromName} into ${dir.intoName}? ${takenText(result.taken)} in, and ${removedText(result.removed)}.` }),
    ...result.notes.map((n) => h("p", { cls: "br-note", text: n })),
  ];
  const box = deleteBox(dir, body);
  return showDialog<{ deleteBranch: boolean }>({
    title: dir.request ? "Merge Request" : "Update Branch",
    okLabel: dir.okLabel,
    body,
    check: () => ({ value: { deleteBranch: box?.checked ?? false } }),
  });
}

/** "One change comes" or "N changes come", for a count of changes that come in. */
function takenText(n: number): string {
  return n === 1 ? "One change comes" : `${n} changes come`;
}

/** "One object goes" or "N objects go", for a count of objects that go. */
function removedText(n: number): string {
  return n === 1 ? "One object goes" : `${n} objects go`;
}

/** The "Delete the branch after merging" box, for a merge request only: added to `body`, and returned. */
function deleteBox(dir: Direction, body: Node[]): HTMLInputElement | null {
  if (!dir.request) return null;
  const box = h("input", { attrs: { type: "checkbox" } });
  body.push(h("label", { cls: "br-check" }, box, " Delete the branch after merging"));
  return box;
}

/** A Show button for a clash in the open drawing: it selects the object and zooms to it. Null when the drawing does not hold it. */
function showButton(c: Conflict, dir: Direction): HTMLButtonElement | null {
  const ctx = appContext();
  const open = openCloudDrawing();
  const doc = store.session?.doc;
  const here = open !== null && !isVersionSource(documentSource()) && (open.id === dir.intoId || open.id === dir.fromId);
  if (!ctx || !here || !doc || c.what !== "object" || !doc.object(c.key)) return null;
  const btn = h("button", { cls: "br-link", text: "Show", attrs: { type: "button" } });
  btn.addEventListener("click", () => revealObject(ctx, c.key));
  return btn;
}

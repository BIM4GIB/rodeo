// The Crit palette: the drawing's threads, filtered to Open, Resolved or All.
// A row shows its number, its first line, who wrote it and when, its replies,
// and a voice-note icon; a click centres the view on its pin and opens it.
// Export Crit Notes… saves them as Markdown.

import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { h } from "../../app/dom.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { critNotes } from "./notes.ts";
import { GLYPH } from "./glyphs.ts";
import { crit, type Thread, type ThreadFilter } from "./state.ts";
import { focusThread } from "./thread.ts";
import { firstLine, plural, timeAgo } from "./util.ts";

const FILTERS: readonly { readonly id: ThreadFilter; readonly label: string }[] = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

function baseName(fileName: string): string {
  return fileName.replace(/\.(vwx|sta)$/i, "");
}

function exportNotes(): void {
  const threads = crit.threads();
  if (threads.length === 0) {
    toast("There are no comments to export yet.", "info");
    return;
  }
  const ctx = appContext();
  const title = baseName(store.fileName) || "Drawing";
  const text = critNotes({
    title,
    threads,
    layerName: (id) => ctx?.scene.layer(id)?.name ?? "(deleted layer)",
    now: new Date(),
  });
  downloadBlob(`${title}-crit-notes.md`, new Blob([text], { type: "text/markdown" }));
}

function row(t: Thread): HTMLElement {
  const r = t.root;
  const kind = r.strokes.length > 0 ? "Redline" : r.anchor?.kind === "3d" ? "3D" : "";
  const meta = [kind, r.authorName, timeAgo(r.createdAt), t.replies.length > 0 ? plural(t.replies.length, "reply", "replies") : ""]
    .filter((p) => p !== "")
    .join(" · ");
  const voice = r.audio || t.replies.some((x) => x.audio);
  const selected = crit.selected === r.id;
  const li = h(
    "li",
    {
      cls: `crit-row${r.resolved ? " resolved" : ""}${selected ? " selected" : ""}`,
      attrs: { role: "button", tabindex: "0", "aria-label": `${kind || "Comment"} ${t.number}: ${firstLine(r.body) || "voice note"}` },
    },
    h("span", { cls: "crit-num", text: String(t.number) }),
    h(
      "span",
      { cls: "crit-row-main" },
      h("span", { cls: "crit-row-text", text: firstLine(r.body) || (voice ? "Voice note" : "Redline") }),
      h("span", { cls: "crit-row-meta", text: meta }),
    ),
    voice
      ? h("span", { cls: "crit-row-voice", attrs: { title: "Has a voice note", "aria-label": "Has a voice note" }, html: GLYPH.mic })
      : null,
  );
  li.addEventListener("click", () => focusThread(r.id));
  li.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      focusThread(r.id);
    }
  });
  return li;
}

/** The palette's body: the filter, the threads, and the export row. */
export function critPalette(): HTMLElement {
  const filter = h("div", { cls: "seg crit-filter", attrs: { role: "group", "aria-label": "Show threads" } });
  const buttons = FILTERS.map((f) => {
    const btn = h("button", { cls: "seg-btn", attrs: { type: "button" } });
    btn.addEventListener("click", () => {
      crit.filter = f.id;
      crit.changed();
    });
    filter.append(btn);
    return { id: f.id, label: f.label, btn };
  });
  const status = h("p", { cls: "crit-status", attrs: { role: "status" } });
  const list = h("ul", { cls: "crit-list", attrs: { role: "list", "aria-label": "Comment threads" } });
  const exportBtn = h("button", { cls: "crit-foot-btn", attrs: { type: "button" } });
  exportBtn.innerHTML = `${GLYPH.export}<span>Export Crit Notes…</span>`;
  exportBtn.addEventListener("click", exportNotes);
  const body = h("div", { cls: "crit-palette" }, filter, status, list, h("div", { cls: "crit-foot" }, exportBtn));

  const render = (): void => {
    const all = crit.threads();
    const openN = all.filter((t) => !t.root.resolved).length;
    const counts: Record<ThreadFilter, number> = { open: openN, resolved: all.length - openN, all: all.length };
    for (const b of buttons) {
      const on = crit.filter === b.id;
      b.btn.classList.toggle("active", on);
      b.btn.setAttribute("aria-pressed", String(on));
      b.btn.textContent = `${b.label} ${counts[b.id]}`;
    }
    const shown = all.filter((t) => crit.filter === "all" || (crit.filter === "resolved") === t.root.resolved);
    if (all.length === 0) status.textContent = "No comments yet. Pin or redline the drawing to start the review.";
    else if (shown.length === 0) status.textContent = crit.filter === "resolved" ? "No resolved threads." : "No open threads.";
    else status.textContent = "";
    list.replaceChildren(...shown.map(row));
  };
  crit.subscribe(render);
  render();
  return body;
}

// A gallery entry's page: the viewer (the embed, loaded when asked), who made it and under what
// licence, Fork, Open in Rodeo and Download, the description and tags, what it was forked from and
// its remixes, and Report. The owner gets their own controls, admins the reports and theirs.

import { h } from "../../../app/dom.ts";
import { errorMessage } from "../../../app/toast.ts";
import { ApiError, currentUser, userReady } from "../../../platform/api.ts";
import { galleryApi } from "../api.ts";
import { LIMITS, REPORT_REASONS, SUGGESTED_TAGS, isReportReason, licenceOf, missingMeta } from "../rules.ts";
import type { EntryDetail, ForkedFrom, GalleryEntry, ModerationReport, RemixNode } from "../rules.ts";
import { button, forkIcon, navigate, notice, openPageModal, openSignIn } from "./main.ts";
import { coverOf } from "./list.ts";

/** A day as the page writes it: "4 November 2026". */
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/** A size in KB or MB, to one decimal. */
function sizeOf(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "1 fork" or "3 forks". */
function forksOf(n: number): string {
  return `${n} ${n === 1 ? "fork" : "forks"}`;
}

/** A tag's words on its chip: the suggested label, else the tag with a "#". */
function tagLabel(tag: string): string {
  return SUGGESTED_TAGS.find((t) => t.tag === tag)?.label ?? `#${tag}`;
}

/** The words of a report reason. */
function reasonOf(reason: string): string {
  return REPORT_REASONS.find((r) => r.id === reason)?.label ?? reason;
}

/** The sign-in line for forking one drawing: the box opens again when the reader is back. */
function signInToFork(e: GalleryEntry): void {
  openSignIn(`Sign in to fork “${e.title}”. It goes into your drawings, yours to change.`, `${e.path}?fork=1`);
}

/**
 * A drawing's page, loaded from the server. `params` may carry fork=1 (from the sign-in box): the
 * fork box then opens once the page is in, for a signed-in reader only.
 */
export function showEntry(main: HTMLElement, id: string, params: URLSearchParams): void {
  let forkOnOpen = params.get("fork") === "1";
  if (forkOnOpen) {
    // the address goes back to the plain page now, so a reload does not open the box again
    const address = new URL(location.href);
    address.searchParams.delete("fork");
    history.replaceState(null, "", address.pathname + address.search + address.hash);
  }
  // what the main area shows now. A load that finishes after the reader has gone elsewhere finds
  // this element removed and does nothing.
  let shown: HTMLElement = h("p", { cls: "gal-status", text: "Loading…" });
  main.replaceChildren(shown);

  const load = async (): Promise<void> => {
    try {
      const d = await galleryApi.entry(id);
      if (!shown.isConnected) return;
      const page = pageOf(d, load);
      document.title = `${d.entry.title} by ${d.entry.creditName} · Rodeo Gallery`;
      if (location.pathname !== d.entry.path) history.replaceState(null, "", d.entry.path + location.search);
      main.replaceChildren(page);
      shown = page;
      if (forkOnOpen) {
        forkOnOpen = false;
        void userReady().then((user) => {
          if (user && shown.isConnected) forkDialog(d.entry);
        });
      }
    } catch (err) {
      if (!shown.isConnected) return;
      const gone = err instanceof ApiError && err.status === 404;
      if (gone) document.title = missingMeta(location.origin).title;
      const view = gone
        ? notice(
            "This drawing is no longer in the gallery.",
            undefined,
            h("a", { cls: "gal-btn", text: "Browse the gallery", attrs: { href: "/gallery", "data-nav": "" } }),
          )
        : notice("Could not load this drawing.", errorMessage(err), button("Try Again", "plain", () => void load()));
      main.replaceChildren(view);
      shown = view;
    }
  };
  void load();
}

/** A drawing's whole page: the viewer and side panel, then the description, tags, remixes and the admins' panel. */
function pageOf(d: EntryDetail, reload: () => Promise<void>): HTMLElement {
  const e = d.entry;
  const live = e.state === "published";

  const actions = h("div", { cls: "gal-actions" });
  if (live) {
    const forkButton = button("Fork", "primary", () => startFork(e));
    forkButton.prepend(forkIcon());
    actions.append(forkButton);
  }
  if (e.viewUrl) actions.append(h("a", { cls: "gal-btn", text: "Open in Rodeo", attrs: { href: e.viewUrl, target: "_blank", rel: "noopener" } }));
  if (live) actions.append(h("a", { cls: "gal-btn", text: "Download .vwx", attrs: { href: e.downloadUrl, download: "" } }));

  const side = h(
    "aside",
    { cls: "gal-side" },
    h("h1", { cls: "gal-title", text: e.title, attrs: { translate: "no" } }),
    byline(e),
    licenceLine(e),
    h("p", { cls: "gal-meta", text: metaText(e) }),
    actions,
  );
  if (d.viewer.isOwner && d.fileId) side.append(ownerPanel(e, d.fileId));

  const body = h("div", { cls: "gal-body" });
  if (e.description) body.append(h("p", { cls: "gal-description", text: e.description }));
  if (e.tags.length > 0) {
    body.append(
      h(
        "div",
        { cls: "gal-tags" },
        ...e.tags.map((t) => h("a", { cls: "gal-chip", text: tagLabel(t), attrs: { href: `/gallery?tag=${encodeURIComponent(t)}`, "data-nav": "" } })),
      ),
    );
  }
  if (e.forkedFrom) body.append(forkedFromLine(e.forkedFrom));
  body.append(remixesOf(d));
  if (live && !d.viewer.isOwner) {
    const report = h("button", { cls: "gal-report-link", text: "Report this drawing", attrs: { type: "button" } });
    report.addEventListener("click", () => reportDialog(e));
    body.append(report);
  }
  if (d.viewer.isAdmin) body.append(adminPanel(d, reload));

  return h(
    "article",
    { cls: "gal-page" },
    h("a", { cls: "gal-back", text: "← Gallery", attrs: { href: "/gallery", "data-nav": "" } }),
    h("div", { cls: "gal-entry" }, viewerOf(e), side),
    body,
  );
}

/** The picture with a Look round button that puts the embed viewer in its place, once asked. */
function viewerOf(e: GalleryEntry): HTMLElement {
  const box = h("div", { cls: "gal-viewer" }, coverOf(e));
  if (e.embedUrl === "") {
    box.append(h("div", { cls: "gal-viewer-bar", text: `Hidden from the gallery${e.hiddenReason ? `: ${e.hiddenReason}` : "."}` }));
    return box;
  }
  const look = button("Look round", "primary", () => {
    // the viewer is a whole editor, so it loads on the click and not with the page
    box.replaceChildren(
      h("iframe", { attrs: { src: e.embedUrl, title: `${e.title}: viewer`, allow: "fullscreen; xr-spatial-tracking", referrerpolicy: "same-origin" } }),
    );
  });
  look.classList.add("gal-look");
  box.append(look);
  return box;
}

/** Who made the drawing: the Rodeo mark for an official one, else a link to that author's drawings. */
function byline(e: GalleryEntry): HTMLElement {
  if (e.official) return h("p", { cls: "gal-by" }, h("img", { cls: "gal-mark", attrs: { src: "/icon.svg", alt: "" } }), "Rodeo");
  const name = e.authorId
    ? h("a", { text: e.creditName, attrs: { href: `/gallery?author=${encodeURIComponent(e.authorId)}`, "data-nav": "" } })
    : e.creditName;
  return h("p", { cls: "gal-by" }, "by ", name);
}

/** The licence's name, linked to its text, and what it lets people do. */
function licenceLine(e: GalleryEntry): HTMLElement {
  const licence = licenceOf(e.licence);
  if (!licence) return h("p", { cls: "gal-muted", text: e.licence });
  return h(
    "div",
    { cls: "gal-licence-line" },
    h("a", { cls: "gal-licence-link", text: licence.name, attrs: { href: licence.url, target: "_blank", rel: "license noopener" } }),
    h("p", { cls: "gal-muted", text: licence.summary }),
  );
}

/** Published and updated days, the size and the forks, on one line. */
function metaText(e: GalleryEntry): string {
  const published = dayOf(e.publishedAt);
  const updated = dayOf(e.updatedAt);
  const when = updated === published ? `Published ${published}` : `Published ${published} · updated ${updated}`;
  return `${when} · ${sizeOf(e.size)} · ${forksOf(e.forks)}`;
}

/** The drawing this one was forked from, linked while that drawing is still in the gallery. */
function forkedFromLine(f: ForkedFrom): HTMLElement {
  const from = f.path ? h("a", { text: f.title, attrs: { translate: "no", href: f.path, "data-nav": "" } }) : h("span", { text: f.title, attrs: { translate: "no" } });
  return h("p", { cls: "gal-forkof-line" }, "Forked from ", from, ` by ${f.creditName}`);
}

/** The remixes as a tree, and how many forks nobody has published. */
function remixesOf(d: EntryDetail): HTMLElement {
  const section = h("section", { cls: "gal-remixes" }, h("h2", { text: "Remixes" }));
  if (d.remixes.length > 0) section.append(treeOf(d.remixes));
  if (d.privateForks > 0) {
    section.append(h("p", { cls: "gal-muted", text: `and ${d.privateForks} private ${d.privateForks === 1 ? "fork" : "forks"}` }));
  }
  if (d.remixes.length === 0 && d.privateForks === 0) {
    section.append(h("p", { cls: "gal-muted", text: "No remixes yet. Fork it and publish yours." }));
  }
  return section;
}

/** A nested list of remixes: each one's title, author and forks, with its own remixes under it. */
function treeOf(nodes: readonly RemixNode[]): HTMLElement {
  return h(
    "ul",
    { cls: "gal-tree" },
    ...nodes.map((n) =>
      h(
        "li",
        {},
        h("a", { text: n.card.title, attrs: { translate: "no", href: n.card.path, "data-nav": "" } }),
        h("span", { cls: "gal-muted", text: ` by ${n.card.creditName} · ${forksOf(n.card.forks)}` }),
        n.children.length > 0 ? treeOf(n.children) : null,
      ),
    ),
  );
}

/** The owner's panel: edit in the editor, or take the drawing out of the gallery. */
function ownerPanel(e: GalleryEntry, fileId: string): HTMLElement {
  return h(
    "div",
    { cls: "gal-owner" },
    h("p", { cls: "gal-panel-title", text: "This is yours." }),
    h("p", { cls: "gal-muted", text: "Change the details, the version or the cover from File › Share › Publish to Gallery… in Rodeo." }),
    h(
      "div",
      { cls: "gal-actions" },
      h("a", { cls: "gal-btn", text: "Edit in Rodeo", attrs: { href: `/?file=${encodeURIComponent(fileId)}` } }),
      button("Unpublish", "danger", () => unpublishDialog(e)),
    ),
  );
}

/** The buttons at the foot of a dialog: Cancel, then the one that does the thing. */
function footRow(cancel: () => void, go: HTMLButtonElement): HTMLElement {
  return h("div", { cls: "gal-actions gal-foot-row" }, button("Cancel", "plain", cancel), go);
}

/** Fork for a signed-in reader opens the box; a signed-out one is asked to sign in first. */
function startFork(e: GalleryEntry): void {
  void userReady().then((user) => {
    if (user) forkDialog(e);
    else signInToFork(e);
  });
}

/** The fork box: what the copy gets, and the Fork button that makes it. */
function forkDialog(e: GalleryEntry): void {
  const m = openPageModal(`Fork “${e.title}”`);
  const licence = licenceOf(e.licence);
  const err = h("p", { cls: "gal-error", attrs: { role: "alert" } });
  const go = button("Fork", "primary", () => {
    go.disabled = true;
    go.textContent = "Forking…";
    galleryApi
      .fork(e.id)
      .then((r) => location.assign(r.url))
      .catch((caught: unknown) => {
        go.disabled = false;
        go.textContent = "Fork";
        if (caught instanceof ApiError && caught.code === "auth") {
          m.close();
          signInToFork(e);
          return;
        }
        err.textContent = errorMessage(caught);
        if (caught instanceof ApiError && caught.code === "limit") {
          err.append(" ", h("a", { text: "Open Rodeo to make room", attrs: { href: "/" } }));
        }
      });
  });
  m.body.append(
    h("p", { text: "A copy goes into your drawings. The original stays as it is, and your copy keeps the credit:" }),
    h("p", { cls: "gal-credit-line", text: `“${e.title}” by ${e.creditName}, ${licence?.name ?? e.licence}.` }),
  );
  if (e.licence === "CC-BY-SA-4.0") m.body.append(h("p", { text: "Changes you publish must use CC BY-SA 4.0 too." }));
  if (e.licence === "CC-BY-NC-4.0") m.body.append(h("p", { text: "Not for commercial use." }));
  m.body.append(err, footRow(m.close, go));
}

/** The report box: a reason, a note, and an email address when the reader is signed out. */
function reportDialog(e: GalleryEntry): void {
  const m = openPageModal("Report this drawing");
  const signedIn = currentUser() !== null;
  const inputs = REPORT_REASONS.map((r) => h("input", { attrs: { type: "radio", name: "reason", value: r.id } }));
  const choices = REPORT_REASONS.map((r, i) => h("label", { cls: "gal-radio" }, inputs[i], h("span", { text: r.label })));
  const note = h("textarea", {
    cls: "gal-input",
    attrs: { rows: "4", maxlength: String(LIMITS.reportNote), "aria-label": "Anything we should know?" },
  });
  const email = h("input", { cls: "gal-input", attrs: { type: "email", autocomplete: "email", "aria-label": "Your email" } });
  const err = h("p", { cls: "gal-error", attrs: { role: "alert" } });
  const send = button("Send Report", "primary", () => {
    const reason = inputs.find((i) => i.checked)?.value;
    if (!isReportReason(reason)) {
      err.textContent = "Choose the reason that fits best.";
      return;
    }
    send.disabled = true;
    galleryApi
      .report(e.id, { reason, note: note.value.trim(), email: email.value.trim() || undefined })
      .then(() => {
        m.body.replaceChildren(h("p", { text: "Thanks. Rodeo will look at it." }), h("div", { cls: "gal-actions" }, button("Close", "plain", m.close)));
      })
      .catch((caught: unknown) => {
        send.disabled = false;
        err.textContent = errorMessage(caught);
      });
  });
  m.body.append(
    h("fieldset", { cls: "gal-fieldset" }, h("legend", { text: "Why report it?" }), ...choices),
    h("label", { cls: "gal-field" }, h("span", { text: "Anything we should know?" }), note),
  );
  if (!signedIn) m.body.append(h("label", { cls: "gal-field" }, h("span", { text: "Your email (optional, so we can reply)" }), email));
  m.body.append(err, footRow(m.close, send));
}

/** The owner's Unpublish box. Forks people made stay theirs. */
function unpublishDialog(e: GalleryEntry): void {
  const m = openPageModal("Take this drawing out of the gallery?");
  const err = h("p", { cls: "gal-error", attrs: { role: "alert" } });
  const go = button("Unpublish", "danger", () => {
    go.disabled = true;
    galleryApi
      .unpublish(e.id)
      .then(() => {
        m.close();
        navigate("/gallery");
      })
      .catch((caught: unknown) => {
        go.disabled = false;
        err.textContent = errorMessage(caught);
      });
  });
  m.body.append(h("p", { text: "Take it out of the gallery? Its page goes at once. Forks people have made stay theirs." }), err, footRow(m.close, go));
}

/** The admin's Hide box: the reason is required, and the owner is emailed it. */
function hideDialog(e: GalleryEntry, reload: () => Promise<void>): void {
  const m = openPageModal("Hide this drawing?");
  const reason = h("input", {
    cls: "gal-input",
    attrs: { type: "text", maxlength: String(LIMITS.hideReason), required: "", "aria-label": "Reason" },
  });
  const err = h("p", { cls: "gal-error", attrs: { role: "alert" } });
  const go = button("Hide", "danger", () => {
    const text = reason.value.trim();
    if (!text) {
      err.textContent = "Give a reason. The owner is emailed it.";
      reason.focus();
      return;
    }
    go.disabled = true;
    galleryApi
      .hide(e.id, text)
      .then(() => {
        m.close();
        return reload();
      })
      .catch((caught: unknown) => {
        go.disabled = false;
        err.textContent = errorMessage(caught);
      });
  });
  m.body.append(
    h("p", { text: "It leaves the gallery at once. Its owner is emailed the reason." }),
    h("label", { cls: "gal-field" }, h("span", { text: "Reason" }), reason),
    err,
    footRow(m.close, go),
  );
}

/** One open report, as an admin reads it. */
function reportItem(r: ModerationReport): HTMLElement {
  return h(
    "li",
    { cls: "gal-report" },
    h("strong", { text: reasonOf(r.reason) }),
    r.note ? h("p", { text: r.note }) : null,
    h("p", { cls: "gal-muted", text: `From ${r.reporterName ?? r.email ?? "anonymous"} · ${dayOf(r.createdAt)}` }),
  );
}

/** The admins' panel: the open reports, and the moves an admin can make on them. Each move reloads the page. */
function adminPanel(d: EntryDetail, reload: () => Promise<void>): HTMLElement {
  const e = d.entry;
  const reports = d.reports ?? [];
  const err = h("p", { cls: "gal-error", attrs: { role: "alert" } });
  const move = (label: string, kind: "plain" | "danger", task: () => Promise<void>): HTMLButtonElement =>
    button(label, kind, () => {
      err.textContent = "";
      task()
        .then(reload)
        .catch((caught: unknown) => {
          err.textContent = errorMessage(caught);
        });
    });

  const actions = h("div", { cls: "gal-actions" });
  if (e.state === "published") actions.append(button("Hide", "danger", () => hideDialog(e, reload)));
  if (e.state === "hidden") actions.append(move("Restore", "plain", () => galleryApi.restore(e.id)));
  if (reports.length > 0) actions.append(move("Dismiss Reports", "plain", () => galleryApi.dismiss(e.id)));
  actions.append(move(e.featured ? "Unfeature" : "Feature", "plain", () => galleryApi.feature(e.id, !e.featured)));

  const lines: Node[] = [h("p", { cls: "gal-panel-title", text: "For admins" })];
  if (e.state === "hidden") lines.push(h("p", { cls: "gal-muted", text: `Hidden${e.hiddenReason ? `: ${e.hiddenReason}` : "."}` }));
  if (reports.length > 0) lines.push(h("ul", { cls: "gal-reports" }, ...reports.map(reportItem)));
  else lines.push(h("p", { cls: "gal-muted", text: "No open reports." }));
  return h("div", { cls: "gal-admin" }, ...lines, err, actions);
}

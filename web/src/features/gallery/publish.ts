// The Publish to Gallery dialog for a cloud drawing's owner: a warning that it becomes public, the
// title, description, tags, credit, licence and cover, then a snapshot of the saved version goes into
// the gallery. Once it is in, the same dialog changes the details, publishes the current version,
// replaces the cover or unpublishes it. The Share dialog's Gallery row opens it too.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { explainFailure } from "../cloud/cloud.ts";
import { copyRow, field, type Modal, note, openModal } from "../cloud/ui.ts";
import { galleryApi } from "./api.ts";
import { canCapture3d, type CoverSource, captureCover } from "./cover.ts";
import {
  type ForkedFrom,
  isLicenceId,
  LICENCES,
  LIMITS,
  licenceOf,
  type LicenceId,
  MAX_TAGS,
  normalizeTags,
  type OwnEntry,
  type PublishState,
  SUGGESTED_TAGS,
} from "./rules.ts";

/** The details a publish or an edit sends, as the form holds them. */
interface Details {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly licence: LicenceId;
  readonly creditName: string;
  /** admins only: credit as Rodeo */
  readonly official: boolean;
  /** admins only: pick it for the front of the gallery */
  readonly featured: boolean;
}

/** What the form offers: the admin's boxes, the licences the drawing may use, and where it was forked from. */
interface FormOptions {
  readonly admin: boolean;
  readonly licences: readonly LicenceId[];
  readonly forkedFrom: ForkedFrom | null;
}

/** The form's parts: the fields, the admin's boxes (apart, so the cover can sit between them), what it holds, and what is wrong with it. */
interface DetailsForm {
  readonly fields: HTMLElement;
  readonly adminChecks: HTMLElement;
  read(): Details;
  /** the first thing wrong with the fields, or null */
  problem(): string | null;
}

/** The cover's view choice, the picture made from it, and the preview of it. */
interface CoverSection {
  readonly el: HTMLElement;
  /** the picture for the chosen view, as made so far (null when there is none) */
  picture(): Promise<Blob | null>;
  /** makes a picture from the chosen view now, and shows it */
  remake(): Promise<Blob | null>;
  /** frees the preview's picture, as the dialog closes or its content changes */
  dispose(): void;
}

/** What the dialog shows for one drawing, as its state was read from the server. */
interface Ctx {
  readonly fileId: string;
  readonly modal: Modal;
  readonly state: PublishState;
  /** reads the drawing's state again and shows it */
  readonly reload: () => Promise<void>;
}

/** A dialog button's look: plain, the one the dialog is for, or unpublishing. */
type ButtonKind = "" | "primary" | "danger";

/** Opens the publish dialog for a cloud drawing. */
export function openPublishDialog(fileId: string): void {
  void showPublish(fileId);
}

/** The Share dialog's Gallery row: where the drawing stands, and a button to the publish dialog (owners only). */
export function galleryRow(fileId: string, closeShare: () => void): HTMLElement {
  const text = h("p", { cls: "gallery-share-text", text: "Checking…" });
  const action = h("button", { cls: "btn small", hidden: true, attrs: { type: "button" } });
  action.addEventListener("click", () => {
    closeShare();
    openPublishDialog(fileId);
  });
  void galleryApi.status(fileId).then(
    (state) => {
      const { entry } = state;
      if (entry?.state === "hidden") {
        text.textContent = "Taken out of the gallery by Rodeo.";
        action.textContent = "Gallery Settings…";
      } else if (entry) {
        text.textContent = `In the gallery since ${dateText(entry.publishedAt)}.`;
        action.textContent = "Gallery Settings…";
      } else if (state.canPublish) {
        text.textContent = "Not in the gallery.";
        action.textContent = "Publish to Gallery…";
      } else {
        text.textContent = state.reason ?? "Not in the gallery.";
        return;
      }
      action.hidden = false;
    },
    () => {
      text.textContent = "The gallery is not available.";
    },
  );
  return h("div", { cls: "gallery-share-row" }, text, action);
}

/** The dialog for one drawing: its state is read from the server, then shown as the drawing stands. */
async function showPublish(fileId: string): Promise<void> {
  let cover: CoverSection | null = null;
  const modal = openModal("Publish to the Gallery", "gallery-dialog", () => cover?.dispose());
  const reload = async (): Promise<void> => {
    let state: PublishState;
    try {
      state = await galleryApi.status(fileId);
    } catch (err) {
      modal.close();
      await explainFailure("Publish", err);
      return;
    }
    cover?.dispose();
    modal.body.replaceChildren();
    cover = showState({ fileId, modal, state, reload });
  };
  modal.body.append(note("Loading…"));
  await reload();
}

/** Shows the dialog's content for the drawing's state; returns the cover section it shows, if any. */
function showState(ctx: Ctx): CoverSection | null {
  const { entry, canPublish, reason } = ctx.state;
  if (entry?.state === "hidden") return showHidden(ctx, entry);
  if (entry) return showPublished(ctx, entry);
  if (!canPublish) {
    ctx.modal.body.append(note(reason ?? "This drawing can't go in the gallery."), actions(button("Close", "", ctx.modal.close)));
    return null;
  }
  return showNew(ctx);
}

/** A drawing an admin took out: why, where to ask, and unpublishing it. */
function showHidden(ctx: Ctx, entry: OwnEntry): null {
  const { modal, state } = ctx;
  modal.body.append(
    note(state.reason ?? "Rodeo took this drawing out of the gallery."),
    note("Questions? Use Help › Send Feedback."),
    h("div", { cls: "gallery-danger" }, button("Unpublish", "danger", () => void unpublish(modal, entry))),
    actions(button("Close", "", modal.close)),
  );
  return null;
}

/** The first publish: the warning, the details, the cover and the agreement. */
function showNew(ctx: Ctx): CoverSection {
  const { fileId, modal, state } = ctx;
  const previous = state.previous;
  const start: Details = previous
    ? { ...previous, official: false, featured: false }
    : {
        title: state.fileName.replace(/\.vwx$/i, "") || "Untitled drawing",
        description: "",
        tags: [],
        licence: state.defaultLicence,
        creditName: state.defaultCredit,
        official: false,
        featured: false,
      };
  const form = detailsForm(start, { admin: state.isAdmin, licences: state.licences, forkedFrom: state.forkedFrom });
  const cover = coverSection(state.size, null, true);
  const agree = check("I made this drawing, or have the right to share it under this licence.", false);
  const error = errorLine();
  const cancel = button("Cancel", "", modal.close);
  const publish: HTMLButtonElement = button("Publish", "primary", () => {
    const problem = form.problem() ?? (agree.input.checked ? null : "Tick the box to say you can share it");
    if (problem) {
      error.textContent = problem;
      return;
    }
    error.textContent = "";
    void act(publish, "Publishing…", "Publish", async () => {
      const entry = await publishVersion(fileId, form.read(), state.isAdmin, () => cover.picture());
      showDone(modal, entry);
    });
  });
  modal.body.append(publicWarning(), form.fields, cover.el, form.adminChecks, agree.row, error, actions(cancel, publish));
  return cover;
}

/** A drawing already in the gallery: its status, the details to change, the cover, and unpublishing. */
function showPublished(ctx: Ctx, entry: OwnEntry): CoverSection {
  const { fileId, modal, state, reload } = ctx;
  const form = detailsForm(
    {
      title: entry.title,
      description: entry.description,
      tags: entry.tags,
      licence: entry.licence,
      creditName: entry.creditName,
      official: entry.official,
      featured: entry.featured,
    },
    { admin: state.isAdmin, licences: state.licences, forkedFrom: entry.forkedFrom },
  );
  const cover = coverSection(state.size, entry.coverUrl, false);
  const error = errorLine();
  const forks = entry.forks === 1 ? "fork" : "forks";
  const parts: Node[] = [
    h(
      "div",
      { cls: "gallery-row" },
      note(`In the gallery since ${dateText(entry.publishedAt)} · ${entry.forks} ${forks}`),
      button("View in Gallery", "", () => void window.open(entry.path, "_blank", "noopener")),
    ),
  ];

  // a version the gallery does not show yet, or changes not saved: the owner can publish that version
  const behind = entry.versionId !== state.headVersionId;
  const dirty = store.session?.dirty === true;
  if (behind || dirty) {
    const lead = behind
      ? "The gallery shows an earlier version of this drawing."
      : "This drawing has changes the gallery does not show yet.";
    parts.push(note(dirty ? `${lead} Publishing saves your unsaved changes first.` : lead));
    if (state.canPublish) {
      const updateCover = check("Update the cover too", true);
      const publishNow: HTMLButtonElement = button("Publish This Version", "primary", () => {
        const problem = form.problem();
        if (problem) {
          error.textContent = problem;
          return;
        }
        error.textContent = "";
        void act(publishNow, "Publishing…", "Publish", async () => {
          const picture = (): Promise<Blob | null> => (updateCover.input.checked ? cover.remake() : Promise.resolve(null));
          await publishVersion(fileId, form.read(), state.isAdmin, picture);
          toast("Published this version.", "info");
          await reload();
        });
      });
      parts.push(h("div", { cls: "gallery-version" }, updateCover.row, publishNow));
    }
  }
  if (!state.canPublish && state.reason) parts.push(note(state.reason));

  const replace: HTMLButtonElement = button("Replace Cover", "", () => {
    void act(replace, "Replacing…", "Replace the cover", async () => {
      const picture = await cover.remake();
      if (!picture) {
        toast("No picture could be made from that view.");
        return;
      }
      await galleryApi.putCover(entry.id, picture);
      toast("The cover is replaced.", "info");
    });
  });
  const save: HTMLButtonElement = button("Save Details", "", () => {
    const problem = form.problem();
    if (problem) {
      error.textContent = problem;
      return;
    }
    error.textContent = "";
    void act(save, "Saving…", "Save", async () => {
      const d = form.read();
      await galleryApi.patch(entry.id, {
        title: d.title,
        description: d.description,
        tags: d.tags,
        licence: d.licence,
        creditName: d.creditName,
        ...(state.isAdmin ? { official: d.official, featured: d.featured } : {}),
      });
      toast("Details saved.", "info");
      await reload();
    });
  });

  parts.push(
    form.fields,
    cover.el,
    h("div", { cls: "gallery-cover-actions" }, replace),
    form.adminChecks,
    error,
    actions(button("Close", "", modal.close), save),
    h("div", { cls: "gallery-danger" }, button("Unpublish", "danger", () => void unpublish(modal, entry))),
  );
  modal.body.append(...parts);
  return cover;
}

/** The details form: title, description, tags with suggestion chips, credit and the licences the drawing may use, filled from `start`. */
function detailsForm(start: Details, opts: FormOptions): DetailsForm {
  const title = h("input", {
    cls: "menu-dialog-input gallery-input",
    value: start.title,
    attrs: { type: "text", maxlength: String(LIMITS.title), "aria-label": "Title" },
  });
  const description = h("textarea", {
    cls: "menu-dialog-input gallery-input",
    value: start.description,
    placeholder: "What is it, how is it built, and what would you like people to do with it?",
    attrs: { rows: "5", maxlength: String(LIMITS.description), "aria-label": "Description" },
  });

  // the tags are typed or picked from the chips; the chips show which are on
  const tagInput = h("input", {
    cls: "menu-dialog-input gallery-input",
    value: start.tags.join(", "),
    placeholder: "house, timber, kit-of-parts",
    attrs: { type: "text", "aria-label": "Tags" },
  });
  const chips = SUGGESTED_TAGS.map(({ tag, label }) => ({
    tag,
    chip: h("button", { cls: "gallery-tag-chip", text: label, attrs: { type: "button", "aria-pressed": "false" } }),
  }));
  const syncChips = (): void => {
    const now = normalizeTags(tagInput.value);
    for (const { tag, chip } of chips) {
      const on = now.includes(tag);
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", String(on));
    }
  };
  for (const { tag, chip } of chips) {
    chip.addEventListener("click", () => {
      const tags = normalizeTags(tagInput.value);
      const at = tags.indexOf(tag);
      if (at >= 0) tags.splice(at, 1);
      else tags.push(tag);
      tagInput.value = tags.join(", ");
      syncChips();
    });
  }
  tagInput.addEventListener("input", syncChips);
  syncChips();

  const credit = h("input", {
    cls: "menu-dialog-input gallery-input",
    value: start.creditName,
    disabled: start.official,
    attrs: { type: "text", maxlength: String(LIMITS.credit), "aria-label": "Credit as" },
  });
  const officialBox = check("Credit as Rodeo", start.official);
  const featuredBox = check("Pick it for the front of the gallery", start.featured);
  let creditBeforeRodeo = start.creditName;
  officialBox.input.addEventListener("change", () => {
    const on = officialBox.input.checked;
    if (on) {
      creditBeforeRodeo = credit.value;
      credit.value = "Rodeo";
    } else {
      credit.value = creditBeforeRodeo;
    }
    credit.disabled = on;
  });
  const adminChecks = h("div", { cls: "gallery-admin", hidden: !opts.admin }, officialBox.row, featuredBox.row);

  // a licence the drawing may not use is shown, but off, with the reason
  const startLicence = opts.licences.includes(start.licence) ? start.licence : opts.licences[0];
  const radios: HTMLInputElement[] = [];
  const licenceCards = LICENCES.map((l) => {
    const allowed = opts.licences.includes(l.id);
    const radio = h("input", {
      value: l.id,
      checked: l.id === startLicence,
      disabled: !allowed,
      attrs: { type: "radio", name: "gallery-licence" },
    });
    radios.push(radio);
    return h(
      "label",
      { cls: allowed ? "gallery-licence" : "gallery-licence off" },
      radio,
      h("span", { cls: "gallery-licence-name", text: l.name }),
      h("a", { cls: "gallery-licence-link", text: "Read it", attrs: { href: l.url, target: "_blank", rel: "license noopener" } }),
      h("span", { cls: "gallery-licence-summary", text: allowed ? l.summary : "The original's licence doesn't allow this one." }),
    );
  });
  const forkedFrom = opts.forkedFrom;
  const forkLicence = forkedFrom ? (licenceOf(forkedFrom.licence)?.name ?? forkedFrom.licence) : "";
  const forkNote = forkedFrom
    ? note(
        [
          `This is a fork of “${forkedFrom.title}” by ${forkedFrom.creditName} (${forkLicence}).`,
          "Its licence decides which ones you can use.",
        ].join(" "),
      )
    : null;

  const fields = h(
    "div",
    { cls: "gallery-form" },
    field("Title", title),
    field("Description", description),
    h(
      "div",
      { cls: "gallery-tags-block" },
      field("Tags", tagInput),
      h("div", { cls: "gallery-tags" }, ...chips.map((c) => c.chip)),
      note(`Up to ${MAX_TAGS}, separated by commas.`),
    ),
    field("Credit as", credit),
    h(
      "div",
      { cls: "gallery-licence-block" },
      h("p", { cls: "menu-dialog-heading", text: "Licence" }),
      forkNote,
      h("div", { cls: "gallery-licences", attrs: { role: "radiogroup", "aria-label": "Licence" } }, ...licenceCards),
    ),
  );

  return {
    fields,
    adminChecks,
    read: (): Details => {
      const picked = radios.find((r) => r.checked)?.value;
      return {
        title: title.value.trim(),
        description: description.value.trim(),
        tags: normalizeTags(tagInput.value),
        licence: isLicenceId(picked) ? picked : startLicence,
        creditName: credit.value.trim(),
        official: officialBox.input.checked,
        featured: featuredBox.input.checked,
      };
    },
    problem: (): string | null => {
      if (title.value.trim() === "") return "Enter a title";
      if (normalizeTags(tagInput.value).length > MAX_TAGS) return `Use at most ${MAX_TAGS} tags`;
      return null;
    },
  };
}

/**
 * The cover's view choice and its picture. `auto` makes a picture at once and again on each change
 * of view (a first publish); otherwise `current` (the cover in the gallery now) shows until a
 * picture is made.
 */
function coverSection(drawingBytes: number, current: string | null, auto: boolean): CoverSection {
  // the 3D view can be the cover only while it is open
  const view3d = canCapture3d();
  const drawingRadio = h("input", { value: "drawing", checked: !view3d, attrs: { type: "radio", name: "gallery-cover" } });
  const view3dRadio = h("input", { value: "view3d", checked: view3d, disabled: !view3d, attrs: { type: "radio", name: "gallery-cover" } });
  const pickedView = (): CoverSource => (view3dRadio.checked ? "view3d" : "drawing");

  const preview = h("img", { cls: "gallery-cover-preview", attrs: { alt: "The cover as the gallery shows it" } });
  const statusLine = note("");
  let objectUrl: string | null = null;
  let latest = 0;
  let closed = false;
  let pending: Promise<Blob | null> = Promise.resolve(null);

  const show = (url: string | null, text: string): void => {
    if (url) preview.src = url;
    else preview.removeAttribute("src");
    preview.hidden = url === null;
    statusLine.textContent = text;
  };

  const remake = (): Promise<Blob | null> => {
    const mine = ++latest;
    show(objectUrl ?? current, "Making the picture…");
    pending = captureCover(pickedView(), drawingBytes).then((blob) => {
      // a later choice of view was made while this one was drawn: that picture is the one wanted
      if (mine !== latest) return pending;
      if (closed) return blob;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = blob ? URL.createObjectURL(blob) : null;
      const none = auto ? "No picture: the gallery shows a placeholder." : "No picture could be made from that view.";
      show(objectUrl ?? current, blob ? "" : none);
      return blob;
    });
    return pending;
  };

  const onView = (): void => {
    if (auto) void remake();
  };
  drawingRadio.addEventListener("change", onView);
  view3dRadio.addEventListener("change", onView);
  show(current, "");
  if (auto) void remake();

  const el = h(
    "div",
    { cls: "gallery-cover" },
    h("p", { cls: "menu-dialog-heading", text: "Cover" }),
    h(
      "div",
      { cls: "gallery-cover-views", attrs: { role: "radiogroup", "aria-label": "Cover view" } },
      choice(drawingRadio, "The drawing"),
      choice(view3dRadio, "The 3D view as it is now"),
    ),
    view3d ? null : note("Open the 3D view to use it."),
    preview,
    statusLine,
  );

  return {
    el,
    picture: () => pending,
    remake,
    dispose: () => {
      closed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    },
  };
}

/**
 * The first publish, or an update of the published version: saves the drawing's unsaved changes,
 * publishes its current version with `details`, and sends the cover `picture` gives (if any).
 */
async function publishVersion(fileId: string, details: Details, isAdmin: boolean, picture: () => Promise<Blob | null>): Promise<OwnEntry> {
  if (store.session?.dirty) await appContext()?.save();
  const cover = await picture();
  const entry = await galleryApi.publish(fileId, {
    title: details.title,
    description: details.description,
    tags: details.tags,
    licence: details.licence,
    creditName: details.creditName,
    agree: true,
    ...(isAdmin ? { official: details.official, featured: details.featured } : {}),
  });
  if (cover) {
    try {
      await galleryApi.putCover(entry.id, cover);
    } catch (err) {
      toast(`Published, but the cover didn't upload: ${errorMessage(err)}`);
    }
  }
  return entry;
}

/** The first publish's result: the gallery link to copy, and a button to see it. */
function showDone(modal: Modal, entry: OwnEntry): void {
  modal.body.replaceChildren(
    h("h3", { cls: "gallery-done", text: "It's in the gallery." }),
    copyRow(location.origin + entry.path, "Gallery link"),
    actions(
      button("Done", "", modal.close),
      button("View in Gallery", "primary", () => void window.open(entry.path, "_blank", "noopener")),
    ),
  );
}

/** Takes a drawing out of the gallery, once its owner has said so. Its forks stay as they are. */
async function unpublish(modal: Modal, entry: OwnEntry): Promise<void> {
  const ok = await confirmDialog(
    "Unpublish",
    `Take “${entry.title}” out of the gallery? Its page goes at once. Forks people have made stay theirs.`,
    "Unpublish",
  );
  if (!ok) return;
  try {
    await galleryApi.unpublish(entry.id);
  } catch (err) {
    await explainFailure("Unpublish", err);
    return;
  }
  modal.close();
  toast("Unpublished.", "info");
}

/** The warning a first publish opens with: the drawing becomes public, and what that means. */
function publicWarning(): HTMLElement {
  return h(
    "div",
    { cls: "gallery-warning", attrs: { role: "note" } },
    h("p", { cls: "gallery-warning-head", text: "This makes the drawing public." }),
    h("p", {
      cls: "gallery-warning-text",
      text: "Anyone can look round it, download it and fork it: every layer, class, sheet and record in it, hidden ones too, as it was last saved. Earlier versions, comments and the people you share it with stay private. You can unpublish it at any time, but forks people have made stay theirs.",
    }),
  );
}

/** A checkbox or radio button with its label beside it, in the dialogs' layout. */
function choice(input: HTMLInputElement, label: string): HTMLElement {
  return h("label", { cls: "menu-dialog-check" }, input, label);
}

/** A checkbox with its label. */
function check(label: string, checked: boolean): { readonly row: HTMLElement; readonly input: HTMLInputElement } {
  const input = h("input", { checked, attrs: { type: "checkbox" } });
  return { row: choice(input, label), input };
}

/** A dialog button: `primary` for the one the dialog is for, `danger` for unpublishing. */
function button(text: string, kind: ButtonKind, onClick: () => void): HTMLButtonElement {
  const btn = h("button", { cls: kind === "" ? "btn" : `btn ${kind}`, text, attrs: { type: "button" } });
  btn.addEventListener("click", onClick);
  return btn;
}

/** A row of dialog buttons, right aligned as the dialogs' are. */
function actions(...buttons: HTMLElement[]): HTMLElement {
  return h("div", { cls: "menu-dialog-actions" }, ...buttons);
}

/** The line a form's problem is shown on: empty, so hidden, until there is one. */
function errorLine(): HTMLParagraphElement {
  return h("p", { cls: "gallery-error", attrs: { role: "alert" } });
}

/**
 * Runs a dialog action from its button: the button is held off and reads `busy` meanwhile, and a
 * failure is explained as `failure` names it.
 */
async function act(btn: HTMLButtonElement, busy: string, failure: string, run: () => Promise<void>): Promise<void> {
  const idle = btn.textContent;
  btn.disabled = true;
  btn.textContent = busy;
  try {
    await run();
  } catch (err) {
    await explainFailure(failure, err);
  } finally {
    btn.disabled = false;
    btn.textContent = idle;
  }
}

/** A date as the dialogs write it: "4 November 2026". */
function dateText(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

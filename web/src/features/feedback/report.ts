// Help > Report a Bug… and Request a Feature…: a short form that sends a report to the server
// (POST /api/feedback), signed in or not. It can carry the browser and app details that help
// reproduce a bug, with what Rodeo said and logged just before (app/reports.ts) and the shape of
// the drawing on screen (no names), all shown in the dialog before they go. A bug report also
// offers a screenshot of the window (capture.ts) and the file it is about: the one the user
// opened or imported into the front drawing (brought.ts), else the drawing as it is now. Both
// start ticked for a bug and unticked for anything else, and the sender sees what goes, the
// screenshot as a picture. They follow the report once it is saved, the file in parts with its
// progress on the Send button; closing the dialog then stops the file. The email field starts
// with the account's address and can be cleared.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { browserName, diagnosticsNow, platformName } from "../../app/reports.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { currentUser, feedback } from "../../platform/api.ts";
import type { FeedbackContext, FeedbackDiagnostics, FeedbackKind, ReportValue } from "../../platform/protocol.ts";
import { config } from "../account/config.ts";
import { field, footButton, openModal, type Modal } from "../account/dialog.ts";
import { broughtInto, kindOf, sizeText, type Brought } from "./brought.ts";
import { captureWorkspace } from "./capture.ts";

const KINDS: readonly { kind: FeedbackKind; label: string; prompt: string }[] = [
  { kind: "bug", label: "Bug", prompt: "What went wrong, and what did you expect? Steps to make it happen again help a lot." },
  { kind: "idea", label: "Feature idea", prompt: "What would you like Rodeo to do, and what would it help you with?" },
  { kind: "other", label: "Other", prompt: "Tell us anything." },
];

/** What a file that came in wrong usually shows: one click each, so a report needs no typing. */
const PROBLEMS = ["Objects missing", "Wrong place or size", "Wrong colours or lines", "Text looks wrong", "3D looks wrong", "Slow or froze"] as const;

const ABOUT_FILE_PROMPT =
  "What looks wrong, and where (a layer, sheet or object)? Which program and version made the file, e.g. Vectorworks 2024 or AutoCAD 2018?";
const FAILED_FILE_PROMPT = "Anything you know about the file helps: which program and version made it, and whether it opens there.";

const DETAIL_LABEL: Record<keyof FeedbackContext, string> = {
  version: "Version",
  browser: "Browser",
  platform: "System",
  screen: "Window",
  language: "Language",
  theme: "Theme",
  view: "View",
  drawing: "Drawing",
  file: "File",
};

export interface FeedbackOptions {
  /** the file the report is about (from the check after a file came in); else the front drawing's own, if any */
  readonly about?: Brought;
}

/** The file a report can bring: one the user gave, or the open drawing written out when sent. */
type Attachable = { readonly name: string; readonly size: number; bytes(): Promise<Blob | Uint8Array | null> };

export function openFeedback(kind: FeedbackKind = "bug", options: FeedbackOptions = {}): void {
  if (!config()) return;
  const about = options.about ?? broughtInto(store.session);
  let chosen = kind;
  let modal: Modal | null = null;
  const stop = new AbortController();

  const message = h("textarea", {
    cls: "acct-input acct-textarea fb-message",
    attrs: { rows: "5", maxlength: "4000", "aria-label": "Message" },
  });
  const email = h("input", {
    cls: "acct-input",
    attrs: { type: "email", inputmode: "email", autocomplete: "email", maxlength: "254", placeholder: "you@example.com" },
  });
  email.value = currentUser()?.email ?? "";
  // people never see this field; bots that fill every field do, and the server drops their reports
  const trap = h("input", { cls: "fb-trap", attrs: { type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" } });

  // ---- what's wrong, in a click (a file that came in, but not right)
  const problems = new Set<string>();
  const chips = h("div", { cls: "fb-chips", attrs: { role: "group", "aria-label": "What's wrong?" } });
  for (const p of PROBLEMS) {
    const chip = h("button", { cls: "fb-chip", text: p, attrs: { type: "button", "aria-pressed": "false" } });
    chip.addEventListener("click", () => {
      if (problems.has(p)) problems.delete(p);
      else problems.add(p);
      chip.setAttribute("aria-pressed", String(problems.has(p)));
      modal?.error(null);
    });
    chips.append(chip);
  }
  const chipsRow = h("div", { cls: "fb-chips-row", hidden: !about || about.error !== null }, h("span", { cls: "fb-chips-label", text: "What's wrong?" }), chips);

  // ---- attachments
  const file = attachable(about);
  const maxBytes = config()?.maxUploadBytes ?? Infinity;
  const fileTooBig = file !== null && file.size > maxBytes;
  const shotBox = h("input", { attrs: { type: "checkbox" } });
  const fileBox = h("input", { attrs: { type: "checkbox" } });
  const thumb = h("img", { cls: "fb-shot", attrs: { alt: "The screenshot that goes with the report" }, hidden: true });
  const shotState = h("span", { cls: "fb-attach-note", text: "" });
  let touched = false;
  let shot: Promise<Blob | null> | null = null;
  let shotUrl: string | null = null;
  const takeShot = (): void => {
    if (shot) return;
    shotState.textContent = "Taking it…";
    shot = captureWorkspace((el) => el.classList.contains("account-backdrop") || el.classList.contains("fb-check"));
    void shot.then((blob) => {
      if (stop.signal.aborted) return;
      shotState.textContent = blob ? "" : "It could not be taken.";
      if (!blob) return;
      shotUrl = URL.createObjectURL(blob);
      thumb.src = shotUrl;
      thumb.hidden = !shotBox.checked;
    });
  };
  const setAttach = (on: boolean): void => {
    shotBox.checked = on;
    fileBox.checked = on && file !== null && !fileTooBig;
    syncAttach();
  };
  const syncAttach = (): void => {
    if (shotBox.checked) takeShot();
    thumb.hidden = !shotBox.checked || !shotUrl;
  };
  shotBox.addEventListener("change", () => {
    touched = true;
    syncAttach();
  });
  fileBox.addEventListener("change", () => {
    touched = true;
  });
  fileBox.disabled = file === null || fileTooBig;
  const fileLabel = file
    ? fileTooBig
      ? `${file.name} (${sizeText(file.size)}: too large to send, the most is ${sizeText(maxBytes)})`
      : `${file.name} (${file.size > 0 ? sizeText(file.size) : "written out when you send"})`
    : "";
  const attach = h(
    "div",
    { cls: "fb-attach" },
    h("label", { cls: "menu-dialog-check" }, shotBox, "A screenshot of the window", shotState),
    thumb,
    file ? h("label", { cls: "menu-dialog-check" }, fileBox, `The file: ${fileLabel}`) : null,
    h("p", { cls: "fb-attach-note", text: "Only the Rodeo team sees these, to find and fix the problem. They're deleted after 90 days." }),
  );

  // ---- details
  const context = feedbackContext(about);
  const include = h("input", { attrs: { type: "checkbox" } });
  include.checked = true;
  const trailCount = diagnosticsNow().trail.length;
  const details = h("p", {
    cls: "fb-details",
    text: contextText(context) + (trailCount > 0 ? `, and the last ${trailCount} things Rodeo showed or logged` : ""),
  });
  include.addEventListener("change", () => details.classList.toggle("off", !include.checked));

  const kinds = h("div", { cls: "seg fb-kinds", attrs: { role: "radiogroup", "aria-label": "What is it?" } });
  const pick = (next: FeedbackKind): void => {
    chosen = next;
    for (const btn of kinds.querySelectorAll<HTMLButtonElement>("button")) {
      const on = btn.dataset.kind === next;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
    }
    message.placeholder =
      next === "bug" && about ? (about.error ? FAILED_FILE_PROMPT : ABOUT_FILE_PROMPT) : KINDS.find((k) => k.kind === next)!.prompt;
    chipsRow.hidden = next !== "bug" || !about || about.error !== null;
    // a screenshot and the file help with a bug, and aren't wanted with an idea, until the sender says otherwise
    if (!touched) setAttach(next === "bug");
  };
  for (const k of KINDS) {
    const btn = h("button", { cls: "seg-btn", text: k.label, attrs: { type: "button", role: "radio", "data-kind": k.kind } });
    btn.addEventListener("click", () => pick(k.kind));
    kinds.append(btn);
  }
  pick(kind);

  const sendButton = footButton("Send", true, () => void send());
  const say = (text: string): void => {
    sendButton.textContent = text;
  };
  const send = async (): Promise<void> => {
    const text = message.value.trim();
    const withShot = shotBox.checked;
    const withFile = fileBox.checked && file !== null;
    const parts = [...(problems.size > 0 ? [`What's wrong: ${[...problems].join(", ")}`] : []), ...(text ? [text] : [])];
    let body = parts.join("\n\n");
    if (body.length < 3) {
      if (!withShot && !withFile) {
        modal?.error("Write a few words about it first.");
        message.focus();
        return;
      }
      // the screenshot and the file say it: a report from the check after a file came in needs no typing
      body = about ? `${about.error ? "Didn't come in" : "Came in wrong"}: ${about.name} (no description)` : "(no description: see the screenshot)";
    }
    const address = email.value.trim();
    if (address && !email.checkValidity()) {
      modal?.error("Email: enter a valid address, or leave it empty.");
      return;
    }
    modal?.error(null);
    sendButton.disabled = true;
    let saved = false;
    try {
      let picture: Blob | null = null;
      if (withShot) {
        say("Taking the screenshot…");
        takeShot();
        picture = await shot;
      }
      let bytes: Blob | Uint8Array | null = null;
      if (withFile) {
        say(file.size > 0 ? "Reading the file…" : "Writing out the drawing…");
        bytes = await file.bytes();
      }
      const size = bytes instanceof Blob ? bytes.size : (bytes?.length ?? 0);
      say("Sending…");
      const sent = await feedback.send({
        kind: chosen,
        message: body,
        email: address || null,
        context: include.checked ? context : null,
        diagnostics: include.checked ? diagnostics() : null,
        attach: { screenshot: picture !== null, file: bytes && size > 0 ? { name: file!.name, size } : null },
        website: trap.value,
      });
      saved = true;
      const missed: string[] = [];
      if (picture && sent.token) {
        await feedback.screenshot(sent, picture).catch((err: unknown) => missed.push(`the screenshot (${errorMessage(err)})`));
      }
      if (bytes && size > 0 && sent.token && !sent.fileRefused) {
        await feedback
          .file(sent, bytes, (done, total) => say(`Sending the file… ${Math.floor((done / total) * 100)}%`), stop.signal)
          .catch((err: unknown) => missed.push(stop.signal.aborted ? "the file, stopped when the form closed" : `the file (${errorMessage(err)})`));
      } else if (bytes && sent.fileRefused) {
        missed.push(`the file (${sent.fileRefused})`);
      }
      modal?.close();
      if (missed.length > 0) toast(`Thanks. Your report reached us, but not ${missed.join(" or ")}.`, "info");
      else toast(chosen === "idea" ? "Thanks for the idea. It's on its way to us." : "Thanks. Your report is on its way to us.", "info");
    } catch (err) {
      if (saved) toast(`Thanks. Your report reached us, but what came with it didn't: ${errorMessage(err)}`, "info");
      else modal?.error(errorMessage(err));
    } finally {
      sendButton.disabled = false;
      say("Send");
    }
  };

  modal = openModal({
    title: about && chosen === "bug" ? (about.error ? `Report: ${about.name} didn't come in` : `Report a problem with ${about.name}`) : "Send Feedback",
    cls: "fb-dialog",
    body: [
      kinds,
      chipsRow,
      message,
      attach,
      field("Email, if you'd like a reply", email),
      h("label", { cls: "menu-dialog-check fb-include" }, include, "Include browser and app details"),
      details,
      trap,
    ],
    actions: [footButton("Cancel", false, () => modal?.close()), sendButton],
    onClose: () => {
      stop.abort();
      if (shotUrl) URL.revokeObjectURL(shotUrl);
    },
  });
  message.focus();
}

/** The details as one line, "Browser: Chrome 140 · System: macOS · …", as the form and the inbox show them. */
export function contextText(context: FeedbackContext): string {
  return Object.entries(context)
    .filter(([key, value]) => value && key in DETAIL_LABEL)
    .map(([key, value]) => `${DETAIL_LABEL[key as keyof FeedbackContext]}: ${value}`)
    .join(" · ");
}

/** The file a report can bring: `about`'s, or with none the front drawing as it is now. */
function attachable(about: Brought | null): Attachable | null {
  if (about) {
    const size = about.size;
    return { name: about.name, size, bytes: async () => (size > 0 ? about.file : null) };
  }
  const ctx = appContext();
  if (!store.session || !ctx) return null;
  const name = /\.(vwx|sta)$/i.test(store.fileName) ? store.fileName : `${store.fileName || "Drawing"}.vwx`;
  return { name, size: 0, bytes: () => ctx.documentBytes() };
}

/** What helps reproduce a bug: the app, browser and window, whether a drawing is open, and the file. */
function feedbackContext(about: Brought | null): FeedbackContext {
  const ua = navigator.userAgent;
  const out: Record<string, string> = {
    browser: browserName(ua),
    platform: platformName(ua),
    screen: `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}x`,
    language: navigator.language,
    theme: document.documentElement.dataset.theme ?? "dark",
    view: store.view3d ? "3D" : "2D",
    drawing: store.session ? "open" : "none",
  };
  if (about) out.file = `${kindOf(about.name)}, ${sizeText(about.size)}, ${about.error ? `didn't come in: ${about.error}` : "came in"}`;
  const version = config()?.version;
  return version ? { version, ...out } : out;
}

/** The build, browser, GPU and memory, what happened just before, and the drawing's shape. */
function diagnostics(): FeedbackDiagnostics {
  const { env, trail } = diagnosticsNow();
  return { env, workspace: workspace(), trail };
}

/** The drawing on screen by its counts: how many layers, sheets, classes and objects, and the view. No names. */
function workspace(): Record<string, ReportValue> {
  const s = store.session;
  if (!s) return { drawing: "none" };
  const layers = s.doc.layers();
  const active = layers.find((l) => l.id === store.activeLayerId);
  const ctx = appContext();
  return {
    designLayers: layers.filter((l) => l.kind === "design").length,
    sheetLayers: layers.filter((l) => l.kind === "sheet").length,
    classes: s.doc.classes().length,
    objects: layers.reduce((n, l) => n + l.objectCount, 0),
    activeLayer: active ? `${active.kind}, 1:${active.scale}, ${active.objectCount} objects` : "none",
    view: store.view3d ? `3D, ${ctx?.renderMode() ?? "?"}` : "2D",
    selected: store.selection.size,
    unsaved: s.dirty,
  };
}

// The forms of crit mode: a text box with a voice note and Post, used for a new
// pin, a new redline and a reply. Posting uploads the voice note first, then
// makes the comment (comments.add), and the new comment joins the threads.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { errorMessage } from "../../app/toast.ts";
import { comments as api } from "../../platform/api.ts";
import type { Comment } from "../../platform/protocol.ts";
import { anchorScreen } from "./anchor.ts";
import { closePopover, popoverKind, showPopover } from "./popover.ts";
import { crit } from "./state.ts";
import { voiceRecorder } from "./voice.ts";

type Audio = NonNullable<Comment["audio"]>;

export interface Composer {
  readonly el: HTMLElement;
  focus(): void;
}

interface ComposerOptions {
  readonly label: string;
  readonly placeholder: string;
  readonly submit: string;
  /** makes the comment; throws to show its message in the form */
  readonly onSubmit: (body: string, audio: Audio | null) => Promise<void>;
  /** when given, the form has a Cancel button */
  readonly onCancel?: () => void;
}

/** A text box, a voice note and Post, for one comment. */
export function composer(opts: ComposerOptions): Composer {
  const text = h("textarea", {
    cls: "crit-text",
    attrs: { rows: "3", placeholder: opts.placeholder, "aria-label": opts.label },
  });
  const error = h("p", { cls: "crit-error", attrs: { role: "alert" }, hidden: true });
  const post = h("button", { cls: "btn primary", text: opts.submit, attrs: { type: "submit" } });
  const voice = voiceRecorder();
  const actions = h("div", { cls: "crit-actions" });
  if (opts.onCancel) {
    const cancel = h("button", { cls: "btn", text: "Cancel", attrs: { type: "button" } });
    cancel.addEventListener("click", () => opts.onCancel?.());
    actions.append(cancel);
  }
  actions.append(post);
  const form = h("form", { cls: "crit-compose", attrs: { "aria-label": opts.label } }, text, voice.el, error, actions);

  let busy = false;
  const fail = (message: string): void => {
    error.textContent = message;
    error.hidden = false;
  };

  async function send(): Promise<void> {
    if (busy) return;
    busy = true;
    error.hidden = true;
    post.disabled = true;
    post.textContent = "Posting…";
    try {
      const body = text.value.trim();
      const note = await voice.finish();
      if (!body && !note) throw new Error("Write a comment, or record a voice note.");
      const fileId = crit.fileId;
      if (!fileId) throw new Error("This drawing is not in the cloud.");
      let audio: Audio | null = null;
      if (note) audio = { id: await api.uploadAudio(fileId, note.blob), durationMs: Math.round(note.durationMs) };
      await opts.onSubmit(body, audio);
      text.value = "";
      voice.discard();
    } catch (err) {
      fail(errorMessage(err));
    } finally {
      busy = false;
      post.disabled = false;
      post.textContent = opts.submit;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void send();
  });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  });

  return {
    el: form,
    focus: () => text.focus(),
  };
}

/** The pin being placed: its text and voice note, beside the pin, until it is posted or cancelled. */
export function openPinComposer(): void {
  if (!crit.pinDraft) return;
  const form = composer({
    label: "New comment pin",
    placeholder: "Comment on this spot…",
    submit: "Post",
    onCancel: () => closePopover(),
    onSubmit: async (body, audio) => {
      const fileId = crit.fileId;
      const anchor = crit.pinDraft;
      if (!fileId || !anchor) throw new Error("Place the pin again.");
      const made = await api.add(fileId, { parentId: null, body, anchor, strokes: [], audio });
      crit.pinDraft = null;
      crit.upsert(made);
      closePopover();
    },
  });
  showPopover(form.el, "pin", () => anchorScreen(crit.pinDraft), () => {
    crit.pinDraft = null;
    crit.changed();
    appContext()?.requestDraw();
  });
  form.focus();
}

/** The redline being posted: its text and voice note, beside the first stroke. */
export function openRedlineComposer(): void {
  if (crit.strokes.length === 0 || popoverKind() === "redline") return;
  const form = composer({
    label: "New redline note",
    placeholder: "What should change here?",
    submit: "Post",
    onCancel: () => closePopover(),
    onSubmit: async (body, audio) => {
      const fileId = crit.fileId;
      const sent = [...crit.strokes];
      const first = sent[0];
      const start = first?.points[0];
      if (!fileId || !first || !start) throw new Error("Draw the redline again.");
      const made = await api.add(fileId, {
        parentId: null,
        body,
        anchor: { kind: "2d", layerId: first.layerId, x: start[0], y: start[1] },
        strokes: sent,
        audio,
      });
      crit.strokes = crit.strokes.filter((s) => !sent.includes(s));
      crit.upsert(made);
      closePopover();
    },
  });
  showPopover(form.el, "redline", () => {
    const first = crit.strokes[0];
    const start = first?.points[0];
    return first && start ? anchorScreen({ kind: "2d", layerId: first.layerId, x: start[0], y: start[1] }) : null;
  }, () => {
    appContext()?.requestDraw();
    crit.changed();
  });
  form.focus();
}

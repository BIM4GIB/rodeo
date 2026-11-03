// Pieces the cloud dialogs and palettes share: the dialog shell of menubar.ts
// without buttons, a Copy button, a row for a field in a dialog, a drawing's
// thumbnail, and how sizes and times read.

import { h } from "../../app/dom.ts";
import { toast } from "../../app/toast.ts";
import { files } from "../../platform/api.ts";
import type { CloudFile } from "../../platform/protocol.ts";
import "./cloud.css";

const PLACEHOLDER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 7.5 12 12l8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

export interface Modal {
  /** the dialog's body: its controls go here */
  readonly body: HTMLElement;
  /** closes the dialog, as Esc or a press outside it does */
  close(): void;
}

/**
 * A dialog in the editor's style with a title and no buttons of its own. Esc or a press outside
 * closes it, and every key stays inside it, as with showDialog (the window's shortcuts do not run).
 */
export function openModal(title: string, cls: string, onClose?: () => void): Modal {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const body = h("div", { cls: "cloud-modal-body" });
  const box = h(
    "div",
    { cls: `menu-dialog cloud-modal ${cls}`, attrs: { role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" } },
    h("h2", { cls: "menu-dialog-title", text: title }),
    body,
  );
  const backdrop = h("div", { cls: "menu-dialog-backdrop" }, box);
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    backdrop.remove();
    returnFocus?.focus();
    onClose?.();
  };
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  // focused so that Esc reaches the backdrop from the start
  box.focus();
  return { body, close };
}

/** Copies text to the clipboard; false when the browser refuses. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A Copy button for the text in `field`. Where the browser refuses the clipboard, the field is selected instead. */
export function copyButton(field: HTMLInputElement): HTMLButtonElement {
  const btn = h("button", { cls: "btn small", text: "Copy", attrs: { type: "button" } });
  btn.addEventListener("click", () => {
    void copyText(field.value).then((ok) => {
      if (ok) {
        btn.textContent = "Copied";
        window.setTimeout(() => {
          btn.textContent = "Copy";
        }, 1500);
        return;
      }
      field.select();
      toast("The browser would not copy it, so the text is selected: copy it yourself.", "info");
    });
  });
  return btn;
}

/** A read-only field holding a link or a code, with its Copy button. */
export function copyRow(text: string, label: string): HTMLElement {
  const field = h("input", { cls: "share-input share-code", value: text, attrs: { type: "text", readonly: "", "aria-label": label } });
  return h("div", { cls: "share-copy-row" }, field, copyButton(field));
}

/** A labelled control in a dialog, in the menu dialogs' layout. */
export function field(label: string, control: HTMLElement): HTMLLabelElement {
  return h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
}

/** A line of muted text. */
export function note(text: string, cls = "cloud-note"): HTMLParagraphElement {
  return h("p", { cls, text });
}

/** A size in bytes as "512 bytes", "120 KB" or "1.4 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)} ${units[unit]}`;
}

const RELATIVE = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

/** A time as "3 hours ago" or "yesterday"; a month or more back, the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const ago = (now - then) / 1000;
  if (ago < 60) return "just now";
  if (ago < 3600) return RELATIVE.format(-Math.round(ago / 60), "minute");
  if (ago < 86400) return RELATIVE.format(-Math.round(ago / 3600), "hour");
  if (ago < 30 * 86400) return RELATIVE.format(-Math.round(ago / 86400), "day");
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A drawing's thumbnail, or a placeholder when it has none or the picture does not load. */
export function cardThumb(file: CloudFile, cls: string): HTMLElement {
  const placeholder = (): HTMLElement => h("div", { cls: `${cls} cloud-thumb-empty`, html: PLACEHOLDER_ICON, attrs: { "aria-hidden": "true" } });
  if (!file.hasThumbnail) return placeholder();
  const img = h("img", { cls, attrs: { src: files.thumbnailUrl(file.id, file.updatedAt), alt: "", loading: "lazy" } });
  img.addEventListener("error", () => img.replaceWith(placeholder()));
  return img;
}

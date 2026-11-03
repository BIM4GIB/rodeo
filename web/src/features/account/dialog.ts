// The dialog shell the account features share. It takes the look of the menu dialogs
// (menubar.css) but leaves its controls to the caller, and stays open while they work
// (a rename, a sign-in link sent), where showDialog closes on OK. As showDialog does, it
// keeps every key inside the dialog, and Escape or a click outside closes it.

import { h } from "../../app/dom.ts";

export interface ModalSpec {
  readonly title: string;
  /** extra class for the box, e.g. a wider one */
  readonly cls?: string;
  /** the controls under the title */
  readonly body: readonly Node[];
  /** the buttons at the foot */
  readonly actions: readonly Node[];
  /** runs once, when the dialog closes for any reason */
  readonly onClose?: () => void;
}

export interface Modal {
  /** shows a message in the dialog's error line, or hides it (null) */
  error(message: string | null): void;
  close(): void;
}

export function openModal(spec: ModalSpec): Modal {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const errorLine = h("p", { cls: "menu-dialog-error", attrs: { role: "alert" }, hidden: true });
  const box = h(
    "div",
    {
      cls: spec.cls ? `menu-dialog account-dialog ${spec.cls}` : "menu-dialog account-dialog",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": spec.title },
    },
    h("h2", { cls: "menu-dialog-title", text: spec.title }),
    ...spec.body,
    errorLine,
    h("div", { cls: "menu-dialog-actions" }, ...spec.actions),
  );
  const backdrop = h("div", { cls: "menu-dialog-backdrop account-backdrop" }, box);
  let open = true;
  const modal: Modal = {
    error(message) {
      errorLine.textContent = message ?? "";
      errorLine.hidden = message === null;
    },
    close() {
      if (!open) return;
      open = false;
      backdrop.remove();
      returnFocus?.focus();
      spec.onClose?.();
    },
  };
  // an edit clears the message, which was about the old values
  box.addEventListener("input", () => modal.error(null));
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      modal.close();
    }
  });
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) modal.close();
  });
  document.body.append(backdrop);
  const first = box.querySelector<HTMLElement>("input, textarea, select") ?? box.querySelector<HTMLElement>("button");
  first?.focus();
  return modal;
}

/** A button for a dialog's foot that closes it, or runs `run` first. */
export function footButton(label: string, primary: boolean, run: () => void): HTMLButtonElement {
  const btn = h("button", { cls: primary ? "btn primary" : "btn", text: label, attrs: { type: "button" } });
  btn.addEventListener("click", run);
  return btn;
}

/** A label stacked over its control, as the dialogs lay out their fields. */
export function field(label: string, control: HTMLElement): HTMLElement {
  return h("label", { cls: "acct-field" }, h("span", { cls: "acct-field-label", text: label }), control);
}

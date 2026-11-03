// Sign-in. openSignIn shows the dialog: an emailed link, or a provider (Google,
// Microsoft, GitHub) where the server has one. requireSignIn is what features call
// before an action that needs an account. Signing in is optional: the editor works
// without one.

import { h } from "../../app/dom.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { account, userReady } from "../../platform/api.ts";
import type { ServerConfig } from "../../platform/protocol.ts";
import { config, loadConfig } from "./config.ts";
import { field, footButton, openModal, type Modal } from "./dialog.ts";

type Provider = ServerConfig["auth"]["oauth"][number];

const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", microsoft: "Microsoft", github: "GitHub" };
const RESEND_AFTER = 30;
const OPTIONAL =
  "Signing in is optional: the editor works without an account. An account adds cloud drawings, version history, live collaboration and crit mode.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Resolves true at once when someone is signed in. Otherwise opens the sign-in dialog, with
 * `reason` as its subtitle, and resolves false when it closes. Signing in with a provider
 * leaves the page, so the dialog never closes then.
 */
export async function requireSignIn(reason: string): Promise<boolean> {
  if (await userReady()) return true;
  if (!(config() ?? (await loadConfig()))) {
    toast("Signing in is not set up on this server.", "info");
    return false;
  }
  return new Promise((resolve) => openSignIn(reason, () => resolve(false)));
}

/** Opens the sign-in dialog; `reason` is its subtitle (none when empty), `onClose` runs when it closes. */
export function openSignIn(reason: string, onClose?: () => void): void {
  const cfg = config();
  if (!cfg) return;
  let modal: Modal | null = null;
  let timer = 0;
  const stopTimer = (): void => window.clearInterval(timer);
  const area = h("div", { cls: "acct-area" });

  const send = async (address: string): Promise<boolean> => {
    modal?.error(null);
    try {
      await account.emailSignIn(address);
      return true;
    } catch (err) {
      modal?.error(errorMessage(err));
      return false;
    }
  };

  const resend = (address: string): HTMLButtonElement => {
    const btn = h("button", { cls: "btn", text: "Send it again", attrs: { type: "button" } });
    let left = 0;
    const tick = (): void => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Send it again in ${left} s` : "Send it again";
    };
    const wait = (): void => {
      stopTimer();
      left = RESEND_AFTER;
      tick();
      timer = window.setInterval(() => {
        left -= 1;
        tick();
        if (left <= 0) stopTimer();
      }, 1000);
    };
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void send(address).then((ok) => (ok ? wait() : tick()));
    });
    wait();
    return btn;
  };

  const showSent = (address: string): void => {
    const other = h("button", { cls: "btn", text: "Use another email", attrs: { type: "button" } });
    other.addEventListener("click", () => showMethods());
    area.replaceChildren(
      h("p", { cls: "acct-status", text: "Check your inbox for a sign-in link" }),
      h("p", { cls: "acct-note", text: `We sent it to ${address}. The link works for 15 minutes.` }),
      h("div", { cls: "acct-row" }, resend(address), other),
    );
  };

  const emailForm = (): HTMLFormElement => {
    const input = h("input", {
      cls: "acct-input",
      attrs: { type: "email", autocomplete: "email", spellcheck: "false", placeholder: "you@example.com", "aria-label": "Email address" },
    });
    const submit = h("button", { cls: "btn primary acct-wide", text: "Email me a sign-in link", attrs: { type: "submit" } });
    const form = h("form", { cls: "acct-form", attrs: { novalidate: "" } }, field("Email", input), submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const address = input.value.trim();
      if (!EMAIL.test(address)) {
        modal?.error("Enter an email address, such as you@example.com.");
        input.focus();
        return;
      }
      submit.disabled = true;
      void send(address).then((ok) => {
        if (ok) showSent(address);
        else submit.disabled = false;
      });
    });
    return form;
  };

  const providerButton = (p: Provider): HTMLButtonElement => {
    const btn = h("button", { cls: "btn acct-provider", text: `Continue with ${PROVIDER_NAMES[p]}`, attrs: { type: "button" } });
    btn.addEventListener("click", () => {
      location.href = account.oauthUrl(p);
    });
    return btn;
  };

  const showMethods = (): void => {
    stopTimer();
    const nodes: Node[] = [];
    if (cfg.auth.oauth.length) nodes.push(h("div", { cls: "acct-providers" }, ...cfg.auth.oauth.map(providerButton)));
    if (cfg.auth.oauth.length && cfg.auth.email) nodes.push(h("div", { cls: "acct-divider", text: "or" }));
    if (cfg.auth.email) nodes.push(emailForm());
    if (!cfg.auth.oauth.length && !cfg.auth.email) nodes.push(h("p", { cls: "acct-note", text: "No sign-in methods are set up on this server." }));
    area.replaceChildren(...nodes);
  };
  showMethods();

  modal = openModal({
    title: "Sign in",
    body: [
      ...(reason ? [h("p", { cls: "acct-subtitle", text: reason })] : []),
      h("p", { cls: "acct-lead", text: OPTIONAL }),
      area,
    ],
    actions: [footButton("Cancel", false, () => modal?.close())],
    onClose: () => {
      stopTimer();
      onClose?.();
    },
  });
}

// The account control at the end of the top bar, and again at the end of the start hub's
// header: "Sign in" when nobody is signed in, else the user's avatar, which opens the account
// menu (who and which plan, Account…, Manage Plan or Get Rodeo Plus…, Sign Out).

import { h } from "../../app/dom.ts";
import { menuButton, type Row } from "../../app/menu.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { account, currentUser, onUser, userLoaded } from "../../platform/api.ts";
import type { User } from "../../platform/protocol.ts";
import { openAccountDialog } from "./accountDialog.ts";
import { config, onConfig } from "./config.ts";
import { avatarColour, formatDate, initialsOf, isWebUrl } from "./format.ts";
import { openSignIn } from "./signin.ts";
import { managePlan, openSupporterDialog } from "./supporter.ts";

/** The small star that marks Rodeo Plus. */
export const STAR = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.2l1.45 3 3.3.45-2.4 2.3.58 3.25L6 8.8 3.07 10.2l.58-3.25-2.4-2.3 3.3-.45z" fill="currentColor"/></svg>`;

/** A head and shoulders: Sign in on a phone. */
const PERSON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="5.6" r="2.8"/><path d="M2.8 14c.6-2.7 2.7-4.3 5.2-4.3s4.6 1.6 5.2 4.3"/></svg>`;

/**
 * The account control, in the top bar or in the start hub's header (where Sign in is a plain button
 * that keeps its words on a phone). Hidden until the server has answered, and with no server.
 */
export function accountSlot(place: "topbar" | "hub" = "topbar"): HTMLElement {
  const slot = h("div", { cls: place === "hub" ? "acct-slot acct-hub" : "acct-slot", hidden: true });
  // on a phone the top bar's button keeps to its icon (account.css), with its words for its name
  const signIn =
    place === "hub"
      ? h("button", { cls: "btn", text: "Sign in", attrs: { type: "button", title: "Sign in to keep your drawings in the cloud" } })
      : h(
          "button",
          { cls: "tb-btn acct-signin", attrs: { type: "button", "aria-label": "Sign in", title: "Sign in" } },
          h("span", { cls: "acct-signin-icon", html: PERSON }),
          h("span", { cls: "acct-signin-label", text: "Sign in" }),
        );
  signIn.addEventListener("click", () => openSignIn(""));
  const avatar = h("button", { cls: "acct-avatar", attrs: { type: "button", "aria-label": "Account", title: "Account" } });
  menuButton(avatar, accountRows);
  slot.append(signIn, avatar);

  const render = (): void => {
    const user = currentUser();
    slot.hidden = !config() || !userLoaded();
    signIn.hidden = user !== null;
    avatar.hidden = user === null;
    if (user) avatar.replaceChildren(avatarFace(user));
  };
  onConfig(render);
  onUser(render);
  return slot;
}

/** The rows of the account menu, read as it opens. */
function accountRows(): Row[] {
  const cfg = config();
  const user = currentUser();
  if (!cfg || !user) return [];
  const supporter = user.plan === "supporter";
  const until = user.supporterUntil ? formatDate(user.supporterUntil) : "";
  const rows: Row[] = [
    { label: user.name || user.email, enabled: () => false },
    { label: user.email, enabled: () => false },
    "-",
    supporter
      ? { label: until ? `Plus until ${until}` : "Rodeo Plus", icon: STAR, enabled: () => false }
      : { label: "Free plan", enabled: () => false },
    "-",
    { label: "Account…", run: openAccountDialog },
  ];
  if (cfg.billing) {
    rows.push(supporter ? { label: "Manage Plan…", run: () => void managePlan() } : { label: "Get Rodeo Plus…", run: openSupporterDialog });
  }
  rows.push("-", { label: "Sign Out", run: () => void signOut() });
  return rows;
}

async function signOut(): Promise<void> {
  try {
    await account.logout();
    toast("Signed out", "info");
  } catch (err) {
    toast(errorMessage(err));
  }
}

/** The avatar picture, or the initials on a colour of their own when there is no picture. */
function avatarFace(user: User): HTMLElement {
  if (user.avatarUrl && isWebUrl(user.avatarUrl)) {
    return h("img", { cls: "acct-avatar-img", attrs: { src: user.avatarUrl, alt: "", referrerpolicy: "no-referrer" } });
  }
  const initials = h("span", { cls: "acct-initials", text: initialsOf(user.name, user.email) });
  initials.style.background = avatarColour(user.email);
  return initials;
}

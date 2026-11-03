// The account feature: optional sign-in, Rodeo Plus, donations and the start hub's ad. It
// registers with app/ext.ts when imported. Everything shows only when the server answers
// /api/config; with no server (a static host) nothing does.

import { onReady, registerMenu, registerTopBar, registerUrlHandler, registerWelcome } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { toast } from "../../app/toast.ts";
import { currentUser, refreshUser } from "../../platform/api.ts";
import { openFundingSettings } from "./adminFunding.ts";
import { config, loadConfig } from "./config.ts";
import { balanceBeforeTopUp, creditTerms, formatCredit } from "./credit.ts";
import { openFundingDialog } from "./funding.ts";
import { adCard } from "./ad.ts";
import { donateLink } from "./hub.ts";
import { accountSlot } from "./topbar.ts";
import "./account.css";

/** Settles once the start-up config and sign-in check are in; the URL handlers wait for it. */
let booted: Promise<void> = Promise.resolve();

onReady(() => {
  booted = (async () => {
    if ((await loadConfig()) === null) return;
    await refreshUser();
  })();
});

/** Removes a parameter from the address bar, so a reload does not repeat what it asked for. */
function dropParam(name: string): void {
  try {
    const url = new URL(location.href);
    url.searchParams.delete(name);
    history.replaceState(history.state, "", url.toString());
  } catch {
    // the address bar keeps the parameter; nothing else depends on it
  }
}

// the sign-in redirect returns with ?signed-in=1
registerUrlHandler("signed-in", () => {
  dropParam("signed-in");
  void booted.then(() => {
    if (!config()) return;
    const user = currentUser();
    if (user) toast(`Signed in as ${user.name || user.email}`, "info");
    else toast("Sign-in did not complete. Try again.");
  });
});

// a Rodeo Plus checkout returns with ?billing=success or ?billing=cancel
registerUrlHandler("billing", (value) => {
  dropParam("billing");
  // a cancelled checkout has nothing to say
  if (value !== "success") return;
  void booted.then(async () => {
    if (!config()) return;
    // the plan changes when Stripe's webhook lands, a moment after the return
    await refreshUser();
    for (let i = 0; i < 5 && currentUser() && currentUser()?.plan !== "supporter"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await refreshUser();
    }
    toast("Welcome to Rodeo Plus. Thank you for supporting Rodeo", "info");
  });
});

// an AI credit top-up returns with ?credit=success or ?credit=cancel
registerUrlHandler("credit", (value) => {
  dropParam("credit");
  if (value !== "success") return;
  void booted.then(async () => {
    const t = creditTerms();
    if (!t) return;
    // the credit lands with Stripe's webhook, which may come a moment after the return
    const before = balanceBeforeTopUp();
    await refreshUser();
    for (let i = 0; before !== null && i < 5 && (currentUser()?.aiCredit ?? 0) <= before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await refreshUser();
    }
    const now = currentUser()?.aiCredit ?? 0;
    const landed = before === null || now > before;
    toast(landed ? `Thanks: you have ${formatCredit(now, t.currency)} of AI credit` : "Thanks: your AI credit will show in a moment", "info");
  });
});

registerTopBar(() => accountSlot("topbar"), "right");

// the start hub: Sign in or the avatar in its header, its one ad under Recent, and Donate in its footer
registerWelcome(() => accountSlot("hub"), "head");
registerWelcome(adCard, "main");
registerWelcome(donateLink, "foot");

registerMenu("Help", () => {
  const cfg = config();
  const user = currentUser();
  const rows: Row[] = [];
  if (cfg?.funding) rows.push({ label: "Support Rodeo…", run: openFundingDialog });
  if (cfg && user?.admin) rows.push({ label: "Funding and Sponsor Settings…", run: openFundingSettings });
  return rows;
});

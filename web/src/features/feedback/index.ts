// The feedback feature: Help > Report a Bug… and Request a Feature… (report.ts), a link in the
// start hub's footer that opens the same form, the check after a file comes in that offers to
// report it (check.ts), and for admins Help > Feedback Inbox… (inbox.ts), Help > Error Reports…
// (errors.ts, what the editor reported on its own) and Help > Admin Page… (the page at /admin).
// The admin page links back to the inbox and the reports with ?admin=feedback and ?admin=errors.
// It registers with app/ext.ts when imported; with no server to send to, none of it shows.

import "./feedback.css";
import "./check.ts";
import { h } from "../../app/dom.ts";
import { registerMenu, registerUrlHandler, registerWelcome } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { currentUser, onUser, userLoaded } from "../../platform/api.ts";
import { config, onConfig } from "../account/config.ts";
import { openErrorReports } from "./errors.ts";
import { openFeedbackInbox } from "./inbox.ts";
import { openFeedback } from "./report.ts";

registerMenu("Help", () => {
  if (!config()) return [];
  const rows: Row[] = [
    { label: "Report a Bug…", run: () => openFeedback("bug") },
    { label: "Request a Feature…", run: () => openFeedback("idea") },
  ];
  if (currentUser()?.admin === true) {
    rows.push(
      { label: "Feedback Inbox…", run: openFeedbackInbox },
      { label: "Error Reports…", run: openErrorReports },
      { label: "Admin Page…", run: () => void window.open("/admin", "_blank", "noopener") },
    );
  }
  return rows;
});

registerUrlHandler("admin", (value) => {
  // whether the account is an admin's is known once /api/me has answered
  const stop = onUser(() => {
    if (!userLoaded()) return;
    queueMicrotask(() => stop());
    if (value === "feedback") openFeedbackInbox();
    else if (value === "errors") openErrorReports();
  });
});

registerWelcome(feedbackLink, "foot");

/** The start hub's footer link to the same form (where a bug or an idea is chosen). */
function feedbackLink(): HTMLElement {
  const link = h("button", { cls: "hub-link", text: "Feedback", hidden: true, attrs: { type: "button" } });
  link.addEventListener("click", () => openFeedback("bug"));
  onConfig(() => {
    link.hidden = config() === null;
  });
  return link;
}

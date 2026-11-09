// The feedback feature: Help > Report a Bug… and Request a Feature… (report.ts), a link in the
// start hub's footer that opens the same form, the check after a file comes in that offers to
// report it (check.ts), and for admins Help > Admin Panel… (the page at /admin, where the reports,
// the error reports and every other admin tool live). Old links to the editor's inbox and error
// windows (?admin=feedback, ?admin=errors) go to the admin page's tabs. It registers with
// app/ext.ts when imported; with no server to send to, none of it shows.

import "./feedback.css";
import "./check.ts";
import { h } from "../../app/dom.ts";
import { registerMenu, registerUrlHandler, registerWelcome } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { currentUser } from "../../platform/api.ts";
import { config, onConfig } from "../account/config.ts";
import { openFeedback } from "./report.ts";

registerMenu("Help", () => {
  if (!config()) return [];
  const rows: Row[] = [
    { label: "Report a Bug…", run: () => openFeedback("bug") },
    { label: "Request a Feature…", run: () => openFeedback("idea") },
  ];
  if (currentUser()?.admin === true) rows.push({ label: "Admin Panel…", run: () => void window.open("/admin", "_blank", "noopener") });
  return rows;
});

registerUrlHandler("admin", (value) => {
  location.replace(`/admin#${value === "errors" ? "errors" : "feedback"}`);
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

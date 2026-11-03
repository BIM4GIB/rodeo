// The news feature: the start hub's "What's new" link (news.ts), the full list it and Help >
// What's New… open (panel.ts), and, for admins, the Help > Announcements… editor (admin.ts) that
// posts and deletes announcements. It registers with app/ext.ts when imported. The release log
// (releases.ts) ships with the editor, so the link and the list show with no server too; a server
// adds its announcements to them.

import "./news.css";
import { registerMenu, registerWelcome } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { currentUser } from "../../platform/api.ts";
import { config } from "../account/config.ts";
import { openAnnouncementsEditor } from "./admin.ts";
import { newsLink } from "./news.ts";
import { openNewsPanel } from "./panel.ts";

registerWelcome(() => newsLink(openNewsPanel), "foot");

registerMenu("Help", () => [{ label: "What's New…", run: openNewsPanel }], { after: "Keyboard Shortcuts…" });

registerMenu("Help", () => {
  const rows: Row[] = [];
  if (config() && currentUser()?.admin === true) rows.push({ label: "Announcements…", run: openAnnouncementsEditor });
  return rows;
});

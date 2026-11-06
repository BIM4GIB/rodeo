// The news feature: the start hub's "What's new" link (news.ts), the full list it and Help >
// What's New… open (panel.ts), and the bar an announcement can show across the top of the editor
// for a while (banner.ts). Admins post announcements on the admin page. It registers with
// app/ext.ts when imported. The release log (releases.ts) ships with the editor, so the link and
// the list show with no server too; a server adds its announcements to them.

import "./news.css";
import "./banner.ts";
import { registerMenu, registerWelcome } from "../../app/ext.ts";
import { newsLink } from "./news.ts";
import { openNewsPanel } from "./panel.ts";

registerWelcome(() => newsLink(openNewsPanel), "foot");

registerMenu("Help", () => [{ label: "What's New…", run: openNewsPanel }], { after: "Keyboard Shortcuts…" });

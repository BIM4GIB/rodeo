// The admin page's System tab: how the server is doing (its version, how long it has been up, the
// memory it uses), the size of the database and the data disk, the rows in the main tables, what
// is set up on the server and whether it is on, who the admins are, and whether visitors' cities
// arrive from Cloudflare. Below them, the admin log: every step an admin took, newest first, 50 at
// a time. The health is fetched again while shown; the log is read when the tab opens.

import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminLogEntry, AdminSystem } from "../platform/protocol.ts";
import { type AdminContext, updatedNow } from "./context.ts";
import { ago, bytes, count, dateTime } from "./format.ts";
import { card, emptyView, loaded, section } from "./ui.ts";
import "./system.css";

/** the health is fetched again this often while the tab is in front */
const REFRESH_MS = 30_000;
/** a disk more used than this has its bar in the warning colour */
const DISK_WARN = 0.8;

/** what each admin step's action says, in words; any other action is shown as it is */
const ACTIONS: Record<string, string> = {
  "credit.grant": "gave credit",
  "credit.take": "took back credit",
  "plus.give": "gave Rodeo Plus",
  "plus.end": "ended Rodeo Plus",
  "user.signout": "signed out",
  "user.suspend": "suspended",
  "user.unsuspend": "let back",
  "user.delete": "deleted the account of",
  "settings.welcome": "set welcome credit",
  "announcement.post": "posted",
  "announcement.edit": "edited",
  "announcement.delete": "deleted the announcement",
  "funding.save": "saved funding",
  "sponsor.save": "set the sponsor",
  "sponsor.clear": "removed the sponsor",
  "gallery.hide": "hid",
  "gallery.restore": "restored",
  "gallery.dismiss": "dismissed reports on",
  "gallery.feature": "featured",
  "gallery.unfeature": "unfeatured",
  "feedback.status": "marked",
  "feedback.delete": "deleted feedback",
  "errors.clear": "cleared the error",
};

/** "3 d 4 h", "4 h 12 min", "12 min": how long the server has been up. */
function upFor(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} d ${hr} h`;
  if (hr > 0) return `${hr} h ${min} min`;
  return min > 0 ? `${min} min` : "under a minute";
}

/** A label and its value, in a card. */
function fact(label: string, value: string, title?: string): HTMLElement {
  const dd = h("dd", { cls: "adm-sys-fact-value", text: value });
  if (title) dd.title = title;
  return h("div", { cls: "adm-sys-fact" }, h("dt", { cls: "adm-sys-fact-label", text: label }), dd);
}

function facts(...items: HTMLElement[]): HTMLElement {
  return h("dl", { cls: "adm-sys-facts" }, ...items);
}

/** A dot, green when on and grey when off. */
function dot(on: boolean): HTMLElement {
  return h("span", { cls: on ? "adm-sys-dot on" : "adm-sys-dot", attrs: { "aria-hidden": "true" } });
}

function serverCard(s: AdminSystem): HTMLElement {
  return card(
    "Server",
    facts(
      fact("Version", s.version),
      fact("Node", s.node),
      fact("Up for", upFor(s.uptime)),
      fact("Memory used", bytes(s.memory.rss), `Heap ${bytes(s.memory.heapUsed)} of ${bytes(s.memory.heapTotal)}`),
      fact("Address", s.publicUrl),
    ),
  );
}

function storageCard(s: AdminSystem): HTMLElement {
  const { database, diskTotal, diskFree } = s.storage;
  const items = [fact("Database", bytes(database))];
  if (diskTotal === null || diskFree === null || diskTotal <= 0) {
    return card("Storage", facts(...items, fact("Disk", "Not known")));
  }
  const used = diskTotal - diskFree;
  const ratio = used / diskTotal;
  const fill = h("span", { cls: ratio > DISK_WARN ? "adm-sys-bar-fill warn" : "adm-sys-bar-fill" });
  fill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  const bar = h(
    "div",
    { cls: "adm-sys-bar", attrs: { role: "meter", "aria-label": "Disk used", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(ratio * 100)) } },
    fill,
  );
  return card(
    "Storage",
    facts(
      ...items,
      fact("Disk", bytes(diskTotal)),
      fact("Disk used", `${bytes(used)} (${Math.round(ratio * 100)}%)`),
      fact("Disk free", bytes(diskFree)),
    ),
    bar,
  );
}

function locationsCard(s: AdminSystem): HTMLElement {
  return card(
    "Visitor locations",
    h("p", { cls: "adm-sys-status" }, dot(s.locationHeaders), h("span", { text: s.locationHeaders ? "On" : "Off" })),
    h("p", {
      cls: "adm-card-note",
      text: s.locationHeaders
        ? "Cities and positions arrive from Cloudflare."
        : "None came in the last day. To turn them on, add visitor location headers in Cloudflare dashboard › rodeo.build › Rules › Settings › Managed Transforms › Add visitor location headers. Until then the globe puts visitors at their country's middle.",
    }),
  );
}

function featureRow(f: AdminSystem["features"][number]): HTMLElement {
  return h(
    "li",
    { cls: "adm-sys-feature" },
    dot(f.on),
    h("span", { cls: "adm-sys-feature-name", text: f.name }),
    f.note ? h("span", { cls: "adm-sys-feature-note", text: f.note }) : null,
    h("span", { cls: f.on ? "adm-sys-state on" : "adm-sys-state", text: f.on ? "On" : "Off" }),
  );
}

function setupCard(s: AdminSystem): HTMLElement {
  const c = card(
    "Set up",
    h("p", { cls: "adm-card-note", text: "What the server can do, and whether it is set up. Secret values are never shown." }),
    h("ul", { cls: "adm-sys-list adm-sys-features" }, ...s.features.map(featureRow)),
  );
  c.classList.add("adm-sys-wide");
  return c;
}

function adminsCard(s: AdminSystem): HTMLElement {
  return card(
    "Admins",
    h("p", { cls: "adm-card-note", text: "Set by ADMIN_EMAILS on the server." }),
    s.admins.length ? h("ul", { cls: "adm-sys-list" }, ...s.admins.map((email) => h("li", { text: email }))) : emptyView("No admins are set."),
  );
}

function tablesCard(s: AdminSystem): HTMLElement {
  return card(
    "Tables",
    h("p", { cls: "adm-card-note", text: "Rows in each of the main tables." }),
    facts(...s.tables.map((t) => fact(t.label, count(t.count)))),
  );
}

function health(s: AdminSystem): HTMLElement {
  return h("div", { cls: "adm-sys-cards" }, serverCard(s), storageCard(s), locationsCard(s), setupCard(s), adminsCard(s), tablesCard(s));
}

function logItem(e: AdminLogEntry): HTMLElement {
  return h(
    "li",
    { cls: "adm-sys-log-item" },
    h("time", { cls: "adm-sys-log-when", text: ago(e.at), title: dateTime(e.at), attrs: { datetime: e.at } }),
    h(
      "p",
      { cls: "adm-sys-log-what" },
      h("span", { cls: "adm-sys-log-admin", text: e.admin }),
      ` ${ACTIONS[e.action] ?? e.action}`,
      e.target ? h("strong", { cls: "adm-sys-log-target", text: ` ${e.target}` }) : null,
    ),
    e.detail ? h("p", { cls: "adm-sys-log-detail", text: e.detail }) : null,
  );
}

/** The admin log, read a page at a time: the first when the tab opens, the rest on "Show more". */
function logSection(signal: AbortSignal): HTMLElement {
  let next = 0;
  const list = h("ol", { cls: "adm-sys-log" });
  const status = h("p", { cls: "adm-empty", text: "Loading…" });
  const error = h("p", { cls: "adm-error", hidden: true, attrs: { role: "alert" } });
  const more = h("button", { cls: "adm-btn", text: "Show more", hidden: true, attrs: { type: "button" } });

  const fetchPage = (): void => {
    more.disabled = true;
    error.hidden = true;
    adminApi
      .log(next)
      .then(({ entries, total }) => {
        if (signal.aborted) return;
        list.append(...entries.map(logItem));
        next += entries.length;
        status.textContent = "No admin steps yet. Credit given, accounts suspended, announcements posted and the like show here.";
        status.hidden = total > 0;
        more.hidden = next >= total;
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        status.hidden = true;
        error.textContent = errorMessage(err);
        error.hidden = false;
      })
      .finally(() => (more.disabled = false));
  };
  more.addEventListener("click", fetchPage);
  fetchPage();

  return section("Admin log", "Steps admins took on the admin page and in the gallery, newest first.", status, error, list, more);
}

export function systemView(ctx: AdminContext): HTMLElement {
  return h(
    "div",
    { cls: "adm-sys" },
    loaded(ctx.signal, adminApi.system, health, { refresh: REFRESH_MS, onLoad: () => ctx.updated(updatedNow()) }),
    logSection(ctx.signal),
  );
}

// The admin page's Usage: what is in the cloud (drawings, versions, storage, branches and sharing,
// with the drawings made a day and the kinds of file), the gallery (published, remixes, hidden and
// reports to review), what people do together (comments and merge requests), and the agents (apps
// let in with OAuth, personal tokens, and the accounts that used them). Fetched each time the tab
// opens.

import { h } from "../app/dom.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminUsage } from "../platform/protocol.ts";
import { barList, columnChart, type Point } from "./charts.ts";
import { type AdminContext, updatedNow } from "./context.ts";
import { bytes, count } from "./format.ts";
import { loaded, section, tile, tiles } from "./ui.ts";
import "./revenue.css";

function drawingsSection(u: AdminUsage): HTMLElement {
  const f = u.files;
  const points: Point[] = u.daily.map((d) => ({ day: d.day, values: { files: d.files, versions: d.versions } }));
  return section(
    "Cloud drawings",
    null,
    tiles(
      tile({ label: "Drawings", value: count(f.total), note: `${count(f.fresh)} new in the period` }),
      tile({ label: "Versions", value: count(f.versions) }),
      tile({ label: "Storage", value: bytes(f.bytes), note: "with every version" }),
      tile({ label: "Branches", value: count(f.branches), note: "branches of other drawings" }),
      tile({ label: "Shared by link", value: count(f.shared) }),
      tile({ label: "Shared with people", value: count(f.withMembers) }),
    ),
    h(
      "div",
      { cls: "adm-charts" },
      columnChart(
        "Made a day",
        null,
        points,
        [
          { key: "files", label: "Drawings", color: "var(--series-1)" },
          { key: "versions", label: "Versions", color: "var(--series-2)" },
        ],
        (n) => count(Math.round(n)),
      ),
      barList("Kinds", f.kinds, (t) => (t.label === "none" ? "No extension" : `.${t.label}`)),
    ),
  );
}

function gallerySection(u: AdminUsage): HTMLElement {
  const g = u.gallery;
  const reports = tile({ label: "Open reports", value: count(g.openReports) });
  if (g.openReports > 0) reports.append(h("a", { cls: "adm-btn small adm-use-review", text: "Review", attrs: { href: "#gallery" } }));
  return section(
    "Gallery",
    null,
    tiles(
      tile({ label: "Published", value: count(g.published) }),
      tile({ label: "New in the period", value: count(g.fresh) }),
      tile({ label: "Remixes", value: count(g.forks) }),
      tile({ label: "Hidden", value: count(g.hidden) }),
      reports,
    ),
  );
}

function togetherSection(u: AdminUsage): HTMLElement {
  return section(
    "Working together",
    null,
    tiles(
      tile({ label: "Comments", value: count(u.comments), note: "in the period" }),
      tile({ label: "Merge requests", value: count(u.mergeRequests), note: "in the period" }),
    ),
  );
}

function agentsSection(u: AdminUsage): HTMLElement {
  const a = u.agents;
  return section(
    "Agents",
    "Apps and tokens as they stand now; accounts over the period.",
    tiles(
      tile({ label: "Apps let in (OAuth)", value: count(a.apps) }),
      tile({ label: "Agent tokens", value: count(a.tokens) }),
      tile({ label: "Accounts using the agents", value: count(a.users), note: "in the period" }),
    ),
  );
}

function body(u: AdminUsage): HTMLElement {
  return h("div", { cls: "adm-use-body" }, drawingsSection(u), gallerySection(u), togetherSection(u), agentsSection(u));
}

/** The Usage tab: what is made in the cloud and in the gallery, and who uses the agents; fetched when the tab opens. */
export function usageView(ctx: AdminContext): HTMLElement {
  return loaded(ctx.signal, () => adminApi.usage(ctx.days), body, { onLoad: () => ctx.updated(updatedNow()) });
}

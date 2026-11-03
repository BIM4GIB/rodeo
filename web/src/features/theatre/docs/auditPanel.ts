// Stage > Show Audit…: the show's preflight in one window: a summary, the findings filtered by severity, and a
// click on a finding that selects its objects and centres the view. Run Again reads the drawing afresh, and so
// does the window each time it is opened. Export CSV writes the findings listed.

import { setSelection, zoomToSelection } from "../../../app/commands.ts";
import { appContext } from "../../../app/ext.ts";
import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { fixtures } from "../instrument.ts";
import { readShow } from "../show.ts";
import { LINESETS_KEY, POSITIONS_KEY, SHOP_KEY, VENUE_KEY, type Lineset, type PositionInfo, type ShopPiece, type VenueInfo } from "../showTypes.ts";
import { hasStageFrame, lengthText, stageFrame } from "../stageTool.ts";
import { csvOf, dataTable, downloadText, noteLine, openPanel, type Column } from "../ui.ts";
import { auditShow, type AuditInput, type Finding, type ScenicPiece, type Severity } from "./audit.ts";
import { segmented } from "./controls.ts";

/** the show data the audit reads beyond the instruments; scenes.data holds the scenic pieces */
const SCENES_KEY = "scenes.data";
const KEY = "docs-audit";
const LABEL: Readonly<Record<Severity, string>> = { error: "Error", warning: "Warning", note: "Note" };
const RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, note: 2 };

type Filter = "all" | Severity;

let findings: Finding[] = [];
let filter: Filter = "all";
let mounted: { readonly refresh: () => void; readonly element: HTMLElement } | null = null;

/** a stored list, or none when it's absent or isn't a list */
function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** The drawing and the show data as the audit reads them now. */
function inputNow(): AuditInput {
  const scenes = readShow<{ pieces?: unknown }>(SCENES_KEY, {});
  return {
    fixtures: fixtures(),
    frame: stageFrame(),
    hasStageFrame: hasStageFrame(),
    linesets: listOf<Lineset>(readShow<unknown>(LINESETS_KEY, [])),
    positions: listOf<PositionInfo>(readShow<unknown>(POSITIONS_KEY, [])),
    venue: readShow<VenueInfo | null>(VENUE_KEY, null),
    shop: listOf<ShopPiece>(readShow<unknown>(SHOP_KEY, [])),
    pieces: listOf<ScenicPiece>(scenes.pieces),
    format: lengthText,
  };
}

/** The findings, errors first, as the window lists them. */
function visible(): Finding[] {
  const shown = filter === "all" ? findings : findings.filter((f) => f.severity === filter);
  return [...shown].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** "2 errors, 1 warning, 3 notes", or that nothing was found. */
function summaryText(): string {
  const count = (s: Severity): number => findings.filter((f) => f.severity === s).length;
  const part = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (findings.length === 0) return "No problems found.";
  return [part(count("error"), "error"), part(count("warning"), "warning"), part(count("note"), "note")].join(", ");
}

/** Centres the view on a finding: its objects selected, or its place on the drawing. */
function show(f: Finding): void {
  const ctx = appContext();
  if (!ctx) return;
  if (f.ids.length) {
    setSelection(f.ids);
    zoomToSelection(ctx.scene, ctx.view);
  } else if (f.at) {
    ctx.view.setCenterAndScale(f.at.x, f.at.y, ctx.view.scale);
  } else {
    toast("That finding is about the venue or the scenery shop, so it has no place on the drawing.", "info");
  }
}

const COLUMNS: readonly Column<Finding>[] = [
  {
    label: "Severity",
    value: (f) => LABEL[f.severity],
    width: 92,
    cellClass: (f) => (f.severity === "error" ? "th-bad" : f.severity === "warning" ? "th-warn" : undefined),
  },
  { label: "Area", value: (f) => f.area, width: 90 },
  { label: "Finding", value: (f) => f.text },
];

/** Opens the audit, or brings it forward with the drawing read again. */
export function openAudit(): void {
  if (!store.session) return;
  if (mounted?.element.isConnected) {
    mounted.refresh();
    document.body.append(mounted.element);
    return;
  }
  findings = auditShow(inputNow());
  const summary = h("div", { cls: "th-toolbar" });
  const table = dataTable(COLUMNS, visible, {
    empty: "No findings here.",
    onRow: (f) => show(f),
  });
  table.element.classList.add("docs-audit-table");
  const paintSummary = (): void => {
    const errors = findings.some((f) => f.severity === "error");
    const warnings = findings.some((f) => f.severity === "warning");
    summary.replaceChildren(
      noteLine(summaryText(), errors ? "th-bad" : warnings ? "th-warn" : undefined),
      h("span", { cls: "th-spacer" }),
      segmented<Filter>(
        [
          { value: "all", label: "All" },
          { value: "error", label: "Errors" },
          { value: "warning", label: "Warnings" },
          { value: "note", label: "Notes" },
        ],
        filter,
        (v) => {
          filter = v;
          table.refresh();
        },
      ),
    );
  };
  const refresh = (): void => {
    findings = auditShow(inputNow());
    paintSummary();
    table.refresh();
  };
  paintSummary();
  const body = h("div", { cls: "docs-audit-body" }, summary, table.element);
  const panel = openPanel({
    key: KEY,
    title: "Show Audit",
    body,
    width: 900,
    height: 560,
    actions: [
      {
        label: "Export CSV",
        run: () => downloadText("Show Audit.csv", csvOf(COLUMNS, visible()), "text/csv"),
      },
      { label: "Run Again", primary: true, run: refresh },
    ],
    onClose: () => {
      mounted = null;
    },
  });
  mounted = { refresh, element: panel.element };
}

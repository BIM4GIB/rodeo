// Find Usages dialogs: the results (click a use to select and zoom to it, or Select
// All), and the chooser that picks the target when the selection uses several.

import type { AppContext } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { namesOf, topLevelId } from "./describe.ts";
import { revealObject, selectAndZoom } from "./select.ts";
import { findUsages, objectsWithin, targetLabel, usageTargetsOf, type Usage, type UsageTarget } from "./usages.ts";

/** The most uses the dialog lists; Select All still takes them all. */
const LISTED = 500;

/** Shows where `target` is used, in a dialog that lets the person pick one to select. */
export async function showUsages(ctx: AppContext, target: UsageTarget): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const uses = findUsages(doc, target);
  const names = namesOf(doc);
  // what a click does is run after the dialog closes, as the dialog closes on it
  const after: { run?: () => void } = {};
  const act = (run: () => void) => (e: Event) => {
    after.run = run;
    (e.currentTarget as HTMLElement).closest("form")?.requestSubmit();
  };

  const summary =
    uses.length === 0
      ? `${targetLabel(target)} is not used in this drawing.`
      : `${uses.length} ${uses.length === 1 ? "use" : "uses"} of ${targetLabel(target)}.`;
  const body: Node[] = [h("p", { cls: "menu-dialog-text sx-usages-summary", text: summary })];
  if (uses.length > 0) {
    const selectAll = h("button", { cls: "btn small", text: `Select All (${uses.length})`, attrs: { type: "button" } });
    selectAll.addEventListener("click", act(() => selectUses(ctx, uses)));
    body.push(h("div", { cls: "sx-usages-actions" }, selectAll));
    const rows = uses.slice(0, LISTED).map((u) => {
      const row = h(
        "button",
        { cls: "sx-usage", attrs: { type: "button", title: "Select this and zoom to it" } },
        h(
          "span",
          { cls: "sx-usage-main" },
          h("span", { cls: "sx-usage-label", text: u.label }),
          h("span", { cls: "sx-usage-how", text: u.how }),
        ),
        h("span", { cls: "sx-usage-layer", text: names.layers.get(u.layerId) ?? "" }),
      );
      row.addEventListener("click", act(() => revealObject(ctx, u.id)));
      return row;
    });
    body.push(h("div", { cls: "sx-usage-list", attrs: { role: "list" } }, ...rows));
    if (uses.length > LISTED) {
      body.push(h("p", { cls: "muted", text: `${uses.length - LISTED} more are not listed. Select All takes them all.` }));
    }
  }

  await showDialog<true>({
    title: "Find Usages",
    okLabel: "Close",
    cls: "sx-usages-dialog",
    body,
    check: () => ({ value: true }),
  });
  after.run?.();
}

/** Selects the uses on one layer (the active layer when it has any, else the first use's), zooms to them and says what was left out. */
function selectUses(ctx: AppContext, uses: readonly Usage[]): void {
  const doc = store.session?.doc;
  if (!doc || uses.length === 0) return;
  const active = store.activeLayerId;
  const layer = uses.some((u) => u.layerId === active) ? active : uses[0].layerId;
  if (layer === null) return;
  const here = uses.filter((u) => u.layerId === layer);
  const ids = [...new Set(here.map((u) => topLevelId(doc, u.id)))];
  selectAndZoom(ctx, layer, ids);
  const others = uses.length - here.length;
  if (others > 0) {
    const name = doc.layers().find((l) => l.id === layer)?.name ?? "";
    toast(`Selected ${here.length} on ${name}. ${others} more are on other layers.`, "info");
  }
}

/** Find Usages for the selection: what it uses (its symbols, classes, line types, fills and record formats); a chooser when it uses several. */
export async function findUsagesOfSelection(ctx: AppContext): Promise<void> {
  const doc = store.session?.doc;
  if (!doc || store.selection.size === 0) return;
  const targets = usageTargetsOf(doc, objectsWithin(doc, store.selection));
  if (targets.length === 0) {
    toast("Nothing selected has a symbol, class, line type, fill or record format to look up.", "info");
    return;
  }
  if (targets.length === 1) {
    await showUsages(ctx, targets[0]);
    return;
  }
  const choice = await chooseTarget(targets);
  if (choice !== null) await showUsages(ctx, targets[choice]);
}

/** A small dialog listing the targets; resolves with the index chosen, or null. */
async function chooseTarget(targets: readonly UsageTarget[]): Promise<number | null> {
  const select = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Look up" } },
    ...targets.map((t, i) => h("option", { value: String(i), text: targetLabel(t) })),
  );
  return showDialog<number>({
    title: "Find Usages",
    okLabel: "Find",
    body: [h("p", { cls: "menu-dialog-text", text: "The selection uses more than one of these. Which to look up?" }), select],
    check: () => ({ value: Number(select.value) }),
  });
}

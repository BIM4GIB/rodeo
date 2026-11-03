// AEC > Terrain > Validate 3D Data, Vectorworks' command of that name: the selected 3D polygons,
// and those in selected groups, checked as a site model's source data (EditSession.validate3DData).
// With nothing wrong a box says so; otherwise Problems with Site Model Source Data lists what was
// found, each with a button that corrects it (copies deleted, points repeated in a row taken out
// as Simplify Polys takes them, polygons of fewer than two points deleted, each its own undo step)
// or selects the polygons to look at (points one above another, points in several places), and
// the list is checked again after each. 3D loci and stakes aren't looked at.

import { SOURCE_TOLERANCE } from "../core/sourceData.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";

export function canValidate3DData(): boolean {
  return !!store.session && store.selection.size > 0;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** AEC > Terrain > Validate 3D Data: what's wrong with the selected 3D source data, with ways to correct it. */
export async function validate3DDataDialog(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const chosen = [...store.selection];
  // the selection as it stands after a correction deleted some of it
  const check = () => s.validate3DData(chosen.filter((id) => s.doc.object(id)));
  let report = check();
  if (!report.polygons) {
    await showDialog<true>({
      title: "Validate 3D Data",
      okLabel: "OK",
      body: [h("p", { cls: "menu-dialog-text", text: "None of the selected objects is 3D source data: select 3D polygons, or groups of them." })],
      check: () => ({ value: true }),
    });
    return;
  }
  const holder = h("div");
  const row = (text: string, label: string, run: (button: HTMLButtonElement) => void): HTMLElement => {
    const button = h("button", { cls: "btn", text: label, attrs: { type: "button" } });
    button.addEventListener("click", () => run(button));
    return h("div", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text }), button);
  };
  // a correction, then the data checked again
  const correct = (label: string, fn: Parameters<typeof attempt>[1]): void => {
    if (!attempt(label, fn)) return;
    report = check();
    render();
  };
  const select = (ids: readonly string[]) => (button: HTMLButtonElement) => {
    setSelection(ids);
    button.textContent = "Selected";
  };
  const render = (): void => {
    const { duplicates, degenerate, repeated, vertical, coincident } = report;
    const rows: HTMLElement[] = [];
    const copies = duplicates.flatMap((ids) => ids.slice(1));
    if (copies.length) rows.push(row(`${plural(copies.length, "copy", "copies")} of another 3D polygon`, "Delete", () => correct("Delete Duplicate 3D Polygons", (s) => s.deleteObjects(copies))));
    if (degenerate.length) rows.push(row(`${plural(degenerate.length, "3D polygon")} of fewer than 2 points`, "Delete", () => correct("Delete 3D Polygons", (s) => s.deleteObjects(degenerate))));
    if (repeated.length) {
      const n = repeated.reduce((sum, r) => sum + r.count, 0);
      rows.push(row(`${plural(n, "point")} repeated in a row, in ${plural(repeated.length, "polygon")}`, "Remove", () => correct("Remove Repeated Points", (s) => s.simplifyPolys(repeated.map((r) => r.id), "distance", SOURCE_TOLERANCE))));
    }
    const polygonsOf = (places: readonly { ids: string[] }[]): string[] => [...new Set(places.flatMap((p) => p.ids))];
    if (vertical.length) rows.push(row(`${plural(vertical.length, "place")} with points one above another, in ${plural(polygonsOf(vertical).length, "polygon")}`, "Select", select(polygonsOf(vertical))));
    if (coincident.length) rows.push(row(`${plural(coincident.length, "point")} in more than one place in the data, in ${plural(polygonsOf(coincident).length, "polygon")}`, "Select", select(polygonsOf(coincident))));
    holder.replaceChildren(
      h("p", { cls: "muted", text: `Checked ${plural(report.polygons, "3D polygon")} (${plural(report.points, "point")}).` }),
      ...(rows.length ? rows : [h("p", { cls: "menu-dialog-text", text: "No problems were found." })]),
    );
  };
  render();
  const { duplicates, degenerate, repeated, vertical, coincident } = report;
  const problems = duplicates.length + degenerate.length + repeated.length + vertical.length + coincident.length > 0;
  await showDialog<true>({
    title: problems ? "Problems with Site Model Source Data" : "Validate 3D Data",
    okLabel: "Close",
    cls: "props-dialog",
    body: [holder],
    check: () => ({ value: true }),
  });
}

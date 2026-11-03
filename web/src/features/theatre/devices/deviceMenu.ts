// A lighting device's and a hanging position's right-click commands, as Spotlight has them, and Refresh
// Lighting Devices (also on the drawing's right-click menu and Stage > Lighting, ⌘/). On a device: Select
// Lighting Devices by Instrument Type and by Position, Select Rigging Object, Remove from Hanging Position,
// and Swap Lighting Devices (swap.ts) with two devices selected; on a hanging position, Select Lighting
// Devices on Rigging Object. What they select is added to the selection, from where Select Similar looks
// (the active layer, or the group being edited).

import { attempt, setActiveLayer, setSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import type { Row } from "../../../app/menu.ts";
import { showDialog } from "../../../app/menubar.ts";
import { similarScope } from "../../../app/selectSimilar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { Fixture } from "../fixture.ts";
import { redrawPositions } from "../hanging/hangingPosition.ts";
import { hangingPositions, type HangingPosition } from "../hanging/positions.ts";
import { fixture, fixtures, redrawInstruments, writeFixtures } from "../instrument.ts";
import { swapDevices, swapOptionsOf, type SwapOptions } from "./swap.ts";

const STORE_KEY = "openvwx.swapDevices";
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

// whether Shift was down when the command was chosen: the menu runs it without its event
let shift = false;
window.addEventListener("pointerdown", (e) => (shift = e.shiftKey), true);
window.addEventListener("keydown", (e) => (shift = e.shiftKey), true);

/** Adds the devices `ids` to the selection, those where Select Similar looks, and says how many. */
function addToSelection(ids: readonly string[], what: string): void {
  const doc = store.session?.doc;
  if (!doc) return;
  const scope = new Set(similarScope(doc).map((o) => o.id));
  const add = ids.filter((id) => scope.has(id));
  setSelection([...store.selection, ...add]);
  toast(add.length ? `Selected ${plural(add.length, "lighting device")} ${what}.` : `No lighting devices ${what} on the active layer.`, "info");
}

/** Selects the hanging position a device hangs on, making its layer active when it's on another. */
function selectRigging(positions: readonly HangingPosition[]): void {
  const doc = store.session?.doc;
  if (!doc) return;
  const scope = new Set(similarScope(doc).map((o) => o.id));
  const p = positions.find((x) => scope.has(x.id)) ?? positions[0];
  if (!scope.has(p.id)) setActiveLayer(p.layerId);
  setSelection([p.id]);
}

/** The selected lighting devices. */
function selectedDevices(): Fixture[] {
  return [...store.selection].flatMap((id) => fixture(id) ?? []);
}

/** Takes the devices out of their hanging positions: the selected ones when `id` is among them, else `id`. */
function removeFromPosition(id: string): void {
  const chosen = store.selection.has(id) ? selectedDevices() : [fixture(id)].filter((f) => f !== undefined);
  const on = chosen.filter((f) => f.position.trim());
  const names = new Set(on.map((f) => f.position.trim()));
  const positions = hangingPositions().filter((p) => names.has(p.name));
  const done = attempt("Remove from Hanging Position", (s) =>
    s.batch(() => {
      writeFixtures(s, on.map((f) => ({ id: f.id, edit: { position: "" } })));
      redrawPositions(s, positions.map((p) => p.id));
    }),
  );
  if (done) toast(`Took ${plural(on.length, "lighting device")} off ${names.size === 1 ? `"${[...names][0]}"` : `${names.size} hanging positions`}.`, "info");
}

function keptOptions(): ReturnType<typeof swapOptionsOf> {
  try {
    return swapOptionsOf(JSON.parse(localStorage.getItem(STORE_KEY) ?? "null"));
  } catch {
    return swapOptionsOf(null);
  }
}

/** The Swap Lighting Devices dialog: which fields move with the devices, and what Shift does next time. */
async function swapDialog(o: ReturnType<typeof swapOptionsOf>): Promise<(SwapOptions & { shiftSkips: boolean }) | null> {
  const box = (on: boolean, label: string): HTMLInputElement => h("input", { checked: on, attrs: { type: "checkbox", "aria-label": label } }) as HTMLInputElement;
  const radio = (on: boolean, label: string): HTMLInputElement => h("input", { checked: on, attrs: { type: "radio", name: "swap-shift", "aria-label": label } }) as HTMLInputElement;
  const circuit = box(o.circuit, "Circuit Name/Number");
  const dimmer = box(o.dimmer, "Dimmer");
  const patch = box(o.patch, "Universe/Address");
  const skip = radio(o.shiftSkips, "Move data immediately using previous settings");
  const show = radio(!o.shiftSkips, "Display this dialog box");
  return showDialog<SwapOptions & { shiftSkips: boolean }>({
    title: "Swap Lighting Devices",
    okLabel: "Swap",
    body: [
      h("p", { cls: "menu-dialog-label", text: "Move data from the following fields" }),
      h("label", { cls: "menu-dialog-check" }, circuit, "Circuit Name/Number"),
      h("label", { cls: "menu-dialog-check" }, dimmer, "Dimmer"),
      h("label", { cls: "menu-dialog-check" }, patch, "Universe/Address"),
      h("p", { cls: "muted", text: "A ticked field moves with its device; one not ticked stays where the device hung, for the device swapped into its place. The Unit Number and Position always stay; everything else moves." }),
      h("p", { cls: "menu-dialog-label", text: "Shift+click" }),
      h("label", { cls: "menu-dialog-check" }, skip, "Move data immediately using previous settings"),
      h("label", { cls: "menu-dialog-check" }, show, "Display this dialog box"),
    ],
    check: () => ({ value: { circuit: circuit.checked, dimmer: dimmer.checked, patch: patch.checked, shiftSkips: skip.checked } }),
  });
}

/** Swap Lighting Devices: the two selected devices trade places. */
async function swap(): Promise<void> {
  const pair = selectedDevices();
  if (pair.length !== 2 || store.selection.size !== 2) {
    toast("Select two lighting devices, and nothing else, to swap them.", "info");
    return;
  }
  const kept = keptOptions();
  const o = shift && kept.shiftSkips ? kept : await swapDialog(kept);
  if (!o) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(o));
  } catch {
    // the choices only last this time
  }
  const [a, b] = pair;
  const moves = swapDevices(a, b, o);
  const names = new Set([a.position.trim(), b.position.trim()]);
  const positions = a.position.trim() === b.position.trim() ? [] : hangingPositions().filter((p) => names.has(p.name));
  attempt("Swap Lighting Devices", (s) =>
    s.batch(() => {
      for (const m of moves) s.moveObjects([m.id], m.dx, m.dy);
      writeFixtures(s, moves);
      redrawPositions(s, positions.map((p) => p.id));
    }),
  );
}

/** Refresh Lighting Devices: every Rodeo lighting device and hanging position drawn again from its data. */
export function refreshLightingDevices(): void {
  const devices = fixtures().filter((f) => f.native).map((f) => f.id);
  const positions = hangingPositions().map((p) => p.id);
  if (!devices.length && !positions.length) {
    toast("This drawing has no Rodeo lighting devices or hanging positions to refresh.", "info");
    return;
  }
  const done = attempt("Refresh Lighting Devices", (s) =>
    s.batch(() => {
      redrawInstruments(s, devices);
      redrawPositions(s, positions);
    }),
  );
  if (done) toast(`Refreshed ${plural(devices.length, "lighting device")} and ${plural(positions.length, "hanging position")}.`, "info");
}

/** The rows for the object under the pointer (null over empty space). */
export function deviceRows(under: string | null): readonly Row[] {
  if (!store.session) return [];
  const refresh: Row = { label: "Refresh Lighting Devices", keys: "⌘/", run: refreshLightingDevices };
  const d = under === null ? undefined : fixture(under);
  if (d) {
    const pos = d.position.trim();
    const rigging = pos ? hangingPositions().filter((p) => p.name === pos) : [];
    return [
      { label: "Select Lighting Devices by Instrument Type", run: () => addToSelection(fixtures().filter((f) => f.type === d.type).map((f) => f.id), `of type ${d.label || d.type}`) },
      ...(pos ? [{ label: "Select Lighting Devices by Position", run: () => addToSelection(fixtures().filter((f) => f.position.trim() === pos).map((f) => f.id), `on "${pos}"`) }] : []),
      ...(rigging.length ? [{ label: "Select Rigging Object", run: () => selectRigging(rigging) }] : []),
      ...(pos ? [{ label: "Remove from Hanging Position", run: () => removeFromPosition(d.id) }] : []),
      { label: "Swap Lighting Devices…", enabled: () => store.selection.size === 2 && selectedDevices().length === 2, run: () => void swap() },
      refresh,
    ];
  }
  const p = under === null ? undefined : hangingPositions().find((x) => x.id === under);
  if (p) {
    const on = (): Fixture[] => fixtures().filter((f) => f.position.trim() === p.name);
    return [{ label: "Select Lighting Devices on Rigging Object", enabled: () => !!p.name, run: () => addToSelection(on().map((f) => f.id), `on "${p.name}"`) }, refresh];
  }
  return under === null && (fixtures().length > 0 || hangingPositions().length > 0) ? [refresh] : [];
}

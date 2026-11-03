// ConnectCAD's Adapter Slot tool (ConnectCAD Layout): adapter slots in an equipment item, for equipment
// made of a main unit and plug-in modules. Vectorworks places them on the 3D item's front or rear in
// object editing mode; in Rodeo a click on an item in plan (or its Adapter Slots… button in the Object
// Info palette) opens that item's front or rear face on, where a click places a slot, and in Linear
// Array or Rectangular Array two clicks a row or a block of them. Each is named for a socket of the
// device of the item's name, numbered on along an array, or for a name typed when there's no such
// device; a slot is picked to change its name, Adapter Type or size, or to delete it. OK keeps them in
// one undo step. The sums are in adapterSlotShapes.ts; equipmentItem.ts keeps and draws them.

import type { Pt } from "../../../core/index.ts";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "../../../app/units.ts";
import { slotNames, slotPlaces, slotProblem, slotRect, SLOT_MODES, type AdapterSlot, type SlotMode } from "./adapterSlotShapes.ts";
import { nextName } from "./ccadShapes.ts";
import { adapterSlotEditor, setAdapterSlots, slotFace, slotShown } from "./equipmentItem.ts";
import { MOUNTINGS, type Mounting } from "./rackShapes.ts";

/** what the tool places slots with: its mode, side and size, and the name the next slot takes when the item has no device */
export const adapterSlotSettings = { mode: "single" as SlotMode, side: "Front" as Mounting, width: 80, height: 30, socket: "SLOT1" };

const SVG = "http://www.w3.org/2000/svg";
/** the face's preview, px: about as wide as the dialog, as tall as the face's shape asks within these */
const PREVIEW_WIDTH = 560;
const PREVIEW_LOW = 120;
const PREVIEW_HIGH = 280;

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** The Adapter Slot editor on equipment item `id`: its slots changed in a dialog, kept on OK. */
export async function editAdapterSlots(id: string): Promise<void> {
  const s = store.session;
  if (!s) return;
  const k = adapterSlotSettings;
  let face = slotFace(s, id, k.side);
  if (!face) {
    toast("Adapter Slot: adapter slots go in equipment items, not rack frames.", "info");
    return;
  }
  const units = s.doc.info.units;
  const suffix = lengthSuffix(units);
  let slots: AdapterSlot[] = [...face.slots];
  let picked: number | null = null;
  let from: Pt | null = null;
  let pointer: Pt | null = null;

  // the controls
  const choice = (label: string, value: string, options: readonly { id: string; label: string }[]): HTMLSelectElement =>
    h(
      "select",
      { cls: "menu-dialog-input", attrs: { "aria-label": label } },
      ...options.map((o) => {
        const el = h("option", { text: o.label, attrs: { value: o.id } });
        el.selected = o.id === value;
        return el;
      }),
    );
  const text = (label: string, value: string, numeric = false): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label, ...(numeric ? { inputmode: "decimal" } : {}) } });
  const field = (label: string, el: HTMLElement, unit = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  const side = choice("Location", k.side, MOUNTINGS.map((m) => ({ id: m, label: m })));
  const mode = choice("Mode", k.mode, SLOT_MODES);
  const width = text("Width", "", true);
  const height = text("Height", "", true);
  // a socket of the item's device to pick, or a name to type when it has none
  const socketPick = h("select", { cls: "menu-dialog-input ccad-slot-socket", attrs: { "aria-label": "Socket" } });
  const socketText = text("Socket", k.socket);
  const socketField = field("Socket", socketPick);
  const socketTextField = field("Socket", socketText);
  const note = h("p", { cls: "muted ccad-slot-note" });

  // the slot picked
  const pickName = text("Slot Name", "");
  const pickType = text("Adapter Type", "");
  const pickWidth = text("Slot Width", "", true);
  const pickHeight = text("Slot Height", "", true);
  const pickStatus = h("p", { cls: "muted ccad-slot-status" });
  const remove = h("button", { cls: "btn", text: "Delete Slot", attrs: { type: "button" } });
  const pickBox = h(
    "fieldset",
    { cls: "ccad-slot-picked" },
    h("legend", { text: "Slot" }),
    field("Slot Name", pickName),
    field("Adapter Type", pickType),
    field("Width", pickWidth, suffix),
    field("Height", pickHeight, suffix),
    pickStatus,
    remove,
  );

  const plan = svgEl("svg", { width: "100%", height: PREVIEW_LOW, role: "group", tabindex: 0, class: "ccad-slot-face" });

  // a length shown keeps its own value until it's typed over, so 80 mm shown in inches stays 80 mm
  const lengths = new WeakMap<HTMLInputElement, { text: string; mm: number }>();
  const showLength = (el: HTMLInputElement, mm: number): void => {
    el.value = formatLengthValue(mm, units);
    lengths.set(el, { text: el.value, mm });
  };
  const size = (el: HTMLInputElement): number | null => {
    const kept = lengths.get(el);
    const v = kept && kept.text === el.value ? kept.mm : parseLength(el.value, units);
    return v !== null && v > 0 ? v : null;
  };
  const taken = (): Set<string> => new Set(slots.map((q) => q.name));
  const onSide = (): number[] => slots.flatMap((q, n) => (q.side === side.value ? [n] : []));

  /** The socket the next slot takes: the one picked, or the name typed. */
  const socketNow = (): string => (face!.sockets.length ? socketPick.value : socketText.value.trim());
  /** After slots are placed, the next socket or name along from the last. */
  const advance = (last: string): void => {
    if (face!.sockets.length) {
      const used = taken();
      const next = face!.sockets.slice(face!.sockets.indexOf(last) + 1).find((n) => !used.has(n)) ?? face!.sockets.find((n) => !used.has(n));
      if (next) socketPick.value = next;
    } else socketText.value = nextName(last || "SLOT1", taken());
  };

  function fillSockets(): void {
    socketPick.replaceChildren(...face!.sockets.map((n) => h("option", { text: n, attrs: { value: n } })));
    const used = taken();
    socketPick.value = face!.sockets.find((n) => !used.has(n)) ?? face!.sockets[0] ?? "";
    socketField.hidden = !face!.sockets.length;
    socketTextField.hidden = face!.sockets.length > 0;
  }

  /** The slots a click at `to` would place now, each with why it can't go if it can't. */
  function wouldPlace(to: Pt): { slot: AdapterSlot; problem: string | null }[] {
    const w = size(width);
    const ht = size(height);
    if (w === null || ht === null) return [];
    const m = mode.value as SlotMode;
    const centres = m === "single" ? [to] : from ? slotPlaces(m, from, to, w, ht) : [to];
    const names = slotNames(socketNow(), centres.length, taken());
    const placed: AdapterSlot[] = [];
    return centres.map((c, n) => {
      const slot: AdapterSlot = { name: names[n], type: "", side: side.value as Mounting, x: c.x, z: c.y, width: w, height: ht };
      const problem = slotProblem(slot, face!.room, [...slots, ...placed]);
      if (!problem) placed.push(slot);
      return { slot, problem };
    });
  }

  function draw(): void {
    const f = face!;
    const xs = f.pieces.flatMap((p) => [p.x0, p.x1]);
    const zs = f.pieces.flatMap((p) => [p.z0, p.z1]);
    const [x0, x1, z0, z1] = [Math.min(0, ...xs), Math.max(0, ...xs), Math.min(0, ...zs), Math.max(1, ...zs)];
    const margin = Math.max(x1 - x0, z1 - z0) * 0.04;
    const [vw, vh] = [x1 - x0 + 2 * margin, z1 - z0 + 2 * margin];
    plan.setAttribute("viewBox", `${x0 - margin} ${-z1 - margin} ${vw} ${vh}`);
    const tall = Math.min(PREVIEW_HIGH, Math.max(PREVIEW_LOW, (PREVIEW_WIDTH * vh) / vw));
    plan.setAttribute("height", String(Math.round(tall)));
    plan.setAttribute("aria-label", `${f.name || "The equipment"} from the ${side.value === "Rear" ? "rear" : "front"}: click to place adapter slots, or click a slot to change it`);
    const px = Math.max(vw / PREVIEW_WIDTH, vh / tall);
    const rect = (r: { x0: number; x1: number; z0: number; z1: number }, cls: string): SVGRectElement => svgEl("rect", { x: r.x0, y: -r.z1, width: r.x1 - r.x0, height: r.z1 - r.z0, class: cls, "stroke-width": px });
    plan.replaceChildren(...f.pieces.map((p) => rect(p, p.kind === "ear" ? "ccad-slot-ear" : "ccad-slot-body")));
    for (const n of onSide()) {
      const q = slots[n];
      const r = slotRect(q);
      const shown = slotShown(s!, id, q);
      const g = svgEl("g", { class: n === picked ? "ccad-slot ccad-slot-on" : "ccad-slot", "data-slot": n });
      const title = svgEl("title", {});
      title.textContent = `${q.name || "Slot"}${shown.text ? `: ${shown.text}` : ""}`;
      g.append(title, rect(r, "ccad-slot-rect"));
      if (shown.cross) {
        g.append(svgEl("line", { x1: r.x0, y1: -r.z0, x2: r.x1, y2: -r.z1, class: "ccad-slot-cross", "stroke-width": px }));
        g.append(svgEl("line", { x1: r.x0, y1: -r.z1, x2: r.x1, y2: -r.z0, class: "ccad-slot-cross", "stroke-width": px }));
      }
      const label = q.name + (shown.text ? ` · ${shown.text}` : "");
      const most = Math.min(r.z1 - r.z0, 14 * px) * 0.6;
      const fits = Math.min(most, ((r.x1 - r.x0) * 0.9) / Math.max(1, label.length * 0.6));
      if (fits > 4 * px) {
        const t = svgEl("text", { x: (r.x0 + r.x1) / 2, y: -(r.z0 + r.z1) / 2, "font-size": fits, "text-anchor": "middle", "dominant-baseline": "central", class: "ccad-slot-text" });
        t.textContent = label;
        g.append(t);
      }
      plan.append(g);
    }
    // where a click would place them
    if (pointer) for (const { slot, problem } of wouldPlace(pointer)) plan.append(rect(slotRect(slot), problem ? "ccad-slot-ghost ccad-slot-bad" : "ccad-slot-ghost"));
  }

  function hint(): void {
    const m = mode.value as SlotMode;
    if (size(width) === null || size(height) === null) note.textContent = "Enter a width and a height for the slots.";
    else if (m === "single") note.textContent = "Click to place a slot, or click a slot to change it.";
    else if (!from) note.textContent = `Click where the ${m === "linear" ? "row" : "block"} of slots starts.`;
    else {
      const n = pointer ? wouldPlace(pointer).length : 1;
      note.textContent = `Click where it ends · Count: ${n} · Esc or a right-click starts again`;
    }
  }

  function showPicked(): void {
    const q = picked === null ? null : slots[picked];
    pickBox.hidden = !q;
    if (!q) return;
    pickName.value = q.name;
    pickType.value = q.type;
    showLength(pickWidth, q.width);
    showLength(pickHeight, q.height);
    const shown = slotShown(s!, id, q);
    const device = face!.name;
    pickStatus.textContent = !face!.linked
      ? `${device || "This equipment"} isn't linked to a device, so the slot shows its Adapter Type.`
      : !shown.linked
        ? `No socket of ${device} is named ${q.name || "that"}: the slot shows its Adapter Type.`
        : shown.cross || !shown.text || shown.text === q.type.trim()
          ? `Stands for socket ${q.name} of ${device}, which has no adapter.`
          : `Stands for socket ${q.name} of ${device}, which has adapter ${shown.text}.`;
  }

  const redraw = (): void => {
    draw();
    hint();
    showPicked();
  };

  /** The face point under a pointer event. */
  const at = (e: MouseEvent): Pt | null => {
    const m = plan.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: -p.y };
  };

  plan.addEventListener("pointermove", (e) => {
    pointer = at(e);
    draw();
    hint();
  });
  plan.addEventListener("pointerleave", () => {
    pointer = null;
    draw();
  });
  plan.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    from = null;
    redraw();
  });
  plan.addEventListener("click", (e) => {
    const p = at(e);
    if (!p) return;
    plan.focus();
    const hit = (e.target as Element).closest("[data-slot]");
    if (hit && !from) {
      picked = Number(hit.getAttribute("data-slot"));
      redraw();
      return;
    }
    const m = mode.value as SlotMode;
    if (m !== "single" && !from) {
      from = p;
      picked = null;
      redraw();
      return;
    }
    const tried = wouldPlace(p);
    from = null;
    const fit = tried.filter((t) => !t.problem).map((t) => t.slot);
    slots = [...slots, ...fit];
    picked = fit.length === 1 ? slots.length - 1 : null;
    if (fit.length) advance(fit[fit.length - 1].name);
    redraw();
    const left = tried.length - fit.length;
    if (left) note.textContent = `${fit.length ? `Placed ${fit.length}; ` : ""}${left === 1 ? "a slot" : `${left} slots`} ${tried.find((t) => t.problem)!.problem}${left === 1 ? "" : " or overlap others"}, so ${left === 1 ? "it wasn't" : "they weren't"} placed.`;
  });
  plan.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && from) {
      e.preventDefault();
      e.stopPropagation();
      from = null;
      redraw();
    } else if ((e.key === "Delete" || e.key === "Backspace") && picked !== null) {
      e.preventDefault();
      slots = slots.filter((_, n) => n !== picked);
      picked = null;
      redraw();
    }
  });

  remove.addEventListener("click", () => {
    if (picked === null) return;
    slots = slots.filter((_, n) => n !== picked);
    picked = null;
    redraw();
  });
  // a change to the slot picked, refused when it won't fit
  const change = (): void => {
    if (picked === null) return;
    const q = slots[picked];
    const w = size(pickWidth);
    const ht = size(pickHeight);
    if (w === null || ht === null) {
      note.textContent = "A slot's width and height are lengths more than 0.";
      showPicked();
      return;
    }
    const next: AdapterSlot = { ...q, name: pickName.value.trim(), type: pickType.value, width: w, height: ht };
    const problem = slotProblem(next, face!.room, slots.filter((_, n) => n !== picked));
    if (problem) {
      note.textContent = `That slot ${problem}, so it wasn't changed.`;
      showPicked();
      return;
    }
    slots = slots.map((o, n) => (n === picked ? next : o));
    draw();
    showPicked();
  };
  for (const el of [pickName, pickType, pickWidth, pickHeight]) el.addEventListener("change", change);
  side.addEventListener("change", () => {
    face = slotFace(s, id, side.value as Mounting) ?? face;
    from = null;
    picked = null;
    redraw();
  });
  mode.addEventListener("change", () => {
    from = null;
    redraw();
  });
  for (const el of [width, height]) el.addEventListener("input", redraw);

  showLength(width, k.width);
  showLength(height, k.height);
  fillSockets();
  redraw();
  const ok = await showDialog<AdapterSlot[]>({
    title: `Adapter Slots: ${face.name || "Equipment"}`,
    okLabel: "OK",
    cls: "ccad-slot-dialog",
    body: [h("div", { cls: "ccad-slot-bar" }, field("Location", side), field("Mode", mode)), h("div", { cls: "ccad-slot-bar" }, socketField, socketTextField, field("Width", width, suffix), field("Height", height, suffix)), plan, note, pickBox],
    check: () => ({ value: slots }),
  });
  k.side = side.value as Mounting;
  k.mode = mode.value as SlotMode;
  k.width = size(width) ?? k.width;
  k.height = size(height) ?? k.height;
  if (socketText.value.trim()) k.socket = socketText.value.trim();
  if (!ok || store.session !== s) return;
  const r = attempt("Adapter Slot", (session) => session.batch(() => setAdapterSlots(session, id, ok)));
  if (r) toast(`${face.name || "The equipment"} has ${ok.length === 1 ? "1 adapter slot" : `${ok.length} adapter slots`}.`, "info");
}

adapterSlotEditor.open = (id) => void editAdapterSlots(id);


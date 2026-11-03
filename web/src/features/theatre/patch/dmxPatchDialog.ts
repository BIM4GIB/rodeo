// Stage > Lighting > DMX Patch…, Spotlight's Patch dialog over the drawing's lighting devices (the sums are in
// dmxPatch.ts). The list holds every device's channel, universe and DMX address, editable in place, filtered by
// universe or to those unpatched; Find Next Conflict and Unpatch; Patch Settings (which fields, the start channel,
// universe and address, the channel increment) and Patch for the selected rows, which asks before unpatching
// the devices it lands on; and the diagnostic diagram, a cell per address coloured by its problem with the
// selected devices outlined, where dragging a device moves it. OK writes what changed as one undo step.
// Vectorworks' systems (A to Z), multi-cell parts and accessories patched on their own aren't here.

import { h } from "../../../app/dom.ts";
import { confirmDialog, showDialog } from "../../../app/menubar.ts";
import { toast } from "../../../app/toast.ts";
import type { Fixture, FixtureEdit } from "../fixture.ts";
import { editFixtures, fixtures } from "../instrument.ts";
import { counted, describeFixture, isPatched, spanOf, UNIVERSE_SIZE } from "./patch.ts";
import { freeStart, nextChannel, nextConflict, PATCH_ISSUES, patchIssues, patchOrder, patchRun, universeCells, unpatched, type CellState, type PatchFields, type PatchRow } from "./dmxPatch.ts";
import "./patch.css";

const ALL = "all";
const UNPATCHED = "unpatched";

const FIELDS: readonly { readonly value: PatchFields; readonly label: string }[] = [
  { value: "channel", label: "Channel" },
  { value: "address", label: "Patch Universe and Address" },
  { value: "all", label: "Patch all fields" },
];

/** Patch Settings' fields and increment, remembered between openings (not saved in the drawing). */
const remembered: { fields: PatchFields; increment: number } = { fields: "all", increment: 1 };

/** The diagram's colours; free cells and several problems take the theme's fill and danger colours. */
const COLOURS: Readonly<Record<Exclude<CellState, "free" | "several">, string>> = {
  ok: "hsl(140 45% 46%)",
  overlap: "hsl(28 90% 55%)",
  identical: "hsl(48 92% 54%)",
  multi: "hsl(280 55% 62%)",
  outside: "hsl(0 0% 55%)",
};

/** The diagram's grid: 32 addresses to a row, the first address of each row to its left. */
const PER_ROW = 32;
const CELL = 13;
const LABEL_W = 30;

const toRow = (f: Fixture): PatchRow => ({ id: f.id, channel: f.channel, universe: f.universe, address: f.address, footprint: f.footprint });

/** A whole number from `min` (and to `max`), or null. */
function wholeIn(text: string, min: number, max = Infinity): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** One list row's controls. */
interface ListRow {
  readonly tr: HTMLTableRowElement;
  readonly channel: HTMLInputElement;
  readonly universe: HTMLInputElement;
  readonly address: HTMLInputElement;
  readonly problems: HTMLTableCellElement;
}

/** A drag in the diagram: the device, the cell it was picked up by, and where it would land. */
interface Drag {
  readonly id: string;
  readonly grab: number;
  over: { universe: number; address: number } | null;
}

/** Stage > Lighting > DMX Patch…. */
export async function dmxPatch(): Promise<void> {
  const list = fixtures();
  if (!list.length) {
    toast("DMX Patch: the drawing has no lighting devices.", "info");
    return;
  }
  const meta = new Map(list.map((f) => [f.id, f] as const));
  const original = new Map(list.map((f) => [f.id, toRow(f)] as const));
  const rows = new Map(original);
  const order = patchOrder([...rows.values()]).map((r) => r.id);
  const current = (): PatchRow[] => order.map((id) => rows.get(id)!);
  const selected = new Set<string>();
  let anchor: string | null = null;
  let issues = patchIssues(current());
  let drag: Drag | null = null;
  const built = new Map<string, ListRow>();
  const describe = (id: string): string => describeFixture(meta.get(id)!);

  // ---- controls ----
  const filter = h("select", { cls: "menu-dialog-input", attrs: { "aria-label": "Universe" } });
  const tbody = h("tbody");
  const summary = h("p", { cls: "muted patch-dmx-status" });
  const status = h("p", { cls: "patch-dmx-status", attrs: { role: "status" } });
  const findNext = h("button", { cls: "btn", text: "Find Next Conflict", attrs: { type: "button" } });
  const unpatch = h("button", { cls: "btn", text: "Unpatch", attrs: { type: "button" } });
  const selectAll = h("button", { cls: "btn", text: "Select All", attrs: { type: "button" } });
  const num = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input patch-dmx-num", value, attrs: { type: "text", inputmode: "numeric", "aria-label": label } });
  const setChannel = num("Channel", "1");
  const setIncrement = num("Increment", String(remembered.increment));
  const setUniverse = num("Universe", "1");
  const setAddress = num("Address", "1");
  const patch = h("button", { cls: "btn", text: "Patch", attrs: { type: "button" } });
  const radios = FIELDS.map((f) => {
    const r = h("input", { attrs: { type: "radio", name: "patch-dmx-fields", value: f.value }, checked: f.value === remembered.fields });
    r.addEventListener("change", () => {
      if (r.checked) remembered.fields = f.value;
      fieldsChanged();
    });
    return h("label", { cls: "menu-dialog-check" }, r, f.label);
  });
  const fields = (): PatchFields => remembered.fields;
  const diagram = h("div", { cls: "patch-dmx-diagram" });
  const readout = h("p", { cls: "patch-readout", text: "Point at an address to see what's on it; drag a device to move it." });
  const legend = h(
    "div",
    { cls: "patch-dmx-legend" },
    ...[
      { label: "Free", colour: "var(--fill)" },
      { label: "Patched", colour: COLOURS.ok },
      ...PATCH_ISSUES.map((i) => ({ label: i.label, colour: COLOURS[i.id] })),
      { label: "More than one problem", colour: "var(--danger)" },
    ].map((k) => h("span", { cls: "patch-dmx-key" }, h("span", { cls: "patch-dmx-swatch", attrs: { style: `background: ${k.colour}` } }), k.label)),
    h("span", { cls: "patch-dmx-key" }, h("span", { cls: "patch-dmx-swatch patch-dmx-swatch-sel" }), "Selected"),
  );

  // ---- the list ----
  const universesInUse = (): number[] => [...new Set(current().filter(isPatched).map((r) => r.universe))].sort((a, b) => a - b);
  const shown = (id: string): boolean => {
    const r = rows.get(id)!;
    if (filter.value === ALL) return true;
    if (filter.value === UNPATCHED) return !isPatched(r);
    return isPatched(r) && r.universe === Number(filter.value);
  };
  const fillFilter = (): void => {
    const keep = filter.value || ALL;
    const used = universesInUse();
    if (/^\d+$/.test(keep) && !used.includes(Number(keep))) used.push(Number(keep));
    filter.replaceChildren(
      h("option", { value: ALL, text: "All" }),
      h("option", { value: UNPATCHED, text: "<Unpatched>" }),
      ...used.sort((a, b) => a - b).map((u) => h("option", { value: String(u), text: `Universe ${u}` })),
    );
    filter.value = keep;
  };
  const visible = (): string[] => order.filter((id) => built.has(id));

  const choose = (id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): void => {
    const ids = visible();
    if (e.shiftKey && anchor !== null && ids.includes(anchor) && ids.includes(id)) {
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
      selected.clear();
      for (const x of ids.slice(a, b + 1)) selected.add(x);
    } else if (e.metaKey || e.ctrlKey) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      anchor = id;
    } else {
      if (!(selected.size === 1 && selected.has(id))) {
        selected.clear();
        selected.add(id);
      }
      anchor = id;
    }
    syncSettings();
    refresh();
  };

  const edited = (id: string, set: (r: PatchRow) => PatchRow | null, input: HTMLInputElement): void => {
    const next = set(rows.get(id)!);
    input.classList.toggle("patch-dmx-bad", next === null);
    input.setAttribute("aria-invalid", String(next === null));
    if (next) rows.set(id, next);
    refresh();
  };

  const buildList = (): void => {
    built.clear();
    const trs = order.filter(shown).map((id) => {
      const r = rows.get(id)!;
      const f = meta.get(id)!;
      const channel = h("input", { cls: "menu-dialog-input patch-dmx-cell", value: r.channel, attrs: { type: "text", "aria-label": `Channel of ${describe(id)}` } });
      const universe = h("input", { cls: "menu-dialog-input patch-dmx-cell", value: r.universe ? String(r.universe) : "", attrs: { type: "text", inputmode: "numeric", "aria-label": `Universe of ${describe(id)}` } });
      const address = h("input", { cls: "menu-dialog-input patch-dmx-cell", value: r.address ? String(r.address) : "", attrs: { type: "text", inputmode: "numeric", "aria-label": `DMX Address of ${describe(id)}` } });
      channel.addEventListener("input", () => edited(id, (x) => ({ ...x, channel: channel.value.trim() }), channel));
      // blank is unpatched
      const blankOr = (text: string, max?: number): number | null => (text.trim() === "" ? 0 : wholeIn(text, 1, max));
      universe.addEventListener("input", () =>
        edited(
          id,
          (x) => {
            const u = blankOr(universe.value);
            return u === null ? null : { ...x, universe: u };
          },
          universe,
        ),
      );
      address.addEventListener("input", () =>
        edited(
          id,
          (x) => {
            const a = blankOr(address.value, UNIVERSE_SIZE);
            return a === null ? null : { ...x, address: a };
          },
          address,
        ),
      );
      const problems = h("td", { cls: "patch-dmx-problems" });
      const tr = h(
        "tr",
        { cls: "patch-dmx-row" },
        h("td", {}, channel),
        h("td", {}, universe),
        h("td", {}, address),
        h("td", { cls: "patch-dmx-fixed", text: String(spanOf(r)) }),
        h("td", { text: f.position }),
        h("td", { text: f.unit }),
        h("td", { text: f.label }),
        problems,
      );
      tr.addEventListener("mousedown", (e) => {
        // a click in a field of a selected row keeps the selection, so typing there edits that one row
        if (e.target instanceof HTMLInputElement && selected.has(id) && !(e.shiftKey || e.metaKey || e.ctrlKey)) return;
        choose(id, e);
      });
      for (const [i, input] of [channel, universe, address].entries()) {
        input.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const ids = visible();
          const next = built.get(ids[ids.indexOf(id) + (e.shiftKey ? -1 : 1)]);
          if (!next) return;
          const to = [next.channel, next.universe, next.address][i];
          choose(ids[ids.indexOf(id) + (e.shiftKey ? -1 : 1)], { metaKey: false, ctrlKey: false, shiftKey: false });
          to.focus();
          to.select();
        });
      }
      built.set(id, { tr, channel, universe, address, problems });
      return tr;
    });
    tbody.replaceChildren(...trs);
    if (!trs.length) tbody.append(h("tr", {}, h("td", { cls: "muted", text: filter.value === UNPATCHED ? "Every lighting device is patched." : "No lighting devices here.", attrs: { colspan: "8" } })));
  };

  // ---- Patch Settings ----
  /** Shows the first selected device's patch, or where it would go when it has none. */
  const syncSettings = (): void => {
    const first = order.find((id) => selected.has(id));
    if (!first) return;
    const r = rows.get(first)!;
    const ch = r.channel.trim();
    setChannel.value = /^\d+$/.test(ch) ? ch : String(nextChannel(current(), selected));
    const at = isPatched(r) ? { universe: r.universe, address: r.address } : freeStart(current(), spanOf(r), selected);
    setUniverse.value = String(at.universe);
    setAddress.value = String(at.address);
  };
  const fieldsChanged = (): void => {
    const f = fields();
    setChannel.disabled = f === "address";
    setIncrement.disabled = f === "address";
    setUniverse.disabled = f === "channel";
    setAddress.disabled = f === "channel";
  };

  const readSettings = (): { channel: number; increment: number; universe: number; address: number } | string => {
    const f = fields();
    const channel = f === "address" ? 1 : wholeIn(setChannel.value, 1);
    if (channel === null) return "The channel is a whole number from 1.";
    const increment = f === "address" ? 1 : wholeIn(setIncrement.value, 0);
    if (increment === null) return "The increment is a whole number, 0 or more.";
    const universe = f === "channel" ? 1 : wholeIn(setUniverse.value, 1);
    if (universe === null) return "The universe is a whole number from 1.";
    const address = f === "channel" ? 1 : wholeIn(setAddress.value, 1, UNIVERSE_SIZE);
    if (address === null) return `The address is a whole number from 1 to ${UNIVERSE_SIZE}.`;
    return { channel, increment, universe, address };
  };

  const say = (text: string, bad = false): void => {
    status.textContent = text;
    status.classList.toggle("th-bad", bad);
  };

  for (const input of [setChannel, setIncrement, setUniverse, setAddress]) {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      patch.click();
    });
  }
  setUniverse.addEventListener("input", () => {
    if (filter.value === UNPATCHED) drawDiagram();
  });

  patch.addEventListener("click", async () => {
    const ids = order.filter((id) => selected.has(id));
    if (!ids.length) return;
    const s = readSettings();
    if (typeof s === "string") {
      say(s, true);
      return;
    }
    remembered.increment = s.increment;
    const run = patchRun(current(), ids, { fields: fields(), ...s });
    if (run.hits.length) {
      const names = run.hits.slice(0, 4).map(describe).join("; ");
      const more = run.hits.length > 4 ? `; and ${run.hits.length - 4} more` : "";
      const go = await confirmDialog("DMX Patch", `That patch lands on the addresses of ${counted(run.hits.length, "other device")} (${names}${more}). Continue, and they become unpatched?`, "Continue");
      if (!go) return;
      for (const id of run.hits) rows.set(id, unpatched(rows.get(id)!, "address"));
    }
    for (const r of run.rows) rows.set(r.id, r);
    // the next Patch carries on from here
    const last = run.rows[run.rows.length - 1];
    if (last && fields() !== "address") setChannel.value = String(Number(last.channel) + s.increment);
    if (last && fields() !== "channel") {
      const end = last.address + spanOf(last);
      setUniverse.value = String(end > UNIVERSE_SIZE ? last.universe + 1 : last.universe);
      setAddress.value = String(end > UNIVERSE_SIZE ? 1 : end);
    }
    refresh(true);
    const parts = [`Patched ${counted(run.rows.length, "device")}`];
    if (run.hits.length) parts.push(`unpatched ${counted(run.hits.length, "device")} it landed on`);
    if (run.left.length) parts.push(`left ${counted(run.left.length, "device")} wider than a universe`);
    say(`${parts.join(", ")}.`);
  });

  unpatch.addEventListener("click", () => {
    for (const id of selected) rows.set(id, unpatched(rows.get(id)!, fields()));
    refresh(true);
    say(`Unpatched ${counted(selected.size, "device")}.`);
  });

  selectAll.addEventListener("click", () => {
    selected.clear();
    for (const id of visible()) selected.add(id);
    syncSettings();
    refresh();
  });

  findNext.addEventListener("click", () => {
    const from = anchor ?? order.find((id) => selected.has(id)) ?? null;
    const id = nextConflict(current(), issues, from);
    if (id === null) {
      say("No conflicts: every patched device has its addresses to itself and fits its universe.");
      return;
    }
    if (!shown(id)) {
      filter.value = String(rows.get(id)!.universe);
      buildList();
    }
    selected.clear();
    selected.add(id);
    anchor = id;
    syncSettings();
    refresh();
    built.get(id)?.tr.scrollIntoView({ block: "nearest" });
    say(`${describe(id)}: ${problemText(id)}.`, true);
  });

  filter.addEventListener("change", () => {
    buildList();
    // what the filter hides isn't selected
    for (const id of [...selected]) if (!built.has(id)) selected.delete(id);
    syncSettings();
    refresh();
  });

  const problemText = (id: string): string =>
    PATCH_ISSUES.filter((i) => issues.get(id)?.has(i.id))
      .map((i) => i.label)
      .join(", ");

  // ---- the diagnostic diagram ----
  const canvases = new Map<HTMLCanvasElement, number>();

  const addressAt = (canvas: HTMLCanvasElement, x: number, y: number): number => {
    const r = canvas.getBoundingClientRect();
    const w = Number(canvas.dataset.w);
    const hgt = Number(canvas.dataset.h);
    if (!r.width || !r.height) return 0;
    const cx = ((x - r.left) * w) / r.width;
    const cy = ((y - r.top) * hgt) / r.height;
    const col = Math.floor((cx - LABEL_W) / CELL);
    const row = Math.floor(cy / CELL);
    if (cx < LABEL_W || col < 0 || col >= PER_ROW || row < 0) return 0;
    const a = row * PER_ROW + col + 1;
    return a < Number(canvas.dataset.cells) ? a : 0;
  };

  const drawUniverse = (canvas: HTMLCanvasElement, universe: number): void => {
    const cells = universeCells(current(), universe);
    const count = cells.state.length;
    const lines = Math.ceil((count - 1) / PER_ROW);
    const w = LABEL_W + PER_ROW * CELL;
    const hgt = lines * CELL;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    canvas.style.width = `${w}px`;
    canvas.dataset.w = String(w);
    canvas.dataset.h = String(hgt);
    canvas.dataset.cells = String(count);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const root = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string => root.getPropertyValue(name).trim() || fallback;
    ctx.clearRect(0, 0, w, hgt);
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = token("--text-3", "#888");
    for (let r = 0; r < lines; r++) ctx.fillText(String(r * PER_ROW + 1), LABEL_W - 4, r * CELL + CELL / 2);
    const at = (a: number): { x: number; y: number } => ({ x: LABEL_W + ((a - 1) % PER_ROW) * CELL, y: Math.floor((a - 1) / PER_ROW) * CELL });
    const free = token("--fill", "rgba(127, 127, 127, 0.14)");
    const danger = token("--danger", "#d64545");
    for (let a = 1; a < count; a++) {
      const s = cells.state[a];
      const { x, y } = at(a);
      ctx.fillStyle = s === "free" ? free : s === "several" ? danger : COLOURS[s];
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      if (s === "outside") {
        ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 1, y + CELL - 1);
        ctx.lineTo(x + CELL - 1, y + 1);
        ctx.stroke();
      }
    }
    // the selected devices outlined, an arrow at their first and last addresses
    const accent = token("--accent", "#3b82f6");
    ctx.strokeStyle = accent;
    ctx.fillStyle = accent;
    ctx.lineWidth = 2;
    for (const id of selected) {
      const r = rows.get(id)!;
      if (!isPatched(r) || r.universe !== universe) continue;
      const last = Math.min(count - 1, r.address + spanOf(r) - 1);
      for (let a = r.address; a <= last; a++) {
        const { x, y } = at(a);
        ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
      }
      const s = at(r.address);
      const e = at(last);
      ctx.beginPath();
      ctx.moveTo(s.x + 3, s.y + 3);
      ctx.lineTo(s.x + CELL / 2, s.y + CELL / 2);
      ctx.lineTo(s.x + 3, s.y + CELL - 3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(e.x + CELL - 3, e.y + 3);
      ctx.lineTo(e.x + CELL / 2, e.y + CELL / 2);
      ctx.lineTo(e.x + CELL - 3, e.y + CELL - 3);
      ctx.fill();
    }
    // where a dragged device would land
    if (drag?.over && drag.over.universe === universe) {
      const span = spanOf(rows.get(drag.id)!);
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = token("--text", "#fff");
      ctx.lineWidth = 1.5;
      for (let a = drag.over.address; a < Math.min(count, drag.over.address + span); a++) {
        const { x, y } = at(a);
        ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }
      ctx.setLineDash([]);
    }
  };

  const wireCanvas = (canvas: HTMLCanvasElement): void => {
    const universeOf = (): number => canvases.get(canvas) ?? 1;
    const tell = (a: number, universe: number): void => {
      if (!a) return;
      const on = universeCells(current(), universe).ids[a] ?? [];
      const where = a > UNIVERSE_SIZE ? `past address ${UNIVERSE_SIZE}` : `address ${a}`;
      readout.textContent = on.length ? `Universe ${universe}, ${where}: ${on.map((id) => describe(id) + (issues.has(id) ? ` (${problemText(id)})` : "")).join(" and ")}.` : `Universe ${universe}, ${where}: free.`;
    };
    canvas.addEventListener("pointerdown", (e) => {
      const a = addressAt(canvas, e.clientX, e.clientY);
      const on = a ? (universeCells(current(), universeOf()).ids[a] ?? []) : [];
      if (!on.length) return;
      const id = on[on.length - 1];
      choose(id, e);
      drag = { id, grab: a - rows.get(id)!.address, over: null };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const over = target instanceof HTMLCanvasElement && canvases.has(target) ? target : null;
      if (!drag) {
        tell(addressAt(canvas, e.clientX, e.clientY), universeOf());
        return;
      }
      const a = over ? addressAt(over, e.clientX, e.clientY) : 0;
      const span = spanOf(rows.get(drag.id)!);
      drag.over = a ? { universe: canvases.get(over!)!, address: Math.min(UNIVERSE_SIZE, Math.max(1, a - drag.grab)) } : null;
      if (drag.over) readout.textContent = `Move ${describe(drag.id)} to universe ${drag.over.universe}, address ${drag.over.address}${drag.over.address + span - 1 > UNIVERSE_SIZE ? " (past 512)" : ""}.`;
      drawDiagram();
    });
    const drop = (): void => {
      if (!drag) return;
      const d = drag;
      drag = null;
      const r = rows.get(d.id)!;
      if (d.over && (d.over.universe !== r.universe || d.over.address !== r.address)) {
        rows.set(d.id, { ...r, universe: d.over.universe, address: d.over.address });
        refresh(true);
        say(`Moved ${describe(d.id)} to ${d.over.universe}/${d.over.address}.`);
      } else drawDiagram();
    };
    canvas.addEventListener("pointerup", drop);
    canvas.addEventListener("pointercancel", () => {
      drag = null;
      drawDiagram();
    });
  };

  /** The universes the diagram shows: the one filtered to, every one in use, or where Patch would go. */
  const diagramUniverses = (): number[] => {
    if (/^\d+$/.test(filter.value)) return [Number(filter.value)];
    if (filter.value === UNPATCHED) return [wholeIn(setUniverse.value, 1) ?? 1];
    const used = universesInUse();
    if (drag?.over && !used.includes(drag.over.universe)) used.push(drag.over.universe);
    return used.length ? used.sort((a, b) => a - b) : [1];
  };

  const drawDiagram = (): void => {
    const want = diagramUniverses();
    const have = [...canvases.values()];
    // a drag keeps its canvases, which hold the pointer, until it ends
    if (!drag && (want.length !== have.length || want.some((u, i) => u !== have[i]))) {
      canvases.clear();
      diagram.replaceChildren(
        ...want.map((u) => {
          const canvas = h("canvas", { cls: "patch-canvas patch-dmx-canvas", attrs: { role: "img", "aria-label": `Universe ${u} diagram` } });
          canvases.set(canvas, u);
          wireCanvas(canvas);
          return h("section", { cls: "patch-universe" }, h("div", { cls: "patch-universe-head", text: `Universe ${u}` }), canvas);
        }),
      );
    }
    for (const [canvas, u] of canvases) drawUniverse(canvas, u);
  };

  // ---- everything after a change ----
  const refresh = (values = false): void => {
    const all = current();
    issues = patchIssues(all);
    for (const [id, el] of built) {
      const r = rows.get(id)!;
      el.tr.classList.toggle("patch-dmx-sel", selected.has(id));
      el.tr.classList.toggle("patch-dmx-issue", issues.has(id));
      el.problems.textContent = problemText(id);
      if (values) {
        for (const [input, v] of [
          [el.channel, r.channel],
          [el.universe, r.universe ? String(r.universe) : ""],
          [el.address, r.address ? String(r.address) : ""],
        ] as const) {
          input.value = v;
          input.classList.remove("patch-dmx-bad");
          input.removeAttribute("aria-invalid");
        }
      }
    }
    const patched = all.filter(isPatched).length;
    const notes = [`${counted(all.length, "lighting device")}, ${patched} patched, ${all.length - patched} not`];
    if (issues.size) notes.push(`${counted(issues.size, "device")} with patch problems`);
    summary.textContent = `${notes.join("; ")}.`;
    summary.classList.toggle("th-bad", issues.size > 0);
    const none = selected.size === 0;
    patch.disabled = none;
    unpatch.disabled = none;
    fillFilter();
    drawDiagram();
  };

  fillFilter();
  buildList();
  fieldsChanged();
  refresh();

  const edits = await showDialog<{ id: string; edit: FixtureEdit }[]>({
    title: "DMX Patch",
    okLabel: "OK",
    cls: "patch-dmx-dialog",
    body: [
      h("div", { cls: "patch-dmx-top" }, h("label", { cls: "menu-dialog-field patch-dmx-filter" }, h("span", { cls: "menu-dialog-label", text: "Universe" }), filter), findNext, unpatch, selectAll),
      h(
        "div",
        { cls: "patch-dmx-scroll" },
        h(
          "table",
          { cls: "patch-dmx-table" },
          h("thead", {}, h("tr", {}, ...["Channel", "Universe", "DMX Address", "Footprint", "Position", "Unit", "Instrument", "Problems"].map((t) => h("th", { text: t })))),
          tbody,
        ),
      ),
      summary,
      status,
      h(
        "fieldset",
        { cls: "patch-dmx-settings" },
        h("legend", { text: "Patch Settings" }),
        h("div", { cls: "patch-dmx-radios" }, ...radios),
        h(
          "div",
          { cls: "patch-dmx-fields" },
          ...[
            ["Channel", setChannel],
            ["Increment", setIncrement],
            ["Universe", setUniverse],
            ["Address", setAddress],
          ].map(([label, input]) => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label as string }), input as HTMLInputElement)),
          patch,
        ),
      ),
      diagram,
      readout,
      legend,
    ],
    check: () => {
      const bad = tbody.querySelector<HTMLInputElement>("input[aria-invalid='true']");
      if (bad) return { error: `Fix the value outlined in red: a universe is a whole number from 1, an address from 1 to ${UNIVERSE_SIZE}, or blank.`, focus: bad };
      const out: { id: string; edit: FixtureEdit }[] = [];
      for (const id of order) {
        const a = original.get(id)!;
        const b = rows.get(id)!;
        const edit: { channel?: string; universe?: number; address?: number } = {};
        if (a.channel !== b.channel) edit.channel = b.channel;
        if (a.universe !== b.universe || a.address !== b.address) {
          edit.universe = b.universe;
          edit.address = b.address;
        }
        if (Object.keys(edit).length) out.push({ id, edit });
      }
      return { value: out };
    },
  });
  if (!edits?.length) return;
  if (editFixtures("DMX Patch", edits)) toast(`DMX Patch: ${counted(edits.length, "lighting device")} changed.`, "info");
}

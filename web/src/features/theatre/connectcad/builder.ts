// ConnectCAD Schematics' Device Builder tool: a click opens the Device Builder, which describes a device
// (its make and model, name, tag and description, physical details and rows of sockets) beside a
// picture of it, and places it with its top left at the click. OK also keeps it in the user's device
// list, in this browser, to pick by make and model next time; Create Temporary Device only places it.
// Preferences: the box's minimum width, space at its top and bottom, the gap between socket rows,
// truncating long tags, and whether the device list is offered. The sums are builderShapes.ts; the
// device is schematic.ts's.

import type { Pt } from "../../../core/index.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { BaseTool, type PointerInfo } from "../../../app/tools.ts";
import { connectorsFor, signalNames, SOCKET_TYPES, type SocketType } from "./ccadShapes.ts";
import { addBuiltDevice } from "./schematic.ts";
import {
  BUILDER_DEFAULTS,
  designBox,
  designKey,
  designProblems,
  designsFrom,
  designSockets,
  designSvg,
  NEW_DESIGN,
  newRow,
  rackWidthOf,
  truncated,
  withDesign,
  type BuilderLayout,
  type DeviceDesign,
  type SocketRow,
} from "./builderShapes.ts";
import "./connectcad.css";

const STORE = "rodeo.connectcad.devices";

export const builderSettings: { layout: BuilderLayout; database: boolean; last: DeviceDesign } = { layout: { ...BUILDER_DEFAULTS }, database: true, last: NEW_DESIGN };

/** The user's devices, kept in this browser as Vectorworks keeps them in the user folder. */
export function savedDevices(): DeviceDesign[] {
  try {
    return designsFrom(JSON.parse(localStorage.getItem(STORE) ?? "[]"));
  } catch {
    return [];
  }
}

function keepDevices(list: readonly DeviceDesign[]): boolean {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

type Draft = { -readonly [K in keyof DeviceDesign]: DeviceDesign[K] } & { rows: SocketRow[] };

const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
const button = (label: string, run: () => void): HTMLButtonElement => {
  const b = h("button", { cls: "menu-dialog-button", text: label, attrs: { type: "button" } }) as HTMLButtonElement;
  b.addEventListener("click", run);
  return b;
};
const choiceOf = (values: readonly string[], value: string, label: string, set: (v: string) => void): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...[...new Set([...values, value])].map((v) => h("option", { value: v, text: v }))) as HTMLSelectElement;
  el.value = value;
  el.addEventListener("change", () => set(el.value));
  return el;
};

/** The Device Builder: a device described, or null when cancelled; `keep` when it goes in the user's list. */
async function buildDevice(): Promise<{ design: DeviceDesign; keep: boolean } | null> {
  const k = builderSettings;
  let saved = savedDevices();
  const draft = JSON.parse(JSON.stringify(k.last)) as Draft;
  let temporary = false;
  const body = h("div", { cls: "ccad-pane ccad-builder" });
  const preview = h("div", { cls: "ccad-label-preview" });
  const showPreview = (): void => {
    preview.innerHTML = designSvg(draft, k.layout, 12);
  };
  const text = (value: string, label: string, set: (v: string) => void, wide = true): HTMLInputElement => {
    const el = h("input", { cls: `menu-dialog-input${wide ? "" : " ccad-num"}`, value, attrs: { type: "text", "aria-label": label } }) as HTMLInputElement;
    el.addEventListener("input", () => {
      set(el.value);
      showPreview();
    });
    return el;
  };
  const amount = (value: number, label: string, set: (v: number) => void, off = false): HTMLInputElement => {
    const el = text(String(Math.round(value * 100) / 100), label, (v) => {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) set(n);
    }, false);
    el.disabled = off;
    return el;
  };
  const check = (on: boolean, label: string, set: (v: boolean) => void, off = false): HTMLElement => {
    const box = h("input", { checked: on, attrs: { type: "checkbox", "aria-label": label } }) as HTMLInputElement;
    box.disabled = off;
    box.addEventListener("change", () => {
      set(box.checked);
      showPreview();
    });
    return h("label", { cls: "menu-dialog-check" }, box, label);
  };

  const render = (): void => {
    const picked = saved.find((d) => designKey(d) === designKey(draft) && designKey(d) !== "");
    const browser = k.database
      ? [
          field(
            "Make/Model",
            choiceOf(["New Make/Model", ...saved.map(designKey)], picked ? designKey(picked) : "New Make/Model", "Make/Model", (v) => {
              const d = saved.find((x) => designKey(x) === v);
              Object.assign(draft, JSON.parse(JSON.stringify(d ?? { ...NEW_DESIGN, name: draft.name })));
              render();
            }),
          ),
          h(
            "div",
            { cls: "ccad-actions" },
            Object.assign(
              button("Delete from My Devices", () => {
                if (!picked || !keepDevices(withDesign(saved, picked, true))) return;
                saved = savedDevices();
                toast(`Device Builder: ${designKey(picked)} taken out of your devices.`, "info");
                render();
              }),
              { disabled: !picked },
            ),
          ),
        ]
      : [];
    const virtual = !draft.physical;
    const rows = draft.rows.map((r, i) => {
      const n = i + 1;
      const set = (patch: Partial<SocketRow>): void => {
        draft.rows[i] = { ...draft.rows[i], ...patch };
        showPreview();
      };
      const use = h("input", { checked: r.use, attrs: { type: "checkbox", "aria-label": `Use row ${n}` } }) as HTMLInputElement;
      use.addEventListener("change", () => set({ use: use.checked }));
      const connector = choiceOf(connectorsFor(r.signal), r.connector, `Connector of row ${n}`, (v) => set({ connector: v }));
      const signal = choiceOf(signalNames(), r.signal, `Signal of row ${n}`, (v) => {
        const offered = connectorsFor(v);
        set({ signal: v, connector: offered.includes(draft.rows[i].connector) ? draft.rows[i].connector : offered[0] });
        render();
      });
      return h(
        "tr",
        {},
        h("td", {}, use),
        h("td", {}, text(String(r.count), `Count of row ${n}`, (v) => Number(v) >= 1 && set({ count: Math.round(Number(v)) }), false)),
        h("td", {}, choiceOf(SOCKET_TYPES, r.type, `Type of row ${n}`, (v) => set({ type: v as SocketType }))),
        h("td", {}, signal),
        h("td", {}, connector),
        h("td", {}, choiceOf(["Left", "Right"], r.side === "L" ? "Left" : "Right", `Side of row ${n}`, (v) => set({ side: v === "Left" ? "L" : "R" }))),
        h("td", {}, text(r.name, `Name of row ${n}`, (v) => (draft.rows[i] = { ...draft.rows[i], name: v }))),
        h(
          "td",
          {},
          button("Duplicate", () => {
            draft.rows.splice(i + 1, 0, { ...draft.rows[i] });
            render();
          }),
        ),
        h(
          "td",
          {},
          button("Delete", () => {
            draft.rows.splice(i, 1);
            render();
          }),
        ),
      );
    });
    body.replaceChildren(
      ...browser,
      h(
        "div",
        { cls: "ccad-builder-top" },
        h(
          "div",
          { cls: "ccad-pane" },
          field("Make", text(draft.make, "Make", (v) => (draft.make = v))),
          field("Model", text(draft.model, "Model", (v) => (draft.model = v))),
          field("Device Name", text(draft.name, "Device Name", (v) => (draft.name = v))),
          field("Display Tag", text(draft.tag, "Display Tag", (v) => (draft.tag = v))),
          field("Display Description", text(draft.description, "Display Description", (v) => (draft.description = v))),
          field(
            "Device Type",
            choiceOf(["Physical", "Virtual"], draft.physical ? "Physical" : "Virtual", "Device Type", (v) => {
              draft.physical = v === "Physical";
              render();
            }),
          ),
          field("Height (mm)", amount(draft.height, "Height", (v) => (draft.height = v), virtual)),
          field("Width (mm)", amount(draft.width, "Width", (v) => (draft.width = v), virtual)),
          field("Depth (mm)", amount(draft.depth, "Depth", (v) => (draft.depth = v), virtual)),
          field("Height (Rack Units)", amount(draft.ru, "Height (Rack Units)", (v) => (draft.ru = Math.round(v)), virtual)),
          check(draft.halfRack, "Half-rack width", (v) => (draft.halfRack = v), virtual),
          field("Power (W)", amount(draft.power, "Power", (v) => (draft.power = v))),
          field("Weight (kg)", amount(draft.weight, "Weight", (v) => (draft.weight = v))),
        ),
        preview,
      ),
      h(
        "div",
        { cls: "ccad-scroll" },
        h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["Use", "#", "Type", "Signal", "Connector", "Side", "Name", "", ""].map((t) => h("th", { text: t })))), h("tbody", {}, ...rows)),
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        button("Add", () => {
          const last = draft.rows[draft.rows.length - 1];
          draft.rows.push(last ? { ...last, name: "" } : newRow("IN", "SDI"));
          render();
        }),
        button("Create Temporary Device", () => {
          temporary = true;
          (body.closest(".menu-dialog")?.querySelector("button.primary") as HTMLButtonElement | null)?.click();
        }),
      ),
      h(
        "p",
        {
          cls: "muted",
          text: `Each row is so many sockets of one type, signal and connector down one side, numbered from its name (IN1, IN2…; the type's when empty), a row's sockets together. OK places the device and keeps it in your devices${k.database ? "" : " (the device list is off in the Preferences)"}, by make and model, in this browser; Create Temporary Device only places it.`,
        },
      ),
    );
    showPreview();
  };
  render();

  const r = await showDialog<DeviceDesign>({
    title: "Device Builder",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [body],
    check: () => {
      const problems = designProblems(draft);
      if (problems.length) {
        temporary = false;
        return { error: `${problems.map((p) => p[0].toUpperCase() + p.slice(1)).join("; ")}.` };
      }
      return { value: JSON.parse(JSON.stringify(draft)) as DeviceDesign };
    },
  });
  if (!r) return null;
  k.last = r;
  return { design: r, keep: !temporary && k.database && designKey(r) !== "" };
}

/** Places a described device with its top left at `at` on a layer; keeps it in the user's devices when asked. */
function placeBuilt(layerId: string, at: Pt, design: DeviceDesign, keep: boolean): void {
  const layout = builderSettings.layout;
  const sockets = designSockets(design, layout);
  const tag = design.tag.trim() || design.name.trim();
  const r = attempt("Device Builder", (s) =>
    s.batch(() =>
      addBuiltDevice(s, layerId, at, {
        name: design.name,
        tag: layout.truncate ? truncated(tag) : design.tag,
        description: design.description || designKey(design),
        maker: design.make,
        height: design.physical ? design.height : 0,
        width: design.physical ? design.width : 0,
        depth: design.physical ? design.depth : 0,
        ru: design.physical ? design.ru : 0,
        rackWidth: rackWidthOf(design),
        power: design.power,
        weight: design.weight,
        box: designBox(sockets, layout),
        sockets,
      }),
    ),
  );
  if (!r) return;
  setEditGroup(null, [r.value]);
  if (keep) {
    const kept = keepDevices(withDesign(savedDevices(), design));
    toast(kept ? `Device Builder: ${designKey(design)} is in your devices.` : "Device Builder: placed, but this browser wouldn't keep it in your devices.", "info");
  }
}

export class DeviceBuilderTool extends BaseTool {
  readonly id = "ccdevicebuilder";
  readonly cursor = "crosshair";
  private open = false;

  hint(): string {
    return "Click where the device's top left goes, then describe it in the Device Builder";
  }

  async preferences(): Promise<void> {
    const k = builderSettings;
    const v = await toolPrefs(
      "Device Builder Preferences",
      [
        { kind: "heading", key: "appearance", label: "Device Appearance" },
        { kind: "number", key: "width", label: "Minimum Width (Grid Spaces)", value: k.layout.minWidth, min: 2, max: 100, integer: true },
        { kind: "number", key: "top", label: "Space at Top of Device (Grid Spaces)", value: k.layout.top, min: 0, max: 50, integer: true },
        { kind: "number", key: "bottom", label: "Space at Bottom of Device (Grid Spaces)", value: k.layout.bottom, min: 0, max: 50, integer: true },
        { kind: "number", key: "gap", label: "Socket Group Spacing (Grid Spaces)", value: k.layout.groupGap, min: 0, max: 10, integer: true },
        { kind: "check", key: "truncate", label: "Truncate long display tags", value: k.layout.truncate },
        { kind: "heading", key: "database", label: "Device Database" },
        { kind: "check", key: "list", label: "Enable database", value: k.database },
      ],
      "A grid space is a socket row. Socket Group Spacing is the gap between one row of sockets and the next on a side. Truncate long display tags cuts a tag of more than 13 characters to its first and last five. Enable database offers your devices, kept in this browser, by make and model.",
    );
    if (!v) return;
    k.layout = { minWidth: v.num("width"), top: v.num("top"), bottom: v.num("bottom"), groupGap: v.num("gap"), truncate: v.flag("truncate") };
    k.database = v.flag("list");
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || this.open) return;
    const layerId = store.activeLayerId;
    if (!layerId || !store.session) return;
    const at = p.pos;
    this.open = true;
    void buildDevice()
      .then((r) => {
        if (r) placeBuilt(layerId, at, r.design, r.keep);
      })
      .finally(() => (this.open = false));
  }
}

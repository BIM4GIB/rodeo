// Tools > Machine Design > 3D Properties…, as Vectorworks has it: the selected 3D objects' surface area, volume,
// radii of gyration and centre of mass, together, in the units chosen (meshSolid.ts measures them, as for
// Volumetric Properties), and Calculate Mass Properties…: their mass, weight and mass moments of inertia from a
// density or a specific gravity, in English (lb, in) or metric (kg, m) units. The radii and moments are about
// axes through the centre of mass parallel to x, y and z. The dialog can place a 3D locus at the centre of mass,
// the list (with the mass properties once calculated) as text where the drawing is clicked next, and save it as
// a text file.

import { h } from "./dom.ts";
import { checkRow, numberText, placeTextAtClick, propertyList, propertyText, unitSelect, writeTextFile, type PropertyLine, type Unit } from "./engineeringProperties.ts";
import { massProperties, type MassSystem, type Solid } from "./meshSolid.ts";
import { showDialog } from "./menubar.ts";
import { toast } from "./toast.ts";
import { measureSelected, placeCentreLocus } from "./volumetricProperties.ts";

type Group = { title?: string; lines: PropertyLine[] };

/** Calculate Mass Properties' settings, remembered between openings. */
const mass: { system: MassSystem; by: "density" | "gravity"; value: string } = { system: "english", by: "density", value: "0.2836" };

const UNITS: Readonly<Record<MassSystem, { density: string; mass: string; weight: string; moment: string }>> = {
  english: { density: "lb/cu in", mass: "lb", weight: "lbf", moment: "lb·sq in" },
  metric: { density: "kg/cu m", mass: "kg", weight: "N", moment: "kg·sq m" },
};

function geometryLines(solid: Solid, objects: number): Group {
  const v = solid.volume;
  const i = solid.inertia;
  const radius = (moment: number | undefined): number => (v && moment !== undefined ? Math.sqrt(moment / v) : NaN);
  return {
    lines: [
      { label: "Objects measured", mm: objects, power: 0 },
      { label: "Surface area", mm: solid.area, power: 2 },
      { label: v === null ? "Volume (faces not closed)" : "Volume", mm: v ?? NaN, power: 3 },
      { label: "Radius of gyration X", mm: radius(i?.xx), power: 1 },
      { label: "Radius of gyration Y", mm: radius(i?.yy), power: 1 },
      { label: "Radius of gyration Z", mm: radius(i?.zz), power: 1 },
      { label: "Center of mass X", mm: solid.center?.x ?? NaN, power: 1 },
      { label: "Center of mass Y", mm: solid.center?.y ?? NaN, power: 1 },
      { label: "Center of mass Z", mm: solid.center?.z ?? NaN, power: 1 },
    ],
  };
}

/** Calculate Mass Properties…: the mass group for the list, or null when cancelled. */
async function massDialog(solid: Solid): Promise<Group | null> {
  const select = (label: string, options: readonly [string, string][], value: string): HTMLSelectElement => {
    const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map(([v, t]) => h("option", { value: v, text: t })));
    el.value = value;
    return el;
  };
  const system = select(
    "System of Units",
    [
      ["english", "English (lb, in)"],
      ["metric", "Metric (kg, m)"],
    ],
    mass.system,
  );
  const by = select(
    "Property to Use",
    [
      ["density", "Density"],
      ["gravity", "Specific Gravity"],
    ],
    mass.by,
  );
  const value = h("input", { cls: "menu-dialog-input", value: mass.value, attrs: { type: "text", inputmode: "decimal", "aria-label": "Value" } });
  const valueUnit = h("span", { cls: "menu-dialog-label" });
  const holder = h("div", { cls: "props-holder" });
  let group: Group | null = null;
  const solve = (): void => {
    const sys = system.value as MassSystem;
    const u = UNITS[sys];
    valueUnit.textContent = by.value === "density" ? u.density : "";
    const v = Number(value.value.trim().replace(",", "."));
    if (!value.value.trim() || !Number.isFinite(v) || v <= 0) {
      group = null;
      holder.replaceChildren(h("p", { cls: "muted", text: `Enter the material's ${by.value === "density" ? `density in ${u.density}` : "specific gravity (water is 1)"}.` }));
      return;
    }
    const m = massProperties(solid.volume!, solid.inertia!, sys, by.value === "density" ? "density" : "gravity", v);
    const line = (label: string, n: number, unit: string): PropertyLine => ({ label, mm: n, power: 0, text: `${numberText(n)} ${unit}` });
    group = {
      title: "Mass Properties",
      lines: [
        by.value === "density" ? line("Density", m.density, u.density) : { label: "Specific gravity", mm: v, power: 0, text: `${numberText(v)} (${numberText(m.density)} ${u.density})` },
        line("Mass", m.mass, u.mass),
        line("Weight", m.weight, u.weight),
        line("Mass moment of inertia X", m.xx, u.moment),
        line("Mass moment of inertia Y", m.yy, u.moment),
        line("Mass moment of inertia Z", m.zz, u.moment),
      ],
    };
    holder.replaceChildren(propertyList([group], { label: "", mm: 1 }));
  };
  for (const el of [system, by, value]) el.addEventListener("input", solve);
  solve();
  const field = (label: string, ...control: Node[]): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
  const ok = await showDialog<true>({
    title: "Mass Properties",
    okLabel: "OK",
    cls: "props-dialog",
    body: [
      field("System of Units", system),
      field("Property to Use", by),
      field("Value", value, valueUnit),
      holder,
      h("p", { cls: "muted", text: "Moments are about axes through the center of mass parallel to X, Y and Z. A specific gravity is against water at 62.428 lb/cu ft (1000 kg/cu m)." }),
    ],
    check: () => (group ? { value: true } : { error: "Enter a value above 0.", focus: value }),
  });
  Object.assign(mass, { system: system.value, by: by.value, value: value.value });
  return ok ? group : null;
}

/** Tools > Machine Design > 3D Properties…. */
export async function threeDPropertiesDialog(): Promise<void> {
  const measured = measureSelected();
  if (!measured) {
    toast("Select 3D objects on their layer: nothing selected shows 3D faces.", "info");
    return;
  }
  const { solid, objects, layerId } = measured;
  const closed = solid.volume !== null && solid.inertia !== null;
  const groups: Group[] = [geometryLines(solid, objects)];
  const holder = h("div", { cls: "props-holder" });
  const units = unitSelect(() => holder.replaceChildren(propertyList(groups, units.unit())));
  holder.replaceChildren(propertyList(groups, units.unit()));
  const calculate = h("button", { cls: "btn", text: "Calculate Mass Properties…", attrs: { type: "button" }, disabled: !closed });
  calculate.addEventListener("click", async () => {
    const g = await massDialog(solid);
    if (!g) return;
    groups.splice(1, 1, g);
    holder.replaceChildren(propertyList(groups, units.unit()));
  });
  const [locus, locusRow] = checkRow("Place locus at center of mass");
  locus.disabled = !closed;
  const [place, placeRow] = checkRow("Place properties on drawing");
  const [write, writeRow] = checkRow("Write properties to a file");
  const r = await showDialog<{ unit: Unit; locus: boolean; place: boolean; write: boolean }>({
    title: "3D Properties",
    okLabel: "OK",
    cls: "props-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Units" }), units.el),
      holder,
      ...(closed ? [] : [h("p", { cls: "muted", text: "The faces don't close round a volume, so only the surface area is measured." })]),
      h("div", { cls: "menu-dialog-field" }, calculate),
      locusRow,
      placeRow,
      writeRow,
    ],
    check: () => ({ value: { unit: units.unit(), locus: locus.checked, place: place.checked, write: write.checked } }),
  });
  if (!r) return;
  if (r.locus) placeCentreLocus(solid, layerId);
  const text = propertyText("3D Properties", groups, r.unit);
  if (r.write) writeTextFile("3D Properties", text);
  if (r.place) placeTextAtClick("3D Properties", text);
}

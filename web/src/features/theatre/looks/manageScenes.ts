// Stage > Visualization > Manage Scenes…, as Spotlight has it: the drawing's scenes in the order they were
// saved. Save… keeps every lighting device's colour, place, height and focus with each channel's level (the
// look shown, or every channel at full) under a Scene Name and Number with an Up Time and Down Time; Edit…
// changes those four; Remove takes a scene out; Go! puts the selected scene's devices and levels back, after
// asking. The list is written to the drawing (show.ts) on OK, or with Go!, in one undo step. Devices deleted
// since a scene was saved are counted and left out; ones added since stay as they are.

import type { EditSession } from "../../../core/index.ts";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { confirmDialog, showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { fixtures, writeFixtures } from "../instrument.ts";
import { hasLevels, levelOf, setLevels } from "../levels.ts";
import { readShow, writeShowIn } from "../show.ts";
import { deviceStateOf, LIGHT_SCENES_KEY, parseSeconds, sceneChanges, scenesOf, type LightScene } from "./lightScenes.ts";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const button = (label: string, run: () => void, disabled = false): HTMLButtonElement => {
  const b = h("button", { cls: "menu-dialog-button", text: label, attrs: { type: "button" } }) as HTMLButtonElement;
  b.disabled = disabled;
  b.addEventListener("click", run);
  return b;
};

/** The drawing's scenes. */
export const lightScenes = (): LightScene[] => scenesOf(readShow<unknown>(LIGHT_SCENES_KEY, []));

/** The channels the drawing's devices are on. */
export const channelsNow = (): string[] => [...new Set(fixtures().map((f) => f.channel).filter(Boolean))];

/** The devices and levels as they are now, as a scene. */
function sceneNow(name: string, number: string, upS: number, downS: number): LightScene {
  const levels = hasLevels() ? Object.fromEntries(channelsNow().map((c) => [c, levelOf(c)])) : null;
  return { name, number, upS, downS, levels, devices: fixtures().map(deviceStateOf) };
}

/** The next scene number: one past the highest whole number. */
const nextNumber = (scenes: readonly LightScene[]): string => String(Math.floor(Math.max(0, ...scenes.map((s) => Number(s.number)).filter(Number.isFinite))) + 1);

/** The Save and Edit Scene dialog: the scene's name, number and times; null when cancelled. */
export async function sceneFields(title: string, scene: Pick<LightScene, "name" | "number" | "upS" | "downS">, others: readonly LightScene[]): Promise<Pick<LightScene, "name" | "number" | "upS" | "downS"> | null> {
  const input = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label } }) as HTMLInputElement;
  const name = input("Scene Name", scene.name);
  const number = input("Scene Number", scene.number);
  const up = input("Up Time", String(scene.upS));
  const down = input("Down Time", String(scene.downS));
  const field = (label: string, control: HTMLElement, unit = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control, ...(unit ? [h("span", { cls: "menu-dialog-label", text: unit })] : []));
  return showDialog<Pick<LightScene, "name" | "number" | "upS" | "downS">>({
    title,
    okLabel: "OK",
    body: [field("Scene Name", name), field("Scene Number", number), field("Up Time", up, "seconds"), field("Down Time", down, "seconds")],
    check: () => {
      const n = name.value.trim();
      if (!n) return { error: "Enter the scene's name.", focus: name };
      if (others.some((s) => s.name === n)) return { error: `There is a scene named ${n} already.`, focus: name };
      const upS = parseSeconds(up.value);
      if (typeof upS === "string") return { error: `Up Time: ${upS}.`, focus: up };
      const downS = parseSeconds(down.value);
      if (typeof downS === "string") return { error: `Down Time: ${downS}.`, focus: down };
      return { value: { name: n, number: number.value.trim(), upS, downS } };
    },
  });
}

/** Puts `scene`'s devices back in `s`; what it changed and how many of its devices are gone. */
export function goToSceneIn(s: EditSession, scene: LightScene): { changed: number; missing: number } {
  const c = sceneChanges(scene, fixtures());
  if (c.edits.length) writeFixtures(s, c.edits);
  for (const m of c.moves) s.moveObjects([m.id], m.dx, m.dy);
  return { changed: new Set([...c.edits.map((e) => e.id), ...c.moves.map((m) => m.id)]).size, missing: c.missing };
}

/** Sets the levels shown to `scene`'s. */
export function showSceneLevels(scene: LightScene): void {
  setLevels(scene.levels ? new Map(Object.entries(scene.levels)) : null);
}

/** Stage > Visualization > Manage Scenes…. */
export async function manageScenes(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const scenes = lightScenes();
  const before = JSON.stringify(scenes);
  let picked = scenes.length ? 0 : -1;
  let go: LightScene | null = null;
  const list = h("div", { cls: "ccad-scroll" });
  const actions = h("div", { cls: "ccad-actions" });
  const render = (): void => {
    const rows = scenes.map((sc, i) => {
      const radio = h("input", { checked: i === picked, attrs: { type: "radio", name: "light-scene", "aria-label": `Scene ${sc.name}` } }) as HTMLInputElement;
      radio.addEventListener("change", () => {
        if (radio.checked) picked = i;
        render();
      });
      return h(
        "tr",
        {},
        h("td", { cls: "ccad-centre" }, radio),
        h("td", { text: sc.number }),
        h("td", { text: sc.name }),
        h("td", { text: `${sc.upS} s` }),
        h("td", { text: `${sc.downS} s` }),
        h("td", { text: plural(sc.devices.length, "device", "devices") }),
      );
    });
    list.replaceChildren(
      scenes.length
        ? h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["", "Number", "Scene Name", "Up", "Down", "Saved"].map((t) => h("th", { text: t })))), h("tbody", {}, ...rows))
        : h("p", { cls: "muted", text: "No scenes yet: set the lighting devices and the look, then Save…." }),
    );
    const none = picked < 0;
    actions.replaceChildren(
      button("Save…", async () => {
        const f = await sceneFields("Save Scene", { name: `Scene ${scenes.length + 1}`, number: nextNumber(scenes), upS: 3, downS: 3 }, scenes);
        if (!f) return;
        scenes.push(sceneNow(f.name, f.number, f.upS, f.downS));
        picked = scenes.length - 1;
        render();
      }),
      button(
        "Edit…",
        async () => {
          const sc = scenes[picked];
          const f = await sceneFields("Edit Scene", sc, scenes.filter((o) => o !== sc));
          if (!f || !(await confirmDialog("Edit Scene", `Change scene ${sc.name}?`, "Change"))) return;
          scenes[picked] = { ...sc, ...f };
          render();
        },
        none,
      ),
      button(
        "Remove",
        async () => {
          if (!(await confirmDialog("Remove Scene", `Remove scene ${scenes[picked].name}?`, "Remove"))) return;
          scenes.splice(picked, 1);
          picked = Math.min(picked, scenes.length - 1);
          render();
        },
        none,
      ),
      button(
        "Go!",
        async () => {
          const sc = scenes[picked];
          if (!(await confirmDialog("Go to Scene", `Put back scene ${sc.name}'s levels, colors, positions and focus points? What hasn't been saved as a scene is lost.`, "Go!"))) return;
          go = sc;
          (list.closest("form") as HTMLFormElement | null)?.requestSubmit();
        },
        none,
      ),
    );
  };
  render();
  const ok = await showDialog<true>({
    title: "Manage Scenes",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      list,
      actions,
      h("p", {
        cls: "muted",
        text: "A scene keeps every lighting device's color, position, height and focus point, and each channel's level in the look shown (every channel at full when none is). Go! puts them back.",
      }),
    ],
    check: () => ({ value: true }),
  });
  if (!ok || store.session !== s) return;
  const target = go as LightScene | null;
  const listChanged = JSON.stringify(scenes) !== before;
  if (!target && !listChanged) return;
  const r = attempt(target ? `Go to Scene ${target.name}` : "Manage Scenes", (session) =>
    session.batch(() => {
      if (listChanged) writeShowIn(session, LIGHT_SCENES_KEY, scenes);
      return target ? goToSceneIn(session, target) : null;
    }),
  );
  if (!r) return;
  if (!target || !r.value) {
    toast(`Manage Scenes: ${plural(scenes.length, "scene", "scenes")}.`, "info");
    return;
  }
  showSceneLevels(target);
  const { changed, missing } = r.value;
  toast(`Scene ${target.name}: ${plural(changed, "lighting device", "lighting devices")} changed${missing ? `; ${plural(missing, "device", "devices")} deleted since it was saved` : ""}.`, "info");
}

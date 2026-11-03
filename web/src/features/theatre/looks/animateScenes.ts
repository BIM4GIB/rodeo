// Stage > Visualization > Animate Scenes…, as Spotlight has it: a movie of the cue from a Start Scene to an
// End Scene, each held for its Hold time, the fade between taking the End Scene's Up Time for channels that
// rise and its Down Time for those that fall (lightScenes.ts), drawn by the 3D view from where it looks now
// in its render mode (Shaded where it renders realistically). Edit Scene… changes a scene's name, number and
// times; Video Settings… the frames per second, quality and frame size, as Create Movie has them. The devices
// take the Start Scene's colours, places and focus while it holds and the End Scene's from the fade's start;
// the drawing is put back afterwards, and the levels shown before.

import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import type { RenderMode } from "../../../app/view3d.ts";
import { FPS, frameSize, isRealisticMode, QUALITIES, record, SIZES } from "../../render/movie.ts";
import { hasLevels, levelOf, setLevels } from "../levels.ts";
import { writeShow } from "../show.ts";
import { fadeLevels, fadeSeconds, LIGHT_SCENES_KEY, parseSeconds, type LightScene } from "./lightScenes.ts";
import { channelsNow, goToSceneIn, lightScenes, sceneFields } from "./manageScenes.ts";

/** Video Settings, kept between openings */
const video = { fps: "30", quality: "high", size: "1280x720" };

const settle = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 250));

/** Stage > Visualization > Animate Scenes…. */
export async function animateScenes(): Promise<void> {
  const s = store.session;
  if (!s) return;
  if (lightScenes().length < 2) {
    toast("Animate Scenes fades from one scene to another: save two scenes first (Stage > Visualization > Manage Scenes…).", "info");
    return;
  }
  const choose = (label: string, index: number): HTMLSelectElement => {
    const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }) as HTMLSelectElement;
    el.dataset.index = String(index);
    return el;
  };
  const startSel = choose("Start Scene", 0);
  const endSel = choose("End Scene", 1);
  const hold = (label: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value: "2", attrs: { type: "text", inputmode: "decimal", "aria-label": label } }) as HTMLInputElement;
  const holdStart = hold("Start Scene Hold for");
  const holdEnd = hold("End Scene Hold for");
  const startInfo = h("p", { cls: "muted" });
  const endInfo = h("p", { cls: "muted" });
  const fadeInfo = h("p", { cls: "muted" });
  const picked = (sel: HTMLSelectElement): LightScene | undefined => lightScenes()[Number(sel.value)];
  const fill = (): void => {
    const scenes = lightScenes();
    for (const sel of [startSel, endSel]) {
      const was = sel.value || sel.dataset.index || "0";
      sel.replaceChildren(...scenes.map((sc, i) => h("option", { value: String(i), text: `${sc.number ? `${sc.number} ` : ""}${sc.name}` })));
      sel.value = String(Math.min(Number(was), scenes.length - 1));
    }
    const info = (sc: LightScene | undefined): string => (sc ? `Scene ${sc.number || "—"}, Up Time ${sc.upS} s, Down Time ${sc.downS} s, ${sc.devices.length} devices` : "");
    startInfo.textContent = info(picked(startSel));
    endInfo.textContent = info(picked(endSel));
    const a = picked(startSel);
    const b = picked(endSel);
    fadeInfo.textContent = a && b ? `The fade takes ${fadeSeconds(a, b, channelsNow())} s: channels that rise take the End Scene's Up Time, those that fall its Down Time.` : "";
  };
  fill();
  startSel.addEventListener("change", fill);
  endSel.addEventListener("change", fill);
  const editButton = (sel: HTMLSelectElement): HTMLButtonElement => {
    const b = h("button", { cls: "menu-dialog-button", text: "Edit Scene…", attrs: { type: "button" } }) as HTMLButtonElement;
    b.addEventListener("click", async () => {
      const scenes = lightScenes();
      const i = Number(sel.value);
      const sc = scenes[i];
      if (!sc) return;
      const f = await sceneFields("Edit Scene", sc, scenes.filter((o) => o !== sc));
      if (!f) return;
      writeShow("Edit Scene", LIGHT_SCENES_KEY, scenes.map((o, k) => (k === i ? { ...o, ...f } : o)));
      fill();
    });
    return b;
  };
  const videoButton = h("button", { cls: "menu-dialog-button", text: "Video Settings…", attrs: { type: "button" } });
  videoButton.addEventListener("click", async () => {
    const v = await toolPrefs("Video Settings", [
      { kind: "choice", key: "fps", label: "Frames per second", value: video.fps, options: FPS.map((n) => ({ value: String(n), label: String(n) })) },
      { kind: "choice", key: "quality", label: "Quality", value: video.quality, options: QUALITIES.map(({ value, label }) => ({ value, label })) },
      { kind: "choice", key: "size", label: "Frame Size", value: video.size, options: SIZES.map(({ value, label }) => ({ value, label })) },
    ]);
    if (v) Object.assign(video, { fps: v.choice("fps"), quality: v.choice("quality"), size: v.choice("size") });
  });
  const field = (label: string, ...control: Node[]): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
  const group = (title: string, sel: HTMLSelectElement, info: HTMLElement, holdIn: HTMLInputElement): HTMLElement =>
    h("div", {}, h("p", { cls: "menu-dialog-heading", text: title }), field("Scene", sel), info, h("div", { cls: "menu-dialog-field" }, editButton(sel)), field("Hold for", holdIn, h("span", { cls: "menu-dialog-label", text: "seconds" })));
  const plan = await showDialog<{ start: number; end: number; holdStartS: number; holdEndS: number }>({
    title: "Animate Scenes",
    okLabel: "Make Movie",
    cls: "props-dialog",
    body: [group("Start Scene", startSel, startInfo, holdStart), group("End Scene", endSel, endInfo, holdEnd), fadeInfo, h("div", { cls: "menu-dialog-field" }, videoButton)],
    check: () => {
      if (startSel.value === endSel.value) return { error: "Choose two different scenes.", focus: endSel };
      const a = parseSeconds(holdStart.value);
      if (typeof a === "string") return { error: `Start Scene Hold for: ${a}.`, focus: holdStart };
      const b = parseSeconds(holdEnd.value);
      if (typeof b === "string") return { error: `End Scene Hold for: ${b}.`, focus: holdEnd };
      return { value: { start: Number(startSel.value), end: Number(endSel.value), holdStartS: a, holdEndS: b } };
    },
  });
  if (!plan || store.session !== s) return;
  const scenes = lightScenes();
  const start = scenes[plan.start];
  const end = scenes[plan.end];
  if (!start || !end) return;
  const channels = channelsNow();
  const fadeS = fadeSeconds(start, end, channels);
  const duration = plan.holdStartS + fadeS + plan.holdEndS;
  if (duration <= 0) {
    toast("The movie would be no time long: give a scene a Hold time, or the End Scene an Up or Down Time.", "info");
    return;
  }
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view || store.session !== s) {
    toast("The 3D view is not available here, so there is no movie to make.");
    return;
  }
  const fps = FPS.find((n) => String(n) === video.fps) ?? 30;
  const quality = QUALITIES.find((q) => q.value === video.quality) ?? QUALITIES[2];
  const now = ctx?.renderMode();
  const mode: RenderMode = now && !isRealisticMode(now) ? now : "shaded";
  const camera = view.cameraState();
  const levelsBefore = hasLevels() ? new Map(channels.map((c) => [c, levelOf(c)])) : null;
  /** the drawing's changes made for the movie, undone after it */
  let made = 0;
  let showing: LightScene | null = null;
  const show = async (scene: LightScene): Promise<void> => {
    if (showing === scene) return;
    showing = scene;
    const r = attempt("Animate Scenes", (session) => session.batch(() => goToSceneIn(session, scene)));
    if (r && r.value.changed) {
      made++;
      await settle();
    }
  };
  try {
    await record(
      view,
      {
        path: () => ({ eye: camera.position, target: camera.target }),
        loops: false,
        projection: store.viz3d.projection,
        half: camera.half,
        fov: camera.fov,
        frame: async (i) => {
          const t = i / fps - plan.holdStartS;
          await show(t < 0 ? start : end);
          setLevels(fadeLevels(start, end, channels, t));
        },
      },
      { duration, fps, mode, bits: quality.bits, size: frameSize(video.size, view), name: `${start.name} to ${end.name}`, title: "Animate Scenes" },
    );
  } finally {
    for (; made > 0 && store.session === s && s.canUndo(); made--) attempt("Undo", (session) => session.undo());
    setLevels(levelsBefore);
  }
}

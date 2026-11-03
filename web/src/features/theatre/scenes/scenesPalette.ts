// Stage > Scenes: the palette that holds the set. Add Selected as Pieces and New Scene at the top; a row
// per scene with its spike colour, name, Go (moves the set there, for real), Update (records the set as it
// is now), Delete and its place in the order. Under the list, what hits on each change. Below it, a Scrub
// from the current scene to the next (with Play) and Ghost for the scenes either side. The pieces are at
// the foot, to rename or take off the set.

import { appContext, registerPalette } from "../../../app/ext.ts";
import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { noteLine } from "../ui.ts";
import { addSelectedPieces, currentScene, deleteScene, goToScene, moveScene, newScene, recapture, removePiece, renamePiece, renameScene, sceneData, transitionsOf } from "./scenesData.ts";
import { nextScene, overlay, scrubHits } from "./scenesOverlay.ts";
import { poseIn, sceneDiff, sweep, type Scene, type SceneData } from "./transitions.ts";
import "./scenes.css";

export const PALETTE_ID = "stageScenes";

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4" width="8" height="6" rx="0.5"/><rect x="13" y="14" width="8" height="6" rx="0.5"/><path d="M11 7h2v7h0"/></svg>';

/** The palette's body: the dock's, or a window's where the dock has no palette for it (see index.ts). */
export const body = h("div", { cls: "scenes-palette" });
const status = h("p", { cls: "scenes-meta" });
const list = h("div", { cls: "scenes-list" });
const warnings = h("div", { cls: "scenes-warnings" });
const scrubTitle = h("p", { cls: "scenes-title", text: "Scrub the change" });
const scrubText = h("p", { cls: "scenes-meta" });
const slider = h("input", { attrs: { type: "range", min: "0", max: "1000", step: "1", value: "0", "aria-label": "How far through the change" } });
const playBtn = btn("Play", () => togglePlay(), true);
const hideBtn = btn("Hide", () => {
  stopPlay();
  overlay.scrub = null;
  refreshScrub();
  appContext()?.requestDraw();
});
const ghostBox = h("input", { attrs: { type: "checkbox", id: "scenes-ghost" } });
const ghostLabel = h("label", { cls: "scenes-check", attrs: { for: "scenes-ghost" } }, ghostBox, " Ghost the scenes either side");
const pieces = h("div", { cls: "scenes-pieces" });
const scrub = h("div", { cls: "scenes-scrub" }, scrubTitle, scrubText, slider, h("div", { cls: "scenes-actions" }, playBtn, hideBtn), ghostLabel);

body.append(
  h(
    "div",
    { cls: "scenes-toolbar" },
    btn("Add Selected as Pieces", () => {
      addSelectedPieces();
      render();
    }),
    btn("New Scene", () => void askNewScene(), true),
  ),
  status,
  list,
  warnings,
  scrub,
  pieces,
);

slider.addEventListener("input", () => {
  overlay.scrub = Number(slider.value) / 1000;
  refreshScrub();
  appContext()?.requestDraw();
});
ghostBox.addEventListener("change", () => {
  overlay.ghost = ghostBox.checked;
  appContext()?.requestDraw();
});

/** A button of the palette: primary for the one a user most likely wants. */
function btn(text: string, run: () => void, primary = false, title?: string): HTMLButtonElement {
  const b = h("button", { cls: primary ? "btn primary" : "btn", text, title, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function askNewScene(): Promise<void> {
  const d = sceneData();
  const v = await toolPrefs(
    "New Scene",
    [{ kind: "text", key: "name", label: "Scene name", value: `Scene ${d.scenes.length + 1}` }],
    "Records where every piece of the set is now as a new scene, which the drawing is then in. Its spike colour is picked for you.",
  );
  if (!v) return;
  newScene(v.choice("name").trim() || `Scene ${d.scenes.length + 1}`);
  render();
}

/** One scene's row: colour, name, what's on stage, and its actions. */
function sceneRow(sc: Scene, i: number, d: SceneData, isCurrent: boolean): HTMLElement {
  const dot = h("span", { cls: "scenes-dot", title: "Spike colour for this scene" });
  dot.style.background = sc.color;
  const name = h("input", { cls: "scenes-name", value: sc.name, attrs: { type: "text", "aria-label": "Scene name" } });
  name.addEventListener("change", () => {
    renameScene(sc.id, name.value);
    render();
  });
  const onStage = d.pieces.filter((p) => !poseIn(sc, p).out).length;
  const flown = d.pieces.length - onStage;
  const meta = h("p", { cls: "scenes-meta", text: `${isCurrent ? "In the drawing now · " : ""}${onStage} on stage${flown ? `, ${flown} flown` : ""}` });
  const up = btn("▲", () => {
    moveScene(sc.id, -1);
    render();
  });
  up.title = "Move earlier in the order";
  up.disabled = i === 0;
  const down = btn("▼", () => {
    moveScene(sc.id, 1);
    render();
  });
  down.title = "Move later in the order";
  down.disabled = i === d.scenes.length - 1;
  const actions = h(
    "div",
    { cls: "scenes-actions" },
    btn(
      "Go",
      () => {
        goToScene(sc.id);
        render();
      },
      true,
      "Move the pieces to this scene, for real (one undo step)",
    ),
    btn(
      "Update",
      () => {
        recapture(sc.id);
        render();
      },
      false,
      "Record the pieces where they are now as this scene",
    ),
    btn(
      "Delete",
      () => {
        deleteScene(sc.id);
        render();
      },
      false,
      "Delete this scene; the drawing stays as it is",
    ),
    up,
    down,
  );
  return h("div", { cls: isCurrent ? "scenes-scene current" : "scenes-scene" }, h("div", { cls: "scenes-head" }, dot, name), meta, actions);
}

/** What hits on each change from one scene to the next, in words. */
function warningLines(d: SceneData): HTMLElement[] {
  const named = (id: string): string => d.pieces.find((p) => p.id === id)?.name ?? "a piece";
  const out: HTMLElement[] = [];
  for (const [a, b] of transitionsOf(d)) {
    for (const c of sweep(a, b, d.pieces)) out.push(noteLine(`${a.name} to ${b.name}: ${named(c.a)} hits ${named(c.b)} at ${Math.round(c.t * 100)}% through the change.`, "th-bad"));
  }
  if (d.scenes.length >= 2 && out.length === 0) out.push(noteLine("No pieces hit on the way from one scene to the next."));
  return out;
}

/** The scrub's words and controls, for the current scene and the next. */
function refreshScrub(): void {
  const d = sceneData();
  const cur = currentScene(d);
  const next = cur ? nextScene(d, cur) : undefined;
  const has = !!next;
  slider.disabled = !has;
  playBtn.disabled = !has;
  hideBtn.disabled = overlay.scrub === null;
  ghostBox.checked = overlay.ghost;
  slider.value = String(Math.round((overlay.scrub ?? 0) * 1000));
  if (!cur) scrubText.textContent = "Go to a scene to scrub from it to the next one.";
  else if (!next) scrubText.textContent = `${cur.name} is the last scene, so nothing follows it.`;
  else if (overlay.scrub === null) scrubText.textContent = `${cur.name} to ${next.name}: drag to see the pieces on the way.`;
  else {
    const hits = scrubHits(d, overlay.scrub).size;
    const pct = Math.round(overlay.scrub * 100);
    scrubText.textContent = `${cur.name} to ${next.name}: ${pct}% through the change${hits ? `, ${plural(hits, "piece")} hitting` : ""}.`;
  }
  playBtn.textContent = playing ? "Stop" : "Play";
}

let frame = 0;
let playing = false;

function togglePlay(): void {
  if (playing) stopPlay();
  else startPlay();
}

function startPlay(): void {
  const d = sceneData();
  const cur = currentScene(d);
  const next = cur ? nextScene(d, cur) : undefined;
  if (!cur || !next) {
    toast("Go to a scene that has one after it to play the change.", "info");
    return;
  }
  // as long as the slowest piece takes to walk, and at least a few seconds
  const seconds = Math.max(3, ...sceneDiff(cur, next, stageFrame(), lengthText, d.pieces).map((r) => r.seconds));
  const start = performance.now();
  playing = true;
  window.addEventListener("keydown", onPlayKey, true);
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / (seconds * 1000));
    overlay.scrub = t;
    refreshScrub();
    appContext()?.requestDraw();
    if (t < 1 && playing) frame = requestAnimationFrame(step);
    else stopPlay();
  };
  frame = requestAnimationFrame(step);
  refreshScrub();
}

function stopPlay(): void {
  if (!playing) return;
  playing = false;
  cancelAnimationFrame(frame);
  window.removeEventListener("keydown", onPlayKey, true);
  refreshScrub();
}

function onPlayKey(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  stopPlay();
}

/** The pieces at the foot: each renamed or taken off the set. */
function pieceRows(d: SceneData): HTMLElement[] {
  if (d.pieces.length === 0) return [noteLine("No pieces yet. Select objects in the drawing and use Add Selected as Pieces.")];
  return [
    h("p", { cls: "scenes-title", text: `Pieces (${d.pieces.length})` }),
    ...d.pieces.map((p) => {
      const name = h("input", { cls: "scenes-name", value: p.name, attrs: { type: "text", "aria-label": "Piece name" } });
      name.addEventListener("change", () => {
        renamePiece(p.id, name.value);
        render();
      });
      const take = btn(
        "Remove",
        () => {
          removePiece(p.id);
          render();
        },
        false,
        "Takes this piece off the set; its object stays in the drawing",
      );
      return h("div", { cls: "scenes-piece" }, name, take);
    }),
  ];
}

/** Rebuilds the palette from the drawing's scenes. */
function render(): void {
  const d = sceneData();
  const cur = currentScene(d);
  status.textContent = d.pieces.length || d.scenes.length ? `${plural(d.pieces.length, "piece")} · ${plural(d.scenes.length, "scene")}` : "A set has pieces and scenes. Start by adding the pieces.";
  list.replaceChildren(
    ...(d.scenes.length
      ? d.scenes.map((sc, i) => sceneRow(sc, i, d, cur?.id === sc.id))
      : [h("p", { cls: "scenes-empty", text: "No scenes yet. Once the pieces are added, New Scene records where they are." })]),
  );
  warnings.replaceChildren(...warningLines(d));
  pieces.replaceChildren(...pieceRows(d));
  refreshScrub();
}

registerPalette({ id: PALETTE_ID, title: "Scenes", side: "right", icon: ICON, hidden: true, body });
// the event can come in the middle of an edit, before its show data is written: draw once the edit is done
store.on("session", () => queueMicrotask(render));
render();

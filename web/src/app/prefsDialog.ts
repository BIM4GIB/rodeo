// Edit > Preferences… (⌘,), laid out as Vectorworks 2026 lays out its application preferences, a list
// of panes beside the one shown: General (the theme, the language, a black background), Edit (whether Duplicate
// offsets its copies, what the mouse wheel does), Display (zoomed line thickness, whether the
// objects outside a group being edited show), Session (tool
// help in the Mode bar), 3D (the conversion resolution, and whether the 3D view keeps its render
// mode and projection), Autosave, Interactive (full-screen crosshairs, the selection and snap
// boxes, pre-selection highlighting, animated view changes) and Appearance (Vectorworks' Interactive
// Appearance Settings: the colours of the selection, pre-selection, snap indicators and cursor).
// Changes apply on OK.

import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import {
  APPEARANCE_DEFAULTS,
  AUTOSAVE_MAX_BYTES,
  PREF_RANGES,
  prefs,
  setPrefs,
  TURN_STEPS,
  VIEW_MOTIONS,
  type Prefs,
  type Resolution3d,
  type ViewMotion,
} from "./prefs.ts";
import { setSnapSettings, setZoomLineThickness, store } from "./state.ts";
import { darkCanvas, setDarkCanvas, setTheme, theme, type Theme } from "./theme.ts";
import { language, LANGUAGES, setLanguage } from "./i18n.ts";

type Pane = "general" | "edit" | "display" | "session" | "3d" | "autosave" | "interactive" | "appearance";

const PANES: readonly (readonly [Pane, string])[] = [
  ["general", "General"],
  ["edit", "Edit"],
  ["display", "Display"],
  ["session", "Session"],
  ["3d", "3D"],
  ["autosave", "Autosave"],
  ["interactive", "Interactive"],
  ["appearance", "Appearance"],
];

const THEMES: readonly (readonly [Theme, string])[] = [
  ["dark", "Dark"],
  ["light", "Light"],
  ["system", "System"],
];

const RESOLUTIONS: readonly (readonly [Resolution3d, string])[] = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["very high", "Very High"],
];

const MOTION_LABEL: Record<ViewMotion, string> = { decelerate: "Decelerate", accelerate: "Accelerate", smooth: "Smooth", linear: "Linear" };

/** the snap box's side, CSS px, is twice the snap radius; its bounds */
const SNAP_BOX: readonly [number, number] = [4, 60];

/** the pane shown last, so the dialog reopens on it */
let lastPane: Pane = "general";

/** Edit > Preferences… */
export async function preferencesDialog(): Promise<void> {
  const p = prefs();
  const check = (on: boolean, label: string): [HTMLInputElement, HTMLElement] => {
    const box = h("input", { checked: on, attrs: { type: "checkbox" } });
    return [box, h("label", { cls: "menu-dialog-check" }, box, label)];
  };
  const note = (text: string): HTMLElement => h("p", { cls: "muted prefs-note", text });
  const field = (label: string, ...control: Node[]): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
  const select = <T extends string>(label: string, options: readonly (readonly [T, string])[], value: T): HTMLSelectElement => {
    const el = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } },
      ...options.map(([v, text]) => h("option", { value: v, text })),
    );
    el.value = value;
    return el;
  };
  /** a slider with its value beside it, `show` writing the value as read */
  const slider = (label: string, [min, max]: readonly [number, number], step: number, value: number, show: (v: number) => string): [HTMLInputElement, HTMLElement] => {
    const input = h("input", { cls: "prefs-range", attrs: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label } });
    input.value = String(value);
    const readout = h("span", { cls: "prefs-readout" });
    const sync = (): void => {
      readout.textContent = show(Number(input.value));
    };
    input.addEventListener("input", sync);
    sync();
    return [input, field(label, input, readout)];
  };

  // General
  const themePick = select("Interface", THEMES, theme());
  for (const option of themePick.options) option.setAttribute("data-i18n", `Theme › ${option.text}`);
  const languagePick = select(
    "Language",
    LANGUAGES.map((l) => [l.code, l.name] as const),
    language().code,
  );
  // each language's name is in itself
  languagePick.setAttribute("translate", "no");
  const [black, blackRow] = check(darkCanvas(), "Black background");
  // Edit
  const [offset, offsetRow] = check(p.offsetDuplicates, "Offset duplicates");
  const [wheel, wheelRow] = check(p.wheelZooms, "Mouse wheel zooms");
  // Display
  const [zoomLines, zoomLinesRow] = check(store.zoomLineThickness, "Zoom line thickness");
  const [others, othersRow] = check(p.showOthersEditing, "Show other objects while in editing modes");
  // Session
  const [toolHelp, toolHelpRow] = check(p.toolHelp, "Show tool help in the Mode bar");
  // 3D
  const resolution = select("3D conversion resolution", RESOLUTIONS, p.resolution3d);
  const [remember3d, remember3dRow] = check(p.remember3d, "Remember the last render mode and projection");
  // Autosave
  const [autosave, autosaveRow] = check(p.autosave, "Keep a copy of a drawing with unsaved changes");
  const minutes = h("input", {
    cls: "menu-dialog-input",
    value: String(p.autosaveMinutes),
    attrs: { type: "text", inputmode: "numeric", "aria-label": "Minutes between copies" },
  });
  const limit = Math.round(AUTOSAVE_MAX_BYTES / (1024 * 1024));
  // Interactive
  const [fullCursor, fullCursorRow] = check(p.fullCursor, "Full-screen cursor");
  const [selectBox, selectBoxRow] = check(p.selectBox, "Show the selection box");
  const snapPx = Math.round(store.snapSettings.radiusPx * 2);
  // a snap radius narrowed in the Snapping palette since: the selection box opens just inside it
  const selectPx = Math.max(PREF_RANGES.selectBoxPx[0], Math.min(p.selectBoxPx, snapPx - 2));
  const [selectSize, selectSizeRow] = slider("Selection box size", PREF_RANGES.selectBoxPx, 2, selectPx, (v) => `${v} px`);
  const [snapBox, snapBoxRow] = check(p.snapBox, "Show the snap box");
  const [snapSize, snapSizeRow] = slider("Snap box size", SNAP_BOX, 2, snapPx, (v) => `${v} px`);
  const [preselect, preselectRow] = check(p.preselect, "Pre-selection highlighting");
  const [delay, delayRow] = slider("Delay", PREF_RANGES.preselectMs, 50, p.preselectMs, (v) => `${(v / 1000).toFixed(2)} s`);
  const [animate, animateRow] = check(p.animateViews, "Animate view transitions");
  const [seconds, secondsRow] = slider("Duration", PREF_RANGES.viewSeconds, 0.05, p.viewSeconds, (v) => `${v.toFixed(2)} s`);
  const motion = select(
    "Motion",
    VIEW_MOTIONS.map((m) => [m, MOTION_LABEL[m]] as const),
    p.viewMotion,
  );
  // Appearance
  const colour = (label: string, value: string): [HTMLInputElement, HTMLElement] => {
    const input = h("input", { cls: "prefs-colour", value, attrs: { type: "color", "aria-label": label } });
    return [input, field(label, input)];
  };
  const [selectionColour, selectionColourRow] = colour("Selection", p.selectionColor);
  const [preselectColour, preselectColourRow] = colour("Pre-selection", p.preselectColor);
  const [snapColour, snapColourRow] = colour("Snap indicators", p.snapColor);
  const [cursorColour, cursorColourRow] = colour("Cursor", p.cursorColor || "#000000");
  const [cursorAuto, cursorAutoRow] = check(p.cursorColor === "", "Cursor follows the background");
  cursorColour.disabled = cursorAuto.checked;
  cursorAuto.addEventListener("change", () => {
    cursorColour.disabled = cursorAuto.checked;
  });
  const restore = h("button", { cls: "btn small prefs-restore", text: "Restore Defaults", attrs: { type: "button" } });
  restore.addEventListener("click", () => {
    selectionColour.value = APPEARANCE_DEFAULTS.selectionColor;
    preselectColour.value = APPEARANCE_DEFAULTS.preselectColor;
    snapColour.value = APPEARANCE_DEFAULTS.snapColor;
    cursorColour.value = "#000000";
    cursorAuto.checked = true;
    cursorColour.disabled = true;
  });

  const panes: Record<Pane, HTMLElement> = {
    general: h(
      "div",
      { cls: "prefs-pane" },
      field("Interface", themePick),
      field("Language", languagePick),
      blackRow,
      note("The drawing on black, its colours keeping their hue (View > Dark Canvas)."),
    ),
    edit: h(
      "div",
      { cls: "prefs-pane" },
      offsetRow,
      note("Edit > Duplicate places the copies a grid step up and to the right; without this, on top of the originals."),
      wheelRow,
      note("Without this the wheel scrolls the drawing (Shift scrolls sideways), and zooms with ⌘ or Ctrl held. A trackpad pinch always zooms."),
    ),
    display: h(
      "div",
      { cls: "prefs-pane" },
      zoomLinesRow,
      note("Line weights grow and shrink with the zoom, as they print at the layer's scale (View > Zoom Line Thickness)."),
      othersRow,
      note("While a group is edited, the rest of the drawing shows grayed; without this only the group's objects show and snap."),
    ),
    session: h(
      "div",
      { cls: "prefs-pane" },
      toolHelpRow,
      note("The active tool's steps and keys, after its modes. Without them the Mode bar is shorter; hovering a tool still names it."),
    ),
    "3d": h(
      "div",
      { cls: "prefs-pane" },
      field("3D conversion resolution", resolution),
      note("How finely circles and ellipses in extrude and sweep profiles become faces, from Low to Very High; objects Vectorworks saved with their faces keep them."),
      remember3dRow,
      note("The 3D view opens as you last left it, in a later visit too; without this it opens Shaded, in perspective. A layer's saved 3D view comes first."),
    ),
    autosave: h(
      "div",
      { cls: "prefs-pane" },
      autosaveRow,
      field("Every", minutes, h("span", { cls: "menu-dialog-unit", text: "minutes" })),
      note(`The copy stays in this browser and is offered back after a crash or a closed tab. Drawings over ${limit} MB are not copied.`),
    ),
    interactive: h(
      "div",
      { cls: "prefs-pane" },
      fullCursorRow,
      note("Crosshairs across the whole drawing at the pointer, for lining things up by eye."),
      selectBoxRow,
      selectSizeRow,
      note("A click picks what lies within the box; it must be smaller than the snap box."),
      snapBoxRow,
      snapSizeRow,
      note("Snapping reaches the points within the box (the Snapping palette's snap radius)."),
      preselectRow,
      delayRow,
      note("The Selection tool outlines what a click would select once the pointer rests on it."),
      animateRow,
      secondsRow,
      field("Motion", motion),
      note("Fit, Zoom to Selection, saved views and Previous and Next View move there rather than jump."),
    ),
    appearance: h(
      "div",
      { cls: "prefs-pane" },
      selectionColourRow,
      note("The selection's outline and handles, and what a tool shows as it draws."),
      preselectColourRow,
      note("What a click would select, outlined fainter (Interactive, Pre-selection highlighting)."),
      snapColourRow,
      note("Snap markers and their names, smart points and their guides, and the snap box."),
      cursorColourRow,
      cursorAutoRow,
      note("The full-screen cursor and the selection box; following the background, they are dark on white and light on black."),
      h("div", { cls: "prefs-actions" }, restore),
    ),
  };
  const buttons = PANES.map(([id, label]) => {
    const b = h("button", { cls: "prefs-nav-btn", text: label, attrs: { type: "button", role: "tab" } });
    b.addEventListener("click", () => show(id));
    return b;
  });
  const show = (pane: Pane): void => {
    lastPane = pane;
    PANES.forEach(([id], i) => {
      buttons[i].classList.toggle("active", id === pane);
      buttons[i].setAttribute("aria-selected", String(id === pane));
      panes[id].hidden = id !== pane;
    });
  };
  show(lastPane);

  const next = await showDialog<{ prefs: Prefs; theme: Theme; language: string; black: boolean; zoomLines: boolean; snapRadius: number }>({
    title: "Preferences",
    okLabel: "OK",
    cls: "prefs-dialog",
    body: [
      h(
        "div",
        { cls: "prefs-body" },
        h("div", { cls: "prefs-nav", attrs: { role: "tablist", "aria-orientation": "vertical" } }, ...buttons),
        h("div", { cls: "prefs-panes" }, ...PANES.map(([id]) => panes[id])),
      ),
    ],
    check: () => {
      const n = Number(minutes.value.trim());
      if (!Number.isFinite(n) || n < 1) {
        show("autosave");
        return { error: "Every: enter at least 1 minute.", focus: minutes };
      }
      if (Number(selectSize.value) >= Number(snapSize.value)) {
        show("interactive");
        return { error: "The selection box must be smaller than the snap box.", focus: selectSize };
      }
      return {
        value: {
          prefs: {
            autosave: autosave.checked,
            autosaveMinutes: Math.round(n),
            offsetDuplicates: offset.checked,
            fullCursor: fullCursor.checked,
            wheelZooms: wheel.checked,
            toolHelp: toolHelp.checked,
            showOthersEditing: others.checked,
            resolution3d: resolution.value in TURN_STEPS ? (resolution.value as Resolution3d) : p.resolution3d,
            remember3d: remember3d.checked,
            selectBox: selectBox.checked,
            selectBoxPx: Number(selectSize.value),
            snapBox: snapBox.checked,
            preselect: preselect.checked,
            preselectMs: Number(delay.value),
            animateViews: animate.checked,
            viewSeconds: Number(seconds.value),
            viewMotion: VIEW_MOTIONS.includes(motion.value as ViewMotion) ? (motion.value as ViewMotion) : p.viewMotion,
            selectionColor: selectionColour.value,
            preselectColor: preselectColour.value,
            snapColor: snapColour.value,
            cursorColor: cursorAuto.checked ? "" : cursorColour.value,
          },
          theme: themePick.value as Theme,
          language: languagePick.value,
          black: black.checked,
          zoomLines: zoomLines.checked,
          snapRadius: Number(snapSize.value) / 2,
        },
      };
    },
  });
  if (!next) return;
  setPrefs(next.prefs);
  if (next.theme !== theme()) setTheme(next.theme);
  if (next.language !== language().code) void setLanguage(next.language);
  if (next.black !== darkCanvas()) setDarkCanvas(next.black);
  setZoomLineThickness(next.zoomLines);
  if (next.snapRadius !== store.snapSettings.radiusPx) setSnapSettings({ ...store.snapSettings, radiusPx: next.snapRadius });
}

// The view controls and the Mode bar. The top bar holds 2D or 3D with the
// standard views and render mode, undo and the zoom; the View bar, a pill over
// the drawing, the active layer and class with their options and visibility
// lists, and the saved views. The Mode bar, a pill at the foot of the drawing,
// names the active tool, offers its modes and says what it does next.

import { canFitToPage, fitToPage, normalScale, redo, setActiveClass, setActiveLayer, undo, zoomBy, zoomToSelection, ZOOM_STEP } from "./commands.ts";
import { hasNextView, hasPreviousView, nextView, previousView } from "./viewHistory.ts";
import { byId, h } from "./dom.ts";
import { TOOL_ICON, UI_ICON, visibilityIcon } from "./icons.ts";
import { menuButton, type Row } from "./menu.ts";
import { showDialog } from "./menubar.ts";
import { menuKeyOf } from "./menuKeys.ts";
import { displayModeRows } from "./displayModes.ts";
import type { SavedViews } from "./panels/views.ts";
import type { Scene } from "./scene.ts";
import type { Oblique } from "./heliodon.ts";
import { onPrefs, prefs as appPrefs } from "./prefs.ts";
import { setViz, store } from "./state.ts";
import { lineRenderOptionsDialog, shadedOptionsDialog } from "./renderOptions.ts";
import { toolDef } from "./toolbar.ts";
import { screenTip } from "./screenTips.ts";
import type { ToolController, ToolModes } from "./tools.ts";
import type { View } from "./view.ts";
import type { RenderMode, ViewPreset } from "./view3d.ts";
import { visibilityListButton } from "./visibilityList.ts";
import { appContext } from "./ext.ts";
import { canRotatePlan, hasPlanRotation, planRotated, planRotationDegrees, rotatedPlan, setPlanRotationDegrees, startRotatePlan, unrotatedPlan } from "./planRotation.ts";
import { multiPane, onPanes, paneRows, toggleMultiplePanes } from "./viewPanes.ts";
import { planOnScreen, threeDOnScreen } from "./viewTargets.ts";
import { quickPrefRows } from "./quickPrefs.ts";
import { workingPlaneRows } from "./workingPlanes.ts";
import { renderStyleRows } from "../features/render/styles.ts";

/** The standard views, in the order View > Standard Views lists them. */
export const STANDARD_VIEWS: readonly (readonly [ViewPreset, string])[] = [
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["front", "Front"],
  ["back", "Back"],
  ["left", "Left"],
  ["right", "Right"],
  ["iso", "Right Isometric"],
  ["leftIso", "Left Isometric"],
  ["rightRearIso", "Right Rear Isometric"],
  ["leftRearIso", "Left Rear Isometric"],
  ["lowerRightIso", "Lower Right Isometric"],
  ["lowerLeftIso", "Lower Left Isometric"],
  ["lowerRightRearIso", "Lower Right Rear Isometric"],
  ["lowerLeftRearIso", "Lower Left Rear Isometric"],
];

export const RENDER_MODES: readonly (readonly [RenderMode, string])[] = [
  ["wireframe", "Wireframe"],
  ["hidden", "Hidden Line"],
  ["dashed", "Dashed Hidden Line"],
  ["sketch", "Sketch"],
  ["shaded", "Shaded"],
  ["textured", "Textured"],
  ["realistic", "Realistic"],
  ["pathtraced", "Path Traced"],
];

/** The perspectives View > Projection names, with their view angles (degrees from the picture's top to its bottom). */
const LENSES: readonly (readonly [string, number])[] = [
  ["Narrow Perspective", 20],
  ["Normal Perspective", 35],
  ["Wide Perspective", 60],
];
const MIN_LENS = 5;
const MAX_LENS = 120;

/** The oblique projections: receding at 45° or 30°, at full depth (cavalier) or half (cabinet). */
const OBLIQUES: readonly (readonly [string, Oblique])[] = [
  ["Oblique Cavalier 45", { angle: 45, depth: 1 }],
  ["Oblique Cavalier 30", { angle: 30, depth: 1 }],
  ["Oblique Cabinet 45", { angle: 45, depth: 0.5 }],
  ["Oblique Cabinet 30", { angle: 30, depth: 0.5 }],
];

/** What the projection rows switch between: the 2D drawing and the 3D view. */
type ProjectionActions = Pick<ViewBarDeps, "topPlan" | "toggle3d">;

/**
 * View > Projection and the View bar's Projection pop-up: 2D Plan (the drawing), or the 3D view's
 * camera, orthogonal, a perspective or oblique; a 3D projection chosen in 2D Plan shows the 3D view.
 */
export function projectionRows(actions: ProjectionActions): Row[] {
  const v = (): typeof store.viz3d => store.viz3d;
  const in3d = (): boolean => store.view3d;
  const perspective = (): boolean => in3d() && v().projection === "perspective" && !v().twoPoint;
  const project = (patch: Partial<typeof store.viz3d>): void => {
    setViz(patch);
    if (!store.view3d) actions.toggle3d();
  };
  return [
    { label: "2D Plan", checked: () => !in3d(), run: () => actions.topPlan() },
    "-",
    { label: "Orthogonal", checked: () => in3d() && v().projection === "orthogonal" && !v().oblique, run: () => project({ projection: "orthogonal", oblique: null }) },
    ...LENSES.map(([label, lens]): Row => ({
      label,
      checked: () => perspective() && v().lens === lens,
      run: () => project({ projection: "perspective", lens, twoPoint: false }),
    })),
    {
      label: "Set Custom Perspective…",
      checked: () => perspective() && !LENSES.some(([, lens]) => lens === v().lens),
      run: () => void customPerspectiveDialog(project),
    },
    {
      label: "Two-Point Perspective",
      checked: () => in3d() && v().projection === "perspective" && v().twoPoint,
      run: () => project({ projection: "perspective", twoPoint: true }),
    },
    "-",
    ...OBLIQUES.map(([label, oblique]): Row => ({
      label,
      checked: () => in3d() && v().projection === "orthogonal" && v().oblique?.angle === oblique.angle && v().oblique?.depth === oblique.depth,
      run: () => project({ projection: "orthogonal", oblique }),
    })),
  ];
}

/** View > Projection > Set Custom Perspective…: a perspective with the view angle typed, set by `project`. */
async function customPerspectiveDialog(project: (patch: Partial<typeof store.viz3d>) => void): Promise<void> {
  const input = h("input", {
    cls: "menu-dialog-input",
    value: String(Math.round(store.viz3d.lens * 10) / 10),
    attrs: { type: "text", inputmode: "decimal", "aria-label": "View angle" },
  });
  const lens = await showDialog<number>({
    title: "Set Custom Perspective",
    okLabel: "Set",
    body: [
      h("p", { cls: "muted", text: `The angle the 3D view sees from the top of the picture to its bottom: smaller flattens the view as a long lens does, larger deepens it. Narrow is ${LENSES[0][1]}°, Normal ${LENSES[1][1]}° and Wide ${LENSES[2][1]}°.` }),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "View angle" }), input, h("span", { cls: "menu-dialog-unit", text: "°" })),
    ],
    check: () => {
      const v = Number(input.value.trim().replace(/°$/, ""));
      if (!(v >= MIN_LENS && v <= MAX_LENS)) return { error: `View angle: enter ${MIN_LENS}° to ${MAX_LENS}°.`, focus: input };
      return { value: v };
    },
  });
  if (lens !== null) project({ projection: "perspective", lens, twoPoint: false });
}

/** More view options › Set Plan Rotation…: the plan's rotation typed, degrees counter-clockwise about the drawing's origin. */
async function planRotationDialog(): Promise<void> {
  const input = h("input", {
    cls: "menu-dialog-input",
    value: String(Number(planRotationDegrees().toFixed(2))),
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Rotation" },
  });
  const deg = await showDialog<number>({
    title: "Set Plan Rotation",
    okLabel: "Set",
    body: [
      h("p", { cls: "muted", text: "The plan turns on screen by this many degrees counter-clockwise, about the drawing's origin; nothing in the drawing moves. 0 unrotates it." }),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Rotation" }), input, h("span", { cls: "menu-dialog-unit", text: "°" })),
    ],
    check: () => {
      const text = input.value.trim().replace(/°$/, "");
      const v = Number(text);
      if (text === "" || !Number.isFinite(v)) return { error: "Rotation: enter an angle in degrees.", focus: input };
      return { value: v };
    },
  });
  if (deg !== null) setPlanRotationDegrees(deg);
}

/** How the 3D view is looked at and drawn, shared by the View bar and the View menu. */
export interface View3dActions {
  /** shows the 3D view (building it when needed) from a standard direction */
  standardView(preset: ViewPreset): void;
  /** Top/Plan: the 2D drawing, leaving the 3D view */
  topPlan(): void;
  renderMode(): RenderMode;
  setRenderMode(mode: RenderMode): void;
}

export function standardViewRows(actions: View3dActions): Row[] {
  return [
    {
      label: "Top/Plan",
      enabled: () => store.session !== null,
      checked: () => store.session !== null && !store.view3d && !planRotated(),
      run: () => {
        actions.topPlan();
        unrotatedPlan();
      },
    },
    { label: "Rotated Top/Plan", enabled: () => hasPlanRotation() && canRotatePlan(), checked: () => !store.view3d && planRotated(), run: rotatedPlan },
    ...STANDARD_VIEWS.map(([preset, label]) => ({
      label,
      i18n: `View › ${label}`,
      enabled: () => store.session !== null,
      run: () => actions.standardView(preset),
    })),
  ];
}

export function renderModeRows(actions: View3dActions, styles = true): Row[] {
  const hasDoc = (): boolean => store.session !== null;
  return [
    ...RENDER_MODES.map(([mode, label]) => ({
      label,
      checked: () => actions.renderMode() === mode,
      run: () => actions.setRenderMode(mode),
    })),
    // the View bar's menu lists the Renderworks styles too, as Vectorworks' does (the View menu has its own)
    ...(styles ? ["-" as const, { label: "Renderworks Style", items: () => renderStyleRows(actions) }] : []),
    "-",
    { label: "Shaded Options…", enabled: hasDoc, run: () => void shadedOptionsDialog() },
    { label: "Line Render Options…", enabled: hasDoc, run: () => void lineRenderOptionsDialog() },
  ];
}

export interface ViewBarDeps extends View3dActions {
  readonly view: View;
  readonly scene: Scene;
  readonly controller: ToolController;
  readonly savedViews: SavedViews;
  fit(): void;
  fitObjects(): void;
  toggle3d(): void;
  /** the top bar's 2D: the plan alone, in one pane */
  planAlone(): void;
  /** the top bar's 3D: the 3D view alone, in one pane */
  view3dAlone(): void;
}

function barButton(icon: string, title: string, run: () => void): HTMLButtonElement {
  const btn = h("button", { cls: "bar-btn", html: icon, title, attrs: { type: "button", "aria-label": title } });
  btn.addEventListener("click", () => {
    // so Space keeps working for panning instead of re-pressing the button
    btn.blur();
    run();
  });
  return btn;
}

/** A View bar button with an icon, a short label and a caret, which drops a menu. */
function barMenu(icon: string, label: string, title: string, rows: () => readonly Row[]): HTMLButtonElement {
  const btn = h("button", {
    cls: "bar-btn bar-menu",
    html: `${icon}${label ? `<span>${label}</span>` : ""}${UI_ICON.caret}`,
    title,
    attrs: { type: "button", "aria-label": title },
  });
  return menuButton(btn, rows);
}


function setIcon(id: string, icon: string, run: () => void): HTMLButtonElement {
  const btn = byId<HTMLButtonElement>(id);
  btn.innerHTML = icon;
  btn.addEventListener("click", () => {
    btn.blur();
    run();
  });
  return btn;
}

function percent(scale: number): string {
  const pct = scale * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toPrecision(2)}%`;
}

export function mountViewBar(deps: ViewBarDeps): void {
  const { view, scene } = deps;
  const undoBtn = setIcon("btn-undo", UI_ICON.undo, undo);
  const redoBtn = setIcon("btn-redo", UI_ICON.redo, redo);

  // zoom: fit, the scale as a percentage (typed to set it), and a menu for the rest
  const fitBtn = setIcon("btn-fit", UI_ICON.fit, deps.fit);
  const zoomField = h("input", {
    cls: "zoom-field",
    title: "Zoom of the 2D plan, as a percentage: type one to set it",
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Zoom percentage", spellcheck: "false" },
  });
  zoomField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const pct = parseFloat(zoomField.value);
      if (Number.isFinite(pct) && pct > 0) {
        // with several panes, the live plan's pane made the active one
        if (store.view3d) deps.topPlan();
        zoomBy(view, pct / 100 / view.scale);
      }
      zoomField.value = percent(view.scale);
      zoomField.blur();
    } else if (e.key === "Escape") {
      zoomField.value = percent(view.scale);
      zoomField.blur();
    }
    e.stopPropagation();
  });
  zoomField.addEventListener("focus", () => zoomField.select());
  zoomField.addEventListener("blur", () => {
    zoomField.value = percent(view.scale);
  });
  const zoomMenu = barMenu("", "", "Zoom options", () => [
    { label: "Zoom In", keys: menuKeyOf("View › Zoom In"), run: () => zoomBy(view, ZOOM_STEP) },
    { label: "Zoom Out", keys: menuKeyOf("View › Zoom Out"), run: () => zoomBy(view, 1 / ZOOM_STEP) },
    { label: "Zoom to Selection", enabled: () => store.selection.size > 0, run: () => zoomToSelection(scene, view) },
    { label: "Previous View", keys: menuKeyOf("View › Previous View"), enabled: hasPreviousView, run: () => previousView(view) },
    { label: "Next View", keys: menuKeyOf("View › Next View"), enabled: hasNextView, run: () => nextView(view) },
    { label: "Fit to Window", keys: menuKeyOf("View › Fit to Window"), run: deps.fit },
    { label: "Fit to Objects", keys: menuKeyOf("View › Fit to Objects"), run: deps.fitObjects },
    { label: "Fit to Page Area", enabled: () => canFitToPage(scene), run: () => fitToPage(scene, view) },
    {
      label: "Normal Scale",
      enabled: planOnScreen,
      run: () => {
        if (store.view3d) deps.topPlan();
        normalScale(scene, view);
      },
    },
  ]);
  zoomMenu.classList.add("caret-only");
  byId("vb-zoom").append(zoomField, zoomMenu);

  // the views: the plan alone, the 3D view alone, or the two in panes as last arranged (Split)
  const planBtn = byId<HTMLButtonElement>("btn-plan");
  const view3dBtn = byId<HTMLButtonElement>("btn-3d");
  const splitBtn = h("button", {
    cls: "seg-btn",
    text: "Split",
    title: "Split: the plan and the 3D view in panes, as last arranged",
    attrs: { type: "button", id: "btn-split", "aria-pressed": "false", "data-i18n": "View › Split" },
  });
  view3dBtn.after(splitBtn);
  planBtn.parentElement?.setAttribute("aria-label", "Views");
  planBtn.title = "2D: the plan alone, in one pane";
  view3dBtn.title = "3D: the 3D view alone, in one pane";
  planBtn.addEventListener("click", () => {
    planBtn.blur();
    deps.planAlone();
  });
  view3dBtn.addEventListener("click", () => {
    view3dBtn.blur();
    deps.view3dAlone();
  });
  splitBtn.addEventListener("click", () => {
    splitBtn.blur();
    if (!multiPane()) toggleMultiplePanes();
  });
  const standardBtn = barMenu(UI_ICON.standardViews, "", "Standard views", () => standardViewRows(deps));
  const renderBtn = barMenu(UI_ICON.render, "", "Render mode", () => renderModeRows(deps));
  // View > Multiple View Panes: the plan and the 3D view in one pane or several
  const panesBtn = barMenu(UI_ICON.viewPanes, "", "View panes", () => paneRows(() => store.session !== null));
  // the rest in one menu: the projection, the active plane, the plan's rotation and the Quick Preferences
  const moreBtn = barMenu(UI_ICON.more, "", "More view options", () => [
    { label: "Projection", enabled: () => store.session !== null, items: () => projectionRows(deps) },
    { label: "Active Plane", enabled: () => store.session !== null, items: () => workingPlaneRows(() => appContext()?.palettes.show("workingPlanes")) },
    "-",
    { label: "Rotate Plan", enabled: canRotatePlan, run: startRotatePlan },
    { label: "Set Plan Rotation…", enabled: canRotatePlan, run: () => void planRotationDialog() },
    "-",
    { label: "Quick Preferences", items: quickPrefRows },
  ]);
  // the plan's rotation, typed: in the bar only while the plan is rotated
  const planAngle = h("input", {
    cls: "zoom-field plan-angle",
    title: "Plan rotation: degrees counter-clockwise, about the drawing's origin (0 unrotates)",
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Plan rotation", spellcheck: "false" },
  });
  const showPlanAngle = (): void => {
    const deg = planRotationDegrees();
    planAngle.value = `${Number(deg.toFixed(2))}°`;
    planAngle.hidden = !planRotated();
  };
  planAngle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const deg = parseFloat(planAngle.value);
      if (Number.isFinite(deg)) setPlanRotationDegrees(deg);
      showPlanAngle();
      planAngle.blur();
    } else if (e.key === "Escape") {
      showPlanAngle();
      planAngle.blur();
    }
    e.stopPropagation();
  });
  planAngle.addEventListener("focus", () => planAngle.select());
  planAngle.addEventListener("blur", showPlanAngle);
  byId("tb-view").append(standardBtn, renderBtn, panesBtn, moreBtn, planAngle);

  // the drawing's saved views, and saving the current one
  const { savedViews } = deps;
  const savedBtn = barMenu(UI_ICON.savedViews, "", "Saved views", () => {
    const names = savedViews.names();
    return [
      ...names.map((name, i): Row => ({ label: name, run: () => savedViews.open(i) })),
      ...(names.length === 0 ? [{ label: "No saved views", enabled: () => false }] : []),
      "-",
      { label: "Save Current View", run: () => savedViews.saveCurrent() },
    ];
  });

  // the active layer and class
  const layerSelect = h("select", { cls: "bar-select", title: "Active layer", attrs: { "aria-label": "Active layer" } });
  const classSelect = h("select", { cls: "bar-select", title: "Active class", attrs: { "aria-label": "Active class" } });
  const layerScale = h("span", { cls: "vb-scale", title: "Layer scale" });
  layerSelect.addEventListener("change", () => {
    setActiveLayer(layerSelect.value);
    layerSelect.blur();
  });
  classSelect.addEventListener("change", () => {
    setActiveClass(Number(classSelect.value));
    classSelect.blur();
  });
  const layerOptions = barMenu(UI_ICON.layers, "", "Layer options", () => displayModeRows("layerMode"));
  const classOptions = barMenu(UI_ICON.classes, "", "Class options", () => displayModeRows("classMode"));
  const visList = (title: string): HTMLButtonElement =>
    h("button", {
      cls: "bar-btn bar-menu",
      html: `${visibilityIcon("visible")}${UI_ICON.caret}`,
      title,
      attrs: { type: "button", "aria-label": title },
    });
  const layerVis = visibilityListButton(visList("Layer visibility"), "layers");
  const classVis = visibilityListButton(visList("Class visibility"), "classes");
  const sep = (): HTMLElement => h("span", { cls: "pill-sep" });
  // captions over the groups, shown by Window > View Bar Options > Show View Bar Group Labels
  const caption = (text: string): HTMLElement => h("span", { cls: "vb-label", text, attrs: { "aria-hidden": "true" } });
  byId("viewbar").append(
    h(
      "div",
      { cls: "pill" },
      caption("Layer"),
      layerOptions,
      layerSelect,
      layerScale,
      layerVis,
      sep(),
      caption("Class"),
      classOptions,
      classSelect,
      classVis,
      sep(),
      caption("Views"),
      savedBtn,
    ),
  );

  const syncLayers = (): void => {
    const doc = store.session?.doc;
    const layers = doc?.layers() ?? [];
    const design = layers.filter((l) => l.kind === "design");
    const sheets = layers.filter((l) => l.kind === "sheet");
    const option = (id: string, label: string): HTMLOptionElement =>
      h("option", { text: label, attrs: { translate: "no", value: id } });
    const groups: HTMLElement[] = [];
    if (design.length) groups.push(h("optgroup", { attrs: { label: "Design layers" } }, ...design.map((l) => option(l.id, l.name))));
    if (sheets.length) groups.push(h("optgroup", { attrs: { label: "Sheet layers" } }, ...sheets.map((l) => option(l.id, l.name))));
    // a symbol or viewport annotations being edited stand in for the active layer; choosing a layer leaves them
    const open = store.symbolEdit;
    if (open) groups.unshift(h("optgroup", { attrs: { label: open.viewport ? "Viewport annotations" : "Symbol" } }, option(open.layer.id, open.layer.name)));
    layerSelect.replaceChildren(...groups);
    layerSelect.value = store.activeLayerId ?? "";
    layerSelect.disabled = !doc;
    const active = open?.layer.id === store.activeLayerId ? open.layer : layers.find((l) => l.id === store.activeLayerId);
    layerScale.textContent = active ? (active.kind === "design" ? `1:${active.scale}` : "Sheet") : "";
  };
  const syncClasses = (): void => {
    const doc = store.session?.doc;
    classSelect.replaceChildren(
      ...(doc?.classes() ?? []).map((c) => h("option", { text: c.name, attrs: c.name === "None" ? { value: String(c.index) } : { translate: "no", value: String(c.index) } })),
    );
    classSelect.value = String(store.activeClassIndex);
    classSelect.disabled = !doc;
  };
  store.on(["session", "layer"], syncLayers);
  store.on(["session", "class"], syncClasses);

  const pressed = (btn: HTMLButtonElement, on: boolean): void => {
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  };
  /** the zoom field's tooltip as last set, so it is set (and translated) again only when it changes */
  let zoomTitle = "";
  const sync = (): void => {
    const s = store.session;
    undoBtn.disabled = !s?.canUndo();
    redoBtn.disabled = !s?.canRedo();
    for (const btn of [fitBtn, zoomMenu, planBtn, view3dBtn, splitBtn, standardBtn, savedBtn, layerOptions, classOptions, layerVis, classVis, panesBtn, moreBtn]) {
      btn.disabled = !s;
    }
    // the render mode while a 3D view is on screen, the zoom while the plan is, alone or in a pane
    renderBtn.disabled = !threeDOnScreen();
    zoomField.disabled = !planOnScreen();
    const title = zoomField.disabled ? "Zoom of the 2D plan: show the plan to set it" : "Zoom of the 2D plan, as a percentage: type one to set it";
    if (title !== zoomTitle) zoomField.title = zoomTitle = title;
    planAngle.disabled = !canRotatePlan();
    if (document.activeElement !== planAngle) showPlanAngle();
    pressed(planBtn, !multiPane() && !store.view3d);
    pressed(view3dBtn, !multiPane() && store.view3d);
    pressed(splitBtn, multiPane());
  };
  store.on(["session", "selection", "view3d", "layer"], sync);
  onPanes(sync);
  store.on("view", () => {
    if (document.activeElement !== planAngle) showPlanAngle();
    if (document.activeElement !== zoomField) zoomField.value = percent(view.scale);
  });
  zoomField.value = percent(view.scale);
  syncLayers();
  syncClasses();
  sync();
}

/**
 * The Mode bar: the active tool, its mode groups as segmented controls, its Preferences button, and
 * the tool's hint: the step to take, then its keys as chips (the hint's parts are split on " · ").
 * When the canvas is too narrow for every mode, the bar goes compact: the tool shows its icon
 * alone and each mode group becomes a button that drops its modes.
 */
export function mountModeBar(controller: ToolController): void {
  const bar = byId("modebar");
  const tool = h("span", { cls: "mode-tool" });
  const modes = h("div", { cls: "mb-group" });
  const prefs = h("div", { cls: "mb-group" }, barButton(UI_ICON.prefs, "Tool preferences", () => void controller.preferences()));
  const hint = h("span", { cls: "mode-hint" });
  bar.append(tool, modes, prefs, hint);

  const syncTool = (): void => {
    const def = toolDef(store.tool);
    tool.innerHTML = TOOL_ICON[store.tool];
    tool.append(h("span", { text: def?.label ?? store.tool }));
  };
  let compact = false;
  const segOf = (m: ToolModes): HTMLElement => {
    const seg = h("div", { cls: "seg", attrs: { role: "group", "aria-label": m.label ?? "Tool modes" } });
    const tool = toolDef(store.tool)?.label ?? store.tool;
    for (const o of m.options) {
      const btn = h("button", {
        cls: o.id === m.active ? "seg-btn active" : "seg-btn",
        text: o.label,
        attrs: { type: "button", "aria-pressed": String(o.id === m.active) },
      });
      screenTip(btn, () => ({ title: o.label, keys: o.key, note: m.label ? `${tool} mode: ${m.label}` : `${tool} mode` }));
      btn.addEventListener("click", () => {
        btn.blur();
        controller.setMode(o.id);
      });
      seg.append(btn);
    }
    return seg;
  };
  const menuOf = (m: ToolModes): HTMLElement => {
    const active = m.options.find((o) => o.id === m.active);
    const btn = h("button", { cls: "seg-btn mb-menu", title: m.label ?? "Tool modes", attrs: { type: "button" } });
    btn.append(h("span", { text: active?.label ?? "" }));
    btn.insertAdjacentHTML("beforeend", UI_ICON.caret);
    return menuButton(btn, () =>
      m.options.map((o): Row => ({ label: o.label, keys: o.key, checked: () => o.id === m.active, run: () => controller.setMode(o.id) })),
    );
  };
  const syncModes = (): void => {
    const groups = controller.modes();
    modes.hidden = groups.length === 0;
    prefs.hidden = !controller.hasPreferences();
    modes.replaceChildren(...groups.map((m) => (compact ? menuOf(m) : segOf(m))));
  };
  /**
   * Fits the hint to the room the Mode bar leaves it: its key chips go first, from the last, and only
   * once none is left does the step end in an ellipsis (the whole hint is its tooltip).
   */
  const fitHint = (): void => {
    const step = hint.querySelector<HTMLElement>(".mode-step");
    const keys = [...hint.querySelectorAll<HTMLElement>(".mode-key")];
    for (const k of keys) k.hidden = false;
    if (!step || hint.hidden) return;
    for (const k of keys.reverse()) {
      if (step.scrollWidth <= step.clientWidth) return;
      k.hidden = true;
    }
  };
  /** Shows every mode when they fit, else goes compact; the hint then takes the room left. */
  const fit = (): void => {
    if (compact) {
      compact = false;
      bar.classList.remove("compact");
      syncModes();
    }
    if (bar.scrollWidth > bar.clientWidth + 1) {
      compact = true;
      bar.classList.add("compact");
      syncModes();
    }
    fitHint();
  };
  const syncHint = (): void => {
    const [step, ...keys] = store.hint.split(" · ");
    hint.title = store.hint;
    // Preferences > Session can leave the tool's help out, for a shorter Mode bar
    hint.hidden = !store.hint || !appPrefs().toolHelp;
    hint.replaceChildren(
      h("span", { cls: "mode-step", text: step ?? "" }),
      ...keys.map((k) => h("span", { cls: "mode-key", text: k })),
    );
    // once its words are translated (i18n.ts translates new text as its mutation observer sees it)
    queueMicrotask(fitHint);
  };
  store.on("tool", () => {
    syncTool();
    syncModes();
    fit();
  });
  store.on("modes", () => {
    syncModes();
    fit();
  });
  store.on("hint", syncHint);
  onPrefs(() => {
    syncHint();
    fit();
  });
  syncTool();
  syncModes();
  syncHint();
  fit();
  // the canvas narrows and widens with the window and the docked palettes
  if (bar.parentElement) new ResizeObserver(fit).observe(bar.parentElement);
  // the hint's room changes with the bars beside it too (the cursor's position widening), not only the canvas
  new ResizeObserver(fitHint).observe(hint);
  // rolled up by its grip, or unrolled
  bar.addEventListener("barroll", fit);
}

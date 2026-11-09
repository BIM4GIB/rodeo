// The Share dialog's "Embed and preview" section for a share link: its preview picture and how it is
// made, how the embed starts (2D or 3D, layer or sheet, the start view, turning, look and controls),
// and the five codes to copy. The choices and a preview being made are kept here by link, not in the
// dialog, because the dialog rebuilds its links after every change and they must survive that.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
import type { Share } from "../../platform/protocol.ts";
import { copyRow, field, note } from "../cloud/ui.ts";
import { type SharePreview, embedApi, posterUrl, turntableUrl } from "./api.ts";
import { DEFAULT_OPTIONS, type EmbedOptions, type EmbedTheme, type EmbedUi, embedUrl, shareUrl } from "./options.ts";
import { type PreviewTarget, canMakePreview, makePreview } from "./preview.ts";
import { codeTitle, elementAttrs, elementCode, iframeCode, markdownCode } from "./snippets.ts";
import "./panel.css";

/** A link's choices as its panel last left them, kept for the page's visit. */
const chosen = new Map<string, EmbedOptions>();
/** The links whose preview has been tried this visit, so one that failed is not tried again by itself. */
const tried = new Set<string>();
/** A preview being made: what it last said, and the panels for its link, told of each step and of its end. */
interface Job {
  text: string;
  readonly hearers: Set<() => void>;
}
const jobs = new Map<string, Job>();
/** Why the last try at a link's preview failed, until the next try. */
const failures = new Map<string, string>();

/** The codes' tabs in the order they show, with their names. */
const TABS = [
  ["link", "Link"],
  ["viewer", "Viewer link"],
  ["embed", "Embed"],
  ["element", "Web component"],
  ["markdown", "Markdown"],
] as const;
type Tab = (typeof TABS)[number][0];

/** A layer or sheet the Layer or sheet choice lists, under its id. */
interface LayerChoice {
  readonly id: string;
  readonly label: string;
}

/** The design layers not hidden, then the sheets, as the Layer or sheet choice lists them. */
function layerChoices(): LayerChoice[] {
  const ctx = appContext();
  if (!ctx) return [];
  const layers = ctx.scene.layers();
  return [
    ...layers.filter((l) => l.kind === "design" && l.visibility !== "hidden").map((l) => ({ id: l.id, label: l.name || "Layer" })),
    ...layers.filter((l) => l.kind === "sheet").map((l) => ({ id: l.id, label: `${l.name} ${l.title}`.trim() || "Sheet" })),
  ];
}

/** The start view the editor shows now: the 3D camera when the 3D view is on, else the 2D centre and width. */
function seenView(o: EmbedOptions): EmbedOptions | null {
  const ctx = appContext();
  if (!ctx) return null;
  const threeD = store.view3d ? ctx.view3d() : null;
  if (threeD) {
    const cam = threeD.cameraState();
    return { ...o, view: "3d", cam: { position: cam.position, target: cam.target }, preset: null, at: null };
  }
  const { view } = ctx;
  if (!(view.scale > 0)) return null;
  return { ...o, view: "2d", at: { x: view.cx, y: view.cy, span: view.width / view.scale }, cam: null };
}

/** What the picture line says about a link's preview when no job is running. */
function pictureStatus(preview: SharePreview | null, loadError: string | null): string {
  if (loadError) return `Could not load the preview: ${loadError}`;
  if (!preview) return "Loading the preview…";
  if (!preview.poster) return "No preview yet.";
  if (preview.stale) return "The drawing has changed since this preview.";
  return "Preview of the current version.";
}

/** Makes a link's preview in the background from `o`; `hear` is told each step and then the end. */
function startJob(target: PreviewTarget, o: EmbedOptions, hear: () => void): void {
  tried.add(target.token);
  failures.delete(target.token);
  const job: Job = { text: "Making the preview…", hearers: new Set([hear]) };
  jobs.set(target.token, job);
  const tell = (): void => {
    for (const fn of job.hearers) fn();
  };
  makePreview(target, o, (text) => {
    job.text = text;
    tell();
  })
    .catch((err: unknown) => {
      failures.set(target.token, errorMessage(err));
    })
    .finally(() => {
      jobs.delete(target.token);
      tell();
    });
}

/** The "Embed and preview" section of a share link's card in the Share dialog. `open` opens it at once (the first link's). */
export function embedPanel(share: Share, fileName: string, open: boolean): HTMLElement {
  const { token, fileId } = share;
  const origin = new URL(share.url).origin;
  const target: PreviewTarget = { token, fileId };
  const makeable = (): boolean => canMakePreview(fileId);
  // a new link starts in the view the editor is in, so the first embed matches what the owner sees
  let options: EmbedOptions = chosen.get(token) ?? { ...DEFAULT_OPTIONS, view: store.view3d ? "3d" : "2d" };
  chosen.set(token, options);
  let tab: Tab = "link";
  let turningPicture = false;
  let preview: SharePreview | null = null;
  let loadError: string | null = null;

  // the preview: the picture, its status, and the button that makes or updates it
  const poster = h("img", { cls: "embed-panel-poster", attrs: { alt: "The drawing's preview picture", width: "160", height: "84" } });
  const statusText = h("p", { cls: "embed-panel-status" });
  const openHint = note("Open this drawing to make its preview.", "share-hint");
  const makeButton = h("button", { cls: "btn small", text: "Make Preview", attrs: { type: "button" } });
  const pictureRow = h("div", { cls: "embed-panel-preview" }, poster, h("div", { cls: "embed-panel-preview-text" }, statusText, openHint, makeButton));

  // how the embed starts
  const startIn = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Start in" } },
    h("option", { value: "2d", text: "2D" }),
    h("option", { value: "3d", text: "3D" }));
  const layer = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Layer or sheet" } });
  const seenOption = h("option", { value: "seen", text: "The view you see now" });
  const startView = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Start view" } },
    h("option", { value: "fitted", text: "Fitted" }),
    seenOption);
  const turn = h("input", { attrs: { type: "checkbox", "aria-label": "Turn slowly" } });
  const turnLabel = h("label", { cls: "menu-dialog-check embed-panel-turn" }, turn, "Turn slowly");
  const look = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Look" } },
    h("option", { value: "auto", text: "Auto" }),
    h("option", { value: "light", text: "Light" }),
    h("option", { value: "dark", text: "Dark" }));
  const controls = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Controls" } },
    h("option", { value: "full", text: "Full" }),
    h("option", { value: "min", text: "Minimal" }),
    h("option", { value: "none", text: "None" }));

  // the layers are listed for the drawing in front only; another drawing's link keeps a layer it chose
  const fillLayers = (): void => {
    const choices = makeable() ? layerChoices() : [];
    const items = [h("option", { value: "", text: "As it opens" }), ...choices.map((c) => h("option", { value: c.id, text: c.label }))];
    if (options.layer && !choices.some((c) => c.id === options.layer)) items.push(h("option", { value: options.layer, text: "Chosen earlier" }));
    layer.replaceChildren(...items);
  };

  /** Shows the choices as the link's options now have them. */
  const paintOptions = (): void => {
    startIn.value = options.view ?? "2d";
    layer.value = options.layer ?? "";
    seenOption.disabled = !makeable();
    startView.value = options.cam || options.at ? "seen" : "fitted";
    turn.checked = options.rotate;
    turn.disabled = options.view !== "3d";
    look.value = options.theme;
    controls.value = options.ui;
  };

  // the five codes, and the Markdown picture's choice, shown in the tab in front
  const tabButtons = TABS.map(([id, label]) => {
    const button = h("button", { cls: "btn small embed-panel-tab", text: label, attrs: { type: "button", "aria-pressed": "false" } });
    button.addEventListener("click", () => {
      tab = id;
      paintCodes();
    });
    return button;
  });
  const tabRow = h("div", { cls: "embed-panel-tabs", attrs: { role: "group", "aria-label": "Code" } }, ...tabButtons);
  const codeBox = h("div", { cls: "embed-panel-code" });
  const picture = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Picture" } },
    h("option", { value: "still", text: "Still" }),
    h("option", { value: "turning", text: "Turning" }));
  picture.addEventListener("change", () => {
    turningPicture = picture.value === "turning";
    paintCodes();
  });

  /** Shows the tab in front, with its code from the choices as they stand now. */
  const paintCodes = (): void => {
    tabButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(TABS[i][0] === tab)));
    const link = shareUrl(origin, token);
    const parts: Node[] = [];
    let code: string;
    let hint: string;
    switch (tab) {
      case "link":
        code = link;
        hint = "Paste it in Slack, Discord, iMessage, X or LinkedIn to show a picture of the drawing. Notion, Medium and Ghost can embed it.";
        break;
      case "viewer":
        code = embedUrl(origin, { token }, options);
        hint = "For Notion's /embed block and anything else that frames an address.";
        break;
      case "embed":
        code = iframeCode(embedUrl(origin, { token }, options), codeTitle(fileName));
        hint = "For any web page. It fills the page's width at 16:9 and loads when scrolled to.";
        break;
      case "element":
        code = elementCode(`${origin}/embed.js`, elementAttrs(token, options));
        hint = 'Sizes itself to the page. Add load="click" to show the picture until it\'s clicked.';
        break;
      case "markdown":
        picture.value = turningPicture ? "turning" : "still";
        parts.push(field("Picture", picture));
        code = markdownCode(codeTitle(fileName), turningPicture ? turntableUrl(origin, token) : posterUrl(origin, token), link);
        hint = "For READMEs and docs: a picture that opens the drawing.";
        break;
    }
    const label = TABS.find(([id]) => id === tab)?.[1] ?? "Code";
    codeBox.replaceChildren(...parts, copyRow(code, label), note(hint, "share-hint"));
  };

  /** Takes a change of the choices: keeps them for the link and shows them again, with the code. */
  const change = (next: EmbedOptions): void => {
    options = next;
    chosen.set(token, options);
    paintOptions();
    paintCodes();
  };
  startIn.addEventListener("change", () => {
    const threeD = startIn.value === "3d";
    // a 2D start has no turn, so the turn goes with it
    change({ ...options, view: threeD ? "3d" : "2d", rotate: threeD ? options.rotate : false });
  });
  layer.addEventListener("change", () => change({ ...options, layer: layer.value || null }));
  startView.addEventListener("change", () => {
    if (startView.value === "fitted") {
      change({ ...options, cam: null, at: null });
      return;
    }
    const seen = seenView(options);
    if (seen) change(seen);
    else paintOptions();
  });
  turn.addEventListener("change", () => change({ ...options, rotate: turn.checked }));
  look.addEventListener("change", () => change({ ...options, theme: look.value as EmbedTheme }));
  controls.addEventListener("change", () => change({ ...options, ui: controls.value as EmbedUi }));

  /** Shows the picture, its status and the make button as the preview and any job now say. */
  const paintPicture = (): void => {
    const job = jobs.get(token);
    const ok = makeable();
    const url = preview?.poster?.url;
    poster.hidden = !url;
    if (url) poster.src = url;
    makeButton.textContent = preview?.poster ? "Update Preview" : "Make Preview";
    makeButton.disabled = job !== undefined || !ok;
    makeButton.title = ok ? "" : "Open this drawing to make its preview.";
    openHint.hidden = ok;
    const failed = failures.get(token);
    statusText.textContent = job ? job.text : failed ? `Could not make the preview: ${failed}` : pictureStatus(preview, loadError);
  };

  /** Told of a job's steps and its end: while it runs the status shows its step, and when it ends the picture is read again. */
  const onJob = (): void => {
    if (jobs.has(token)) paintPicture();
    else void loadPicture();
  };

  /** Reads the link's preview from the server and shows it; a link with no picture yet gets its first one made here, once. */
  const loadPicture = async (): Promise<void> => {
    try {
      preview = await embedApi.preview(token);
      loadError = null;
    } catch (err) {
      loadError = errorMessage(err);
    }
    paintPicture();
    if (preview && !preview.poster && makeable() && !tried.has(token) && !jobs.has(token)) {
      startJob(target, options, onJob);
      paintPicture();
    }
  };

  makeButton.addEventListener("click", () => {
    if (jobs.has(token) || !makeable()) return;
    startJob(target, options, onJob);
    paintPicture();
  });

  const grid = h("div", { cls: "embed-panel-options" },
    field("Start in", startIn),
    field("Layer or sheet", layer),
    field("Start view", startView),
    turnLabel,
    field("Look", look),
    field("Controls", controls));
  const body = h("div", { cls: "embed-panel-body" },
    pictureRow,
    grid,
    note("The preview is a picture of what you see now, in 3D from the start view. Update it after changing these.", "share-hint"),
    tabRow,
    codeBox);
  const panel = h("details", { cls: "embed-panel", attrs: open ? { open: "" } : {} },
    h("summary", { cls: "embed-panel-summary", text: "Embed and preview" }),
    body);

  fillLayers();
  paintOptions();
  paintCodes();
  paintPicture();
  // a preview already being made is followed here, so this panel shows its steps and its end
  jobs.get(token)?.hearers.add(onJob);
  void loadPicture();
  return panel;
}

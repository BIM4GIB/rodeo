// The crit controls: the top bar button (a speech bubble with the open thread
// count) and, over the drawing in crit mode, the toolbar with Pin, Redline (and
// its colours), Select, and the redlines waiting to be posted.

import { h } from "../../app/dom.ts";
import { store } from "../../app/state.ts";
import { openRedlineComposer } from "./composer.ts";
import { GLYPH } from "./glyphs.ts";
import { clearStrokes, setCritColour, setCritTool, toggleCrit } from "./mode.ts";
import { crit, type CritTool, REDLINE_COLOURS } from "./state.ts";

/** The top bar button: toggles crit mode, and shows how many threads are open. */
export function critTopButton(): HTMLElement {
  const count = h("span", { cls: "crit-count", hidden: true });
  const btn = h("button", { cls: "tb-icon crit-top", attrs: { type: "button", "aria-label": "Crit mode" } });
  btn.innerHTML = GLYPH.bubble;
  btn.append(count);
  btn.addEventListener("click", () => {
    btn.blur();
    toggleCrit();
  });
  const sync = (): void => {
    btn.classList.toggle("active", crit.active);
    btn.setAttribute("aria-pressed", String(crit.active));
    const open = crit.openCount();
    count.textContent = String(open);
    count.hidden = open === 0;
    btn.title = crit.active ? "Leave crit mode" : "Crit mode: pin comments and redlines for review";
    count.setAttribute("aria-label", `${open} open`);
  };
  crit.subscribe(sync);
  sync();
  return btn;
}

let bar: HTMLElement | null = null;

/** Adds the floating toolbar over the drawing (called once the editor runs). */
export function mountToolbar(): void {
  const stage = document.getElementById("stage");
  if (!stage) return;
  bar = h("div", { cls: "crit-bar", attrs: { role: "toolbar", "aria-label": "Crit tools" } });
  stage.append(bar);
  crit.subscribe(render);
  store.on("view3d", () => {
    // redlines are drawn on the 2D drawing: the 3D view hands Redline back to Select
    if (store.view3d && crit.tool === "redline") setCritTool("select");
    render();
  });
  render();
}

function toolButton(tool: CritTool, label: string, glyph: string, title: string, enabled: boolean): HTMLElement {
  const on = crit.tool === tool;
  const btn = h("button", {
    cls: `crit-tool${on ? " active" : ""}`,
    attrs: { type: "button", "aria-pressed": String(on), title },
    disabled: !enabled,
  });
  btn.innerHTML = `${glyph}<span>${label}</span>`;
  btn.addEventListener("click", () => setCritTool(tool));
  return btn;
}

function render(): void {
  if (!bar) return;
  bar.hidden = !crit.active;
  if (!crit.active) return;
  const may = crit.canComment;
  const in3d = store.view3d;
  const pin = toolButton("pin", "Pin", GLYPH.pin, !may ? "Your role lets you read comments only" : "Pin a comment on the drawing (3D: on the model)", may);
  const redline = toolButton(
    "redline",
    "Redline",
    GLYPH.redline,
    !may ? "Your role lets you read comments only" : in3d ? "Redlines are drawn on the 2D drawing" : "Draw on the drawing, then add a note",
    may && !in3d,
  );
  const select = toolButton("select", "Select", GLYPH.select, "Edit the drawing as usual", true);
  const parts: (HTMLElement | null)[] = [pin, redline];
  if (crit.tool === "redline") {
    parts.push(
      h(
        "div",
        { cls: "crit-swatches", attrs: { role: "group", "aria-label": "Redline colour" } },
        ...REDLINE_COLOURS.map((c) => {
          const on = crit.colour === c.value;
          const sw = h("button", {
            cls: `crit-swatch${on ? " active" : ""}`,
            attrs: { type: "button", title: c.name, "aria-label": `${c.name} redline`, "aria-pressed": String(on) },
          });
          sw.style.background = c.value;
          sw.addEventListener("click", () => setCritColour(c.value));
          return sw;
        }),
      ),
    );
  }
  parts.push(h("span", { cls: "crit-sep", attrs: { role: "separator" } }), select);
  if (crit.strokes.length > 0) {
    const n = crit.strokes.length;
    const done = h("button", { cls: "crit-text-btn primary", text: "Done", attrs: { type: "button", title: "Add a note to the redline" } });
    done.addEventListener("click", () => openRedlineComposer());
    const clear = h("button", { cls: "crit-text-btn", text: "Clear", attrs: { type: "button", title: "Discard the redlines not yet posted" } });
    clear.addEventListener("click", () => clearStrokes());
    parts.push(
      h("span", { cls: "crit-sep", attrs: { role: "separator" } }),
      h("span", { cls: "crit-draft", text: `${n} ${n === 1 ? "stroke" : "strokes"}` }),
      done,
      clear,
    );
  }
  const leave = h("button", { cls: "crit-tool-close", attrs: { type: "button", title: "Leave crit mode", "aria-label": "Leave crit mode" } });
  leave.innerHTML = GLYPH.close;
  leave.addEventListener("click", () => toggleCrit());
  parts.push(h("span", { cls: "crit-sep", attrs: { role: "separator" } }), leave);
  bar.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
}

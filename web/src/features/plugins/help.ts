// Help > Plug-in API…: the plug-in API on one pane, in the editor's dialog style.
// The same material is in API.md, which is the longer reference.

import { h } from "../../app/dom.ts";
import { showDialog } from "../../app/menubar.ts";
import { shortcutText } from "../../app/menu.ts";

type Block = readonly [kind: "h" | "p" | "code" | "list", text: string | readonly string[]];

const SECTIONS: readonly { readonly title: string; readonly blocks: readonly Block[] }[] = [
  {
    title: "What a plug-in is",
    blocks: [
      ["p", "A plug-in is a JavaScript file. It runs in its own Web Worker and reaches the drawing only through the openvwx object: every call is checked against the API, and the rest of the page is out of its reach."],
      ["p", "Write one in the editor (Plug-ins > Plug-in Manager… > New Plug-in), import a .js file, or start from the three examples, which are installed turned off."],
      ["p", "This is about honesty, not security. The worker has no page, cookies or storage to touch, and plug-ins that cannot be trusted should not be installed. It is not a sandbox that holds out a determined attacker."],
    ],
  },
  {
    title: "The header",
    blocks: [
      ["code", "// @name Number Selected Objects\n// @description Adds text labels to the selection.\n// @version 1.0\n// @author Your name"],
      ["p", "The header comment lines at the top name the plug-in in the Manager and the Plug-ins menu."],
    ],
  },
  {
    title: "Running",
    blocks: [
      ["p", `Run (${shortcutText("⌘↩")}) runs the code once: its top level, then each menu item it added, in order. Stop ends a run. Save (${shortcutText("⌘S")}) stores the code, and an enabled plug-in starts again with it.`],
      ["p", "An enabled plug-in's top level runs when openvwx starts, so keep side effects in menu items. Its menu items stay in the Plug-ins menu."],
      ["code", 'openvwx.menu.add("Count by Class", async () => {\n  const layer = await openvwx.activeLayer();\n  const objects = await openvwx.doc.objects(layer);\n  await openvwx.ui.alert("Count", String(objects.length) + " objects");\n});'],
    ],
  },
  {
    title: "Reading the drawing (openvwx.doc)",
    blocks: [
      ["list", [
        "info(), layers(), classes(), symbols(), lineTypes(), colors()",
        "objects(layerId?) : the active layer's when left out; groups list their contents",
        "object(id), selection(), records(id)",
      ]],
      ["p", "Results are plain data (ObjectInfo, LayerInfo and so on) and cross to the plug-in as copies."],
    ],
  },
  {
    title: "Changing the drawing (openvwx.edit)",
    blocks: [
      ["list", [
        "edit.<method>(...args) for: addObject, deleteObjects, moveObjects, duplicateObjects, setGeometry, setText, setTextStyle, setObjectClass, setObjectName, setObjectLayer, setAttributes, transformObjects, arrangeObjects, groupObjects, ungroupObjects, createLayer, renameLayer, setLayerVisibility, createClass, renameClass, setClassVisibility, insertSymbol, replaceSymbol, setRecordField",
        "edit.batch([[method, ...args], ...]) applies several as one undo step; if one fails, none applies",
      ]],
      ["code", 'await openvwx.edit.batch([\n  ["addObject", layerId, { kind: "line", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }],\n  ["renameLayer", layerId, "Plan"],\n]);'],
    ],
  },
  {
    title: "Selection, zoom and layers",
    blocks: [
      ["list", [
        "select(ids): selects objects on the active layer; returns those selected",
        "zoomTo(ids): fits the window to them",
        "activeLayer(), setActiveLayer(id)",
      ]],
    ],
  },
  {
    title: "Dialogs and progress (openvwx.ui)",
    blocks: [
      ["list", [
        "toast(text)",
        "alert(title, text)",
        "prompt(title, fields): fields are { name, label, type: text | number | select | checkbox, options, value }; resolves to their values by name, or null",
        "progress(fraction, label), and progress(null) to hide it",
      ]],
    ],
  },
  {
    title: "Web requests (openvwx.fetch)",
    blocks: [
      ["p", "fetch(url, init) sends an http or https request from the page, on the plug-in's behalf, with no cookies. The first request to each site asks Allow {plug-in} to reach {site}?; the answer is remembered for that plug-in."],
      ["p", "It resolves to { ok, status, statusText, url, headers, text, bytes }. Other network calls (fetch itself, XMLHttpRequest, WebSocket, EventSource) throw in a plug-in."],
    ],
  },
  {
    title: "Console and errors",
    blocks: [
      ["p", "console.log, warn and error go to the console pane of the editor (or the page's console for a plug-in that runs in the background). Errors show their line in the plug-in's code, and a click on it goes there."],
      ["p", "Arguments and results cross as data: no functions, and values that cannot be copied are an error."],
    ],
  },
  {
    title: "Script Console",
    blocks: [
      ["p", "Window > Script Console… evaluates a line with the same API: a line that is an expression gives its value; anything else runs as the body of an async function. Up and down arrows walk the history. Restart forgets the variables."],
    ],
  },
];

function block(b: Block): Node {
  const [kind, text] = b;
  if (kind === "h") return h("h3", { cls: "pi-help-h", text: text as string });
  if (kind === "p") return h("p", { cls: "pi-help-p", text: text as string });
  if (kind === "code") return h("pre", { cls: "pi-help-code", text: text as string });
  return h("ul", { cls: "pi-help-list" }, ...(text as readonly string[]).map((t) => h("li", { text: t })));
}

/** Help > Plug-in API…: the API on one scrolling pane. */
export async function openHelp(): Promise<void> {
  const body: Node[] = [];
  for (const section of SECTIONS) {
    body.push(h("h3", { cls: "pi-help-h", text: section.title }));
    for (const b of section.blocks) body.push(block(b));
  }
  await showDialog<true>({
    title: "Plug-in API",
    okLabel: "Close",
    cls: "pi-help-dialog",
    body,
    check: () => ({ value: true }),
  });
}

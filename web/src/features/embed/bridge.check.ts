// Checks the embed's messages and layer lookups in node (bridge.ts), and that the web component
// (public/embed.js) and the address contract (options.ts) build the same viewer addresses. Run from web/:
//
//   npx tsx src/features/embed/bridge.check.ts
//
// Prints how many checks passed, or the first failure and exits non-zero.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { type LayerLike, findLayer, layerChoices, outgoing, parseHostMessage } from "./bridge.ts";
import { DEFAULT_OPTIONS, type EmbedOptions, type EmbedSource, embedUrl } from "./options.ts";

const origin = "https://rodeo.build";
let passed = 0;

function same(actual: unknown, expected: unknown): void {
  assert.deepStrictEqual(actual, expected);
  passed += 1;
}

// the web component, loaded the way element.check.ts loads it
const source = readFileSync(new URL("../../../public/embed.js", import.meta.url), "utf8");
type Attrs = Record<string, string | null | undefined>;
interface RodeoEmbedApi {
  viewerUrl(origin: string, attrs: Attrs): string | null;
}
const defined: string[] = [];
const sandbox: Record<string, unknown> = {
  document: { currentScript: { src: "https://rodeo.build/embed.js" } },
  customElements: { get: () => undefined, define: (name: string) => void defined.push(name) },
  HTMLElement: class {},
  URL,
};
sandbox.window = sandbox;
runInNewContext(source, sandbox);
const embedJs = sandbox.RodeoEmbed as RodeoEmbedApi;

// the first five rows of the element check's table: the codes' addresses must match embedUrl's
const rows: [Attrs, EmbedSource, EmbedOptions, string][] = [
  [{ share: "abc_DEF-123" }, { token: "abc_DEF-123" }, DEFAULT_OPTIONS, "https://rodeo.build/?embed=abc_DEF-123"],
  [
    { share: "tok", view: "3d", rotate: "", theme: "dark" },
    { token: "tok" },
    { ...DEFAULT_OPTIONS, view: "3d", rotate: true, theme: "dark" },
    "https://rodeo.build/?embed=tok&view=3d&rotate=1&theme=dark",
  ],
  [
    { share: "tok", cam: "1000,-2000,1500,0,0,0", ui: "min" },
    { token: "tok" },
    { ...DEFAULT_OPTIONS, cam: { position: [1000, -2000, 1500], target: [0, 0, 0] }, ui: "min" },
    "https://rodeo.build/?embed=tok&cam=1000,-2000,1500,0,0,0&ui=min",
  ],
  [
    { share: "tok", layer: "Ground Floor" },
    { token: "tok" },
    { ...DEFAULT_OPTIONS, layer: "Ground Floor" },
    "https://rodeo.build/?embed=tok&layer=Ground%20Floor",
  ],
  [
    { src: "https://raw.githubusercontent.com/a/b/main/house.vwx", view: "3d" },
    { url: "https://raw.githubusercontent.com/a/b/main/house.vwx" },
    { ...DEFAULT_OPTIONS, view: "3d" },
    "https://rodeo.build/?embed&url=https%3A%2F%2Fraw.githubusercontent.com%2Fa%2Fb%2Fmain%2Fhouse.vwx&view=3d",
  ],
];
for (const [attrs, src, options, expected] of rows) {
  same(embedJs.viewerUrl(origin, attrs), expected);
  same(embedUrl(origin, src, options), expected);
}

// host messages: good ones are read, anything else is null
same(parseHostMessage({ rodeo: 1, type: "setView", view: "3d", preset: "leftiso" }), { type: "setView", view: "3d", preset: "leftIso" });
same(parseHostMessage({ rodeo: 1, type: "setView", view: "2d" }), { type: "setView", view: "2d", preset: null });
same(parseHostMessage({ rodeo: 1, type: "setView", view: "3d", preset: "sideways" }), { type: "setView", view: "3d", preset: null });
same(parseHostMessage({ rodeo: 1, type: "fit" }), { type: "fit" });
same(parseHostMessage({ rodeo: 1, type: "rotate", on: true }), { type: "rotate", on: true });
same(parseHostMessage({ rodeo: 1, type: "layer", layer: "  A-101  " }), { type: "layer", layer: "A-101" });
same(parseHostMessage({ rodeo: 1, type: "layer", layer: "x".repeat(300) }), { type: "layer", layer: "x".repeat(200) });
same(parseHostMessage({ rodeo: 1, type: "layer", layer: "   " }), null);
same(parseHostMessage({ type: "fit" }), null);
same(parseHostMessage({ rodeo: 2, type: "fit" }), null);
same(parseHostMessage({ rodeo: 1, type: "setView", view: "4d" }), null);
same(parseHostMessage({ rodeo: 1, type: "rotate", on: "yes" }), null);
same(parseHostMessage({ rodeo: 1, type: "layer", layer: 7 }), null);
same(parseHostMessage({ rodeo: 1, type: "navigate", url: "https://example.org" }), null);
same(parseHostMessage("fit"), null);
same(parseHostMessage(null), null);
same(parseHostMessage(undefined), null);

// what the viewer sends carries rodeo: 1 and nothing else changes
same(outgoing({ type: "view", view: "3d" }), { type: "view", view: "3d", rodeo: 1 });
same(outgoing({ type: "error", message: "No" }), { type: "error", message: "No", rodeo: 1 });

// layer lookups: id, then a design layer's name, a sheet's number, then a sheet's title
const layers: LayerLike[] = [
  { id: "d1", name: "Ground Floor", title: "", kind: "design", visibility: "visible" },
  { id: "d2", name: "Roof", title: "", kind: "design", visibility: "hidden" },
  { id: "s1", name: "A-101", title: "Ground Floor", kind: "sheet", visibility: "visible" },
  { id: "s2", name: "A-102", title: "Roof Plan", kind: "sheet", visibility: "visible" },
  { id: "s3", name: "A-103", title: "", kind: "sheet", visibility: "visible" },
];
same(findLayer(layers, "d2")?.id, "d2");
same(findLayer(layers, "ground floor")?.id, "d1");
same(findLayer(layers, "a-101")?.id, "s1");
same(findLayer(layers, "A-103")?.id, "s3");
same(findLayer(layers, "roof plan")?.id, "s2");
same(findLayer(layers, "nope"), null);
same(findLayer(layers, "   "), null);

// the picker: visible design layers, then every sheet, with a sheet's number and title
same(layerChoices(layers), [
  { id: "d1", label: "Ground Floor" },
  { id: "s1", label: "A-101 Ground Floor" },
  { id: "s2", label: "A-102 Roof Plan" },
  { id: "s3", label: "A-103" },
]);

console.log(`bridge check: ${passed} passed`);

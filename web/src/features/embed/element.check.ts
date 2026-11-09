// Node check of public/embed.js: runs it the way a page does, in a sandbox that has only what
// it may touch at load, then checks the viewer addresses it builds and that it defines
// <rodeo-viewer> once. Run from web/: npx tsx src/features/embed/element.check.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../../public/embed.js", import.meta.url), "utf8");

type Attrs = Record<string, string | null | undefined>;

interface RodeoEmbedApi {
  readonly version: number;
  viewerUrl(origin: string, attrs: Attrs): string | null;
  posterUrl(origin: string, token: string): string;
}

/** Runs embed.js in a fresh sandbox; `existing` is what customElements.get reports for the element. */
function load(existing: unknown): { defined: string[]; api: RodeoEmbedApi } {
  const defined: string[] = [];
  const sandbox: Record<string, unknown> = {
    document: { currentScript: { src: "https://rodeo.build/embed.js" } },
    customElements: { get: () => existing, define: (name: string) => void defined.push(name) },
    HTMLElement: class {},
    URL,
  };
  sandbox.window = sandbox;
  runInNewContext(source, sandbox);
  return { defined, api: sandbox.RodeoEmbed as RodeoEmbedApi };
}

let passed = 0;
function same(actual: unknown, expected: unknown): void {
  assert.deepStrictEqual(actual, expected);
  passed += 1;
}

const { defined, api } = load(undefined);
same(defined, ["rodeo-viewer"]);
same(api.version, 1);
same(load({}).defined, []); // a page that already has the element keeps it
same(api.posterUrl("https://rodeo.build", "tok"), "https://rodeo.build/api/s/tok/poster");

const origin = "https://rodeo.build";
const cases: [Attrs, string | null][] = [
  [{ share: "abc_DEF-123" }, "https://rodeo.build/?embed=abc_DEF-123"],
  [{ share: "tok", view: "3d", rotate: "", theme: "dark" }, "https://rodeo.build/?embed=tok&view=3d&rotate=1&theme=dark"],
  [{ share: "tok", cam: "1000,-2000,1500,0,0,0", ui: "min" }, "https://rodeo.build/?embed=tok&cam=1000,-2000,1500,0,0,0&ui=min"],
  [{ share: "tok", layer: "Ground Floor" }, "https://rodeo.build/?embed=tok&layer=Ground%20Floor"],
  [
    { src: "https://raw.githubusercontent.com/a/b/main/house.vwx", view: "3d" },
    "https://rodeo.build/?embed&url=https%3A%2F%2Fraw.githubusercontent.com%2Fa%2Fb%2Fmain%2Fhouse.vwx&view=3d",
  ],
  [{ share: "https://example.org/?share=tok2" }, "https://example.org/?embed=tok2"],
  [{ share: "tok", rotate: "false" }, "https://rodeo.build/?embed=tok"],
  [{}, null],
  // more: a zero turns rotate off, options come out in the contract's order, an empty token or an unreadable address shows nothing
  [{ share: "tok", rotate: "0" }, "https://rodeo.build/?embed=tok"],
  [{ share: "tok", at: "100,200,50" }, "https://rodeo.build/?embed=tok&at=100,200,50"],
  [{ share: "tok", render: "wireframe", preset: "top" }, "https://rodeo.build/?embed=tok&preset=top&render=wireframe"],
  [{ share: "tok", theme: "" }, "https://rodeo.build/?embed=tok"],
  [{ share: "https://example.org/?embed" }, null],
  [{ share: "://bad" }, null],
  [{ share: "", src: "https://a.example/x.vwx" }, "https://rodeo.build/?embed&url=https%3A%2F%2Fa.example%2Fx.vwx"],
];
for (const [attrs, expected] of cases) same(api.viewerUrl(origin, attrs), expected);

console.log(`element check: ${passed} passed`);

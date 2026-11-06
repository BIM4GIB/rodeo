// Why a menu row is off: the reasons rows give while they don't apply, which menu.ts shows under the row
// (on hover, focus or a tap) and as its tooltip. Each names the one step that makes the row work, so most
// rows need one word, `why: need.selection`; a row with a step of its own says it with whyIn("…"), and one
// that needs several things in turn with whyNot([test, "…"], …). A row that is off only while no drawing is
// open needs nothing: menubar.ts gives rows without a reason of their own NO_DRAWING then (setFallbackWhy).

import { store } from "./state.ts";

/** The reason an off row gives while no drawing is open. */
export const NO_DRAWING = "Open or start a drawing first";

/** The steps many rows need, as their reasons say them. */
export const STEP = {
  selection: "Select one or more objects first",
  one: "Select one object first",
  twoOrMore: "Select two or more objects first",
  threeOrMore: "Select three or more objects first",
  closed: "Select a closed shape first",
  twoClosed: "Select two or more closed shapes first",
  polyline: "Select a polygon or polyline first",
  threeDObjects: "Select 3D objects first",
  text: "Select text first",
  threeD: "Show the 3D view first: View › 3D View",
  plan: "Show the 2D plan first: View › Standard Views › Top/Plan",
  sheet: "Add a sheet layer first: Tools › Organization…",
  sheetActive: "Make a sheet layer active first",
  designLayer: "Make a design layer active first",
  cloud: "Save to the cloud first: File › Save to Cloud…",
  recordFormat: "Make a record format first: Tools › Records › New Record Format…",
  worksheet: "Make a worksheet first: Tools › Reports › Create Report…",
  siteModel: "Make a site model first: AEC › Terrain › Site Model from Source Data…",
} as const;

/** `text` as an off row's reason, or NO_DRAWING while no drawing is open. */
export function whyIn(text: string): () => string {
  return () => (store.session ? text : NO_DRAWING);
}

/**
 * An off row's reason from what it needs, in order, each a test and what to do when it fails: NO_DRAWING
 * while no drawing is open, else the text of the first test that fails, else null.
 */
export function whyNot(...steps: readonly (readonly [() => boolean, string])[]): () => string | null {
  return () => {
    if (!store.session) return NO_DRAWING;
    for (const [ok, text] of steps) if (!ok()) return text;
    return null;
  };
}

/** The reasons many rows give, one word each: `why: need.selection`. */
export const need = {
  selection: whyIn(STEP.selection),
  one: whyIn(STEP.one),
  twoOrMore: whyIn(STEP.twoOrMore),
  threeOrMore: whyIn(STEP.threeOrMore),
  closed: whyIn(STEP.closed),
  twoClosed: whyIn(STEP.twoClosed),
  polyline: whyIn(STEP.polyline),
  threeDObjects: whyIn(STEP.threeDObjects),
  text: whyIn(STEP.text),
  threeD: whyIn(STEP.threeD),
  plan: whyIn(STEP.plan),
  sheet: whyIn(STEP.sheet),
  sheetActive: whyIn(STEP.sheetActive),
  designLayer: whyIn(STEP.designLayer),
  cloud: whyIn(STEP.cloud),
  recordFormat: whyIn(STEP.recordFormat),
  worksheet: whyIn(STEP.worksheet),
  siteModel: whyIn(STEP.siteModel),
} as const;

// Stage > Venue > Lighting Section…: draws the venue's centre-line section from the drawing's data (section.ts)
// and shows what it flags: a beam cut off by a border, an instrument the front row can see. Place on Drawing
// then takes one click where the section's origin (the plaster line on the stage floor) goes, and adds the
// section as one group named Lighting Section at CL, its lines and labels in the active class.

import { h } from "../../../app/dom.ts";
import { placeAtNextClick } from "../../../app/placeAt.ts";
import { addPieces } from "../../../app/tools/detailing.ts";
import { markerParts } from "../../../app/tools/markers.ts";
import { toast } from "../../../app/toast.ts";
import type { Pt } from "../../../core/index.ts";
import { fixtures } from "../instrument.ts";
import { readShow } from "../show.ts";
import { AUDIENCE_KEY, LINESETS_KEY, VENUE_KEY, type Audience, type Lineset, type VenueInfo } from "../showTypes.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { noteLine, openPanel, type OpenPanel } from "../ui.ts";
import { lightingSection, type SectionResult } from "./section.ts";
import { activeScale, LABEL_PAPER_MM } from "./venueDraw.ts";
import type { Sketch } from "./venueShapes.ts";

let flagsPanel: OpenPanel | null = null;

/** The section as the drawing has it now, or why there isn't one. */
function sectionNow(): SectionResult | string {
  const venue = readShow<VenueInfo | null>(VENUE_KEY, null);
  if (!venue) return "Draw a venue first (Stage > Venue > New Venue…): the section needs its stage, grid and seats.";
  const scale = activeScale();
  if (scale === null) return "Make a design layer active to draw the section.";
  return lightingSection({
    venue,
    audience: readShow<Audience>(AUDIENCE_KEY, { blocks: [] }),
    linesets: readShow<Lineset[]>(LINESETS_KEY, []),
    fixtures: fixtures(),
    frame: stageFrame(),
    labelMm: LABEL_PAPER_MM * scale,
    scale,
    format: lengthText,
  });
}

/** The section's sketch with its origin moved to `at` on the drawing. */
function movedTo(d: Sketch<Pt>, at: Pt): Sketch<Pt> {
  const m = (q: Pt): Pt => ({ x: at.x + q.x, y: at.y + q.y });
  return {
    outlines: d.outlines.map((o) => o.map(m)),
    lines: d.lines.map((l) => l.map(m)),
    circles: d.circles.map((c) => ({ center: m(c.center), radius: c.radius })),
    filled: d.filled.map((f) => f.map(m)),
    texts: d.texts.map((t) => ({ ...t, at: m(t.at) })),
  };
}

/** Adds the section at `at` as one named group. */
function drawAt(at: Pt): void {
  const now = sectionNow();
  if (typeof now === "string") {
    toast(now, "info");
    return;
  }
  addPieces("Lighting Section", [markerParts(movedTo(now.sketch, at))], "Lighting Section at CL");
}

/** Asks for the click that puts the section down. */
function place(): void {
  const now = sectionNow();
  if (typeof now === "string") {
    toast(now, "info");
    return;
  }
  if (!placeAtNextClick({ what: "Lighting section", place: drawAt })) toast("The editor isn't running.", "info");
  // out of the way of the click
  else flagsPanel?.close();
}

/** The flags as the window lists them: each in amber, or a line saying none were found. */
function flagLines(r: SectionResult): HTMLElement[] {
  const lines: HTMLElement[] = [];
  if (r.flags.length === 0) lines.push(h("p", { cls: "th-note", text: "No flags: no beam is cut off by a border and no instrument is seen from the front row." }));
  for (const f of r.flags) lines.push(noteLine(f, "th-warn"));
  if (r.unfocused > 0) lines.push(noteLine(`${r.unfocused} ${r.unfocused === 1 ? "instrument has" : "instruments have"} no focus, so no beam is drawn for ${r.unfocused === 1 ? "it" : "them"}.`));
  lines.push(noteLine("Beams are drawn to the floor from each focused instrument's lens. Sightlines run from the front and last rows past the proscenium top; balconies aren't on the drawing, so none are drawn."));
  return lines;
}

/** Stage > Venue > Lighting Section…: shows the flags, with Place on Drawing to put the section down. */
export function openLightingSection(): void {
  const now = sectionNow();
  if (typeof now === "string") {
    toast(now, "info");
    return;
  }
  flagsPanel?.close();
  flagsPanel = openPanel({
    key: "venue.section",
    title: "Lighting Section",
    body: h("div", { cls: "venue-section-body" }, ...flagLines(now)),
    actions: [{ label: "Place on Drawing", run: place, primary: true }],
    width: 560,
    height: 380,
    onClose: () => {
      flagsPanel = null;
    },
  });
}

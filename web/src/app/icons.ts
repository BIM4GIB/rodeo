// Inline SVG icons (static markup, stroke = currentColor).

import type { Visibility } from "../core/index.ts";
import type { ToolId } from "./state.ts";

function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const TOOL_ICON: Record<ToolId, string> = {
  select: svg('<path d="M6 4l11 6.5-5 1.3 2.6 5.7-2.2 1-2.6-5.6L6 18z"/>'),
  // reshape: a triangle with one vertex grip pulled out
  reshape: svg('<path d="M4 19L9 5l10 9z"/><rect x="17" y="12" width="4" height="4" fill="currentColor" stroke="none"/>'),
  pan: svg('<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  line: svg('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="0.5"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/>'),
  polygon: svg('<path d="M12 3.5l7.5 5.2-2.9 9H7.4l-2.9-9z"/>'),
  // triangle: a triangle with its first side marked
  triangle: svg('<path d="M4 19L20 19L9 5z"/><circle cx="4" cy="19" r="1.2" fill="currentColor"/><circle cx="20" cy="19" r="1.2" fill="currentColor"/>'),
  polyline: svg('<path d="M3.5 17.5l5-7 4.5 4.5 3.5-6 4 4.5"/>'),
  text: svg('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>'),
  // arc: three-quarter sweep from the spoke at 3 o'clock, centre dot
  arc: svg('<path d="M19 12A7 7 0 1 0 12 19"/><path d="M12 12h7"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>'),
  // quarter arc: a quarter of an ellipse between its two ends
  quarterarc: svg('<path d="M4 19C4 10 10 5 20 5"/><circle cx="4" cy="19" r="1.2" fill="currentColor"/><circle cx="20" cy="5" r="1.2" fill="currentColor"/>'),
  // rotate: a turn of about 240 degrees with an arrowhead at its end
  rotate: svg('<path d="M4.5 12A7.5 7.5 0 1 0 15.75 5.5"/><path d="M17.1 9.3L15.75 5.5L19.7 4.8"/>'),
  // mirror: a shape and its reflection either side of a dashed axis
  mirror: svg('<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5z" fill="currentColor" fill-opacity="0.25"/><path d="M15 7l5 10h-5z"/>'),
  // symbol: a stamp-like square with an insertion cross
  // 2D locus: a cross about a small ring
  locus: svg('<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><circle cx="12" cy="12" r="2"/>'),
  // light: a lamp's ring with its beam opening below, as plan draws a spot
  light: svg('<circle cx="12" cy="7" r="3.5"/><path d="M9.5 9.5L5.5 19h13l-4-9.5"/>'),
  // wall: a wall's two faces in plan, cut square at both ends, with its hatch between
  wall: svg('<path d="M3 8h18v8H3z"/><path d="M7 16l4-8M13 16l4-8"/>'),
  // wall join: two walls' faces meeting at a corner, the mitre across it
  walljoin: svg('<path d="M4 20V4h16v5H9v11z"/><path d="M4 4l5 5"/>'),
  // door: a wall broken by an opening, the leaf standing open from its hinge and its swing to the far jamb
  door: svg('<path d="M2 13h5v4H2M22 13h-5v4h5"/><path d="M7 13V3M7 3a10 10 0 0110 10"/>'),
  // window: a wall broken by an opening, the glazing's two lines across it
  window: svg('<path d="M2 9h5v6H2M22 9h-5v6h5"/><path d="M7 11h10M7 13h10"/>'),
  // slab: a slab seen from above at an angle, its top face and its edge
  slab: svg('<path d="M3 11l7-5h11l-7 5z"/><path d="M3 11v3h11l7-5V6M14 11v3"/>'),
  // plug-in insertion: a part with a parameter handle, set down at an insertion cross
  plugin: svg('<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M12 7h5M12 11h3"/><path d="M5 15v6M2 18h6"/>'),
  // camera: a camera body with its lens, looking right
  camera: svg('<rect x="3" y="7" width="12" height="10" rx="1.5"/><path d="M15 10.5l6-3v9l-6-3"/>'),
  // flyover: a box with an arrow sweeping round it
  flyover: svg('<path d="M9 10l3-1.5 3 1.5v4l-3 1.5-3-1.5z"/><path d="M12 8.5V5"/><path d="M4 13a8.5 4 0 0 0 16 0"/><path d="M18.2 10.6L20 13l-2.9.6"/>'),
  // translate view: a frame slid along by an arrow
  translateview: svg('<rect x="3" y="6" width="12" height="10" rx="1"/><path d="M11 19h10M18 16l3 3-3 3"/>'),
  // walkthrough: two footprints, one ahead of the other
  walkthrough: svg('<ellipse cx="8.5" cy="14" rx="2.5" ry="4"/><ellipse cx="15.5" cy="8" rx="2.5" ry="4"/><path d="M7.5 20h2M14.5 14h2"/>'),
  // heliodon: the sun over the horizon, its rays
  heliodon: svg('<path d="M3 18h18M7.5 18a4.5 4.5 0 019 0"/><path d="M12 8.5V6M5.6 11.6L7.4 13M18.4 11.6L16.6 13M3.5 14.5h1.5M19 14.5h1.5"/>'),
  symbol: svg('<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M12 9v6M9 12h6"/>'),
  // eyedropper: pipette
  eyedropper: svg('<path d="M14.5 5.5l4 4M13 7l4 4-8.5 8.5H4.5v-4z"/><path d="M15.5 4.5a2 2 0 013 3l-1 1-3-3z"/>'),
  // attrmap: a hatched cell skewed off its origin square
  attrmap: svg('<path d="M7 18l3-11h10l-3 11z"/><path d="M10.5 15l5-5M13.5 15l3.5-3.5" stroke-dasharray="1.5 1.5"/><rect x="4" y="16" width="4" height="4" fill="currentColor" stroke="none"/>'),
  // measure: tape with ticks
  measure: svg('<path d="M3 15l12-12 6 6-12 12z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/>'),
  // protractor: a half disc with a needle
  protractor: svg('<path d="M3 17a9 9 0 0118 0z"/><path d="M12 17l5-6"/>'),
  // dividing lines (Drafting Aids): two lines from a point with three between them
  dividing: svg('<path d="M4 20L20 20M4 20L12 4" stroke-width="2"/><path d="M4 20l15-6M4 20l12-11M4 20l7-14" stroke-dasharray="2 2"/>'),
  // leader lines (Align/Distribute Leader Lines): three leaders, their shoulders on a slanted line
  alignleaders: svg('<path d="M4 6l5 0 0 0M4 12l6 0M4 18l7 0" stroke-width="2"/><path d="M9 6l8-3M10 12l8-2M11 18l8-1"/><path d="M8 21l4-19" stroke-dasharray="2 2"/>'),
  // place (a command's click on the drawing): crosshairs beside lines of text
  rotate3dcentre: svg('<path d="M4.5 12A7.5 7.5 0 1 0 15.75 5.5"/><path d="M17.1 9.3L15.75 5.5L19.7 4.8"/>'),
  placeat: svg('<path d="M9 5h11M9 9h11M9 13h7"/><path d="M5 15v6M2 18h6"/>'),
  // add dimensions (a chain dimension's Add Dimension(s)): a chain's line with a new witness line dashed past its end
  adddims: svg('<path d="M3 8h12M3 5v8M9 5v8M15 5v8"/><path d="M15 8h6M21 5v14" stroke-dasharray="2 2"/>'),
  // rotate plan: a level line and the drawing's line turning onto it
  rotateplan: svg('<path d="M3 19h18" stroke-dasharray="2 2"/><path d="M4 19L17 5"/><path d="M13.5 9.5a8 8 0 012 9.5"/><path d="M13.2 17.2l2.3 1.8 1.8-2.3"/>'),
  // hatch (Modify > Hatch…): a square filled with diagonal lines
  hatch: svg('<rect x="4" y="4" width="16" height="16"/><path d="M4 12l8-8M4 20L20 4M12 20l8-8"/>'),
  // Cut 2D Section (Model menu): a box cut by a dashed line, an arrow to the side kept
  section2d: svg('<rect x="5" y="7" width="14" height="12"/><path d="M3 13h18" stroke-dasharray="2 2"/><path d="M12 13V4M9.5 6.5L12 4l2.5 2.5"/>'),
  // visibility: an eye struck through
  visibility: svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/><path d="M4 20L20 4"/>'),
  // selectsimilar: an arrow over two like squares
  selectsimilar: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1" opacity="0.45"/><path d="M14 14l6.5 2.5-2.8 1.2-1.2 2.8z"/>'),
  // offset: a line and its parallel copy
  offset: svg('<path d="M4 16L16 4"/><path d="M8 20L20 8" stroke-dasharray="2 2"/>'),
  // fillet: corner rounded by an arc
  fillet: svg('<path d="M5 4v8a7 7 0 007 7h8"/>'),
  // trim: crossing lines with the cut-away end dashed
  trim: svg('<path d="M4 12h8"/><path d="M12 12h8" stroke-dasharray="2 2"/><path d="M12 4v16"/>'),
  // clip: a shape with a dashed rectangle cut out of its corner
  clip: svg('<path d="M4 4h10v6h6v10H4z"/><path d="M14 4h6v6" stroke-dasharray="2 2"/>'),
  // shear: a square skewed into a parallelogram (dashed) from its fixed corner
  shear: svg('<rect x="4" y="8" width="11" height="11" stroke-dasharray="2 2"/><path d="M4 19l5-11h11l-5 11z"/>'),
  // fpresize (Fixed Point Resize): a small square stretched from its fixed corner into a larger one
  fpresize: svg('<rect x="4" y="12" width="8" height="8"/><path d="M4 20V4h16v16H4" stroke-dasharray="2 2"/><path d="M12 12l6-6M14 6h4v4"/>'),
  // split: a line broken in two with a gap
  split: svg('<path d="M4 20l6-6"/><path d="M14 10l6-6"/><path d="M8 8l8 8" stroke-dasharray="2 2"/>'),
  // connect: a line extended (dashed) to meet a wall
  connect: svg('<path d="M4 18L11 11"/><path d="M11 11l5-5" stroke-dasharray="2 2"/><path d="M14 3l7 7"/>'),
  // dimension: witness lines with a dimension line and ticks
  dimension: svg('<path d="M4 6v12M20 6v12"/><path d="M4 10h16"/><path d="M3 11l2-2M19 11l2-2"/>'),
  // arc length: an arc dimensioned by a wider arc, witness lines out to it
  // slope dimension: a slope with a rise-over-run triangle on it
  slopedim: svg('<path d="M3 20L21 6"/><path d="M9 15.3V9.5h7.5"/>'),
  arclength: svg('<path d="M6 20a8 8 0 0 1 12 0"/><path d="M3 13a12 12 0 0 1 18 0"/><path d="M6 20l-2-6M18 20l2-6"/>'),
  // callout: a leader with an arrowhead running up to a boxed note
  callout: svg('<path d="M4 20l7-7h3"/><path d="M4 20l1-3.2 2.2 2.2z"/><rect x="14" y="9" width="7" height="8" rx="1"/>'),
  // leader line simple: a shoulder and a leader down to an arrowhead
  leadersimple: svg('<path d="M3 6h7l8.5 11"/><path d="M20 19l-4.2-1.2 2.6-2z" fill="currentColor"/>'),
  // leader line: a note's line over the shoulder, the leader on down to an arrowhead
  leaderline: svg('<path d="M21 10h-8l-7.5 8.5"/><path d="M4 20.5l1-4.2 2.4 2.1z" fill="currentColor"/><path d="M14 6h7"/>'),
  // two links of a chain, linked through each other
  hyperlink: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>'),
  // revision cloud: a ring of scallops
  cloud: svg('<path d="M6 9a2.5 2.5 0 014.5-2 2.5 2.5 0 014.5 0 2.5 2.5 0 014 3 2.5 2.5 0 01-1 4.5 2.5 2.5 0 01-4 2.5 2.5 2.5 0 01-4.5 0 2.5 2.5 0 01-4-3 2.5 2.5 0 01.5-5z"/>'),
  // break line: a line broken by a zigzag
  breakline: svg('<path d="M3 12h6l1.5-5 3 10 1.5-5h6"/>'),
  // insulation: batt loops between two faces
  insulation: svg('<path d="M3 5h18M3 19h18"/><path d="M4 17c0-6 4-10 4-6s-4 6-2 6 4-12 6-10-4 10-2 10 4-12 6-10-4 10-2 10 4-6 4-6"/>'),
  // repetitive unit: two courses of bricks, stretcher bonded
  repunit: svg('<rect x="3" y="6" width="18" height="12"/><path d="M3 12h18M9 6v6M15 6v6M6 12v6M12 12v6M18 12v6"/>'),
  // steel section: a wide flange
  steel: svg('<path d="M6 4h12v3h-4.5v10H18v3H6v-3h4.5V7H6z"/>'),
  // a wide flange section standing up
  steel3d: svg('<path d="M4 8h9v2H9.5v6H13v2H4v-2h3.5v-6H4z"/><path d="M4 8l5-4h9l-5 4M13 8l5-4v2l-5 4M18 6v0M9.5 10l5-4M13 16l5-4v2l-5 4"/>'),
  // lumber: a section crossed corner to corner
  lumber: svg('<rect x="7" y="3" width="10" height="18"/><path d="M7 3l10 18M17 3L7 21"/>'),
  // linear material: a board along a bent path, split into plies
  linearmaterial: svg('<path d="M2 17h10l9-8M2 13h9l8-7"/><path d="M2 15h9.5l8.5-7.5" stroke-width="1"/><path d="M2 13v4M21 9l-2-3"/>'),
  // framing member: a joist in plan, its centre line dashed down its middle
  framing: svg('<path d="M3 9.5l18-3v6l-18 3z"/><path d="M3 12.5l18-3" stroke-dasharray="2 2"/>'),
  bulbflat: svg('<path d="M9 21h3V9.5l5-2.5V3.5Q17 3 16 3H9z"/>'),
  shaftbreak: svg('<path d="M4 6h8M4 18h8"/><path d="M12 6q3 0 3 4t-3 2"/><path d="M12 12q-2.5 3 0 6M12 12q2.5 3 0 6"/>'),
  shaftbreak2: svg('<path d="M2 6h5M2 18h5M17 6h5M17 18h5"/><path d="M7 6q2.5 0 2.5 3.5T7 12q-2 3 0 6M7 12q2 3 0 6"/><path d="M17 18q-2.5 0-2.5-3.5T17 12q2-3 0-6M17 12q-2-3 0-6"/>'),
  // section-elevation marker: a section line with a bubble at its end, its arrow looking up
  secmarker: svg('<path d="M3 15h9"/><circle cx="16" cy="15" r="4"/><path d="M12 15h8"/><path d="M13.2 12.2L16 6l2.8 6.2z" fill="currentColor"/>'),
  // section-elevation line: a broken cut line with a bubble and its arrow at each end
  secline: svg('<path d="M6 17l5-6h7"/><circle cx="4.5" cy="18.5" r="2.5"/><circle cx="20.5" cy="11" r="2.5"/><path d="M2.6 16.8L4.5 13l1.9 3.8z" fill="currentColor"/><path d="M18.6 9.3l1.9-3.8 1.9 3.8z" fill="currentColor"/>'),
  // interior elevation marker: a circle with an arrow each way
  intelev: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3l2.4 6h-4.8zM21 12l-6 2.4v-4.8zM12 21l-2.4-6h4.8zM3 12l6-2.4v4.8z" fill="currentColor"/>'),
  // detail callout: a detail circled, a leader on to its bubble
  detailcallout: svg('<circle cx="9" cy="9" r="6"/><path d="M13.2 13.2l2.6 2.6"/><circle cx="18" cy="18" r="3"/><path d="M15 18h6"/>'),
  // drawing label: a bubble with the title on a line beside it
  drawlabel: svg('<circle cx="6" cy="12" r="4"/><path d="M2 12h8M10 12h12"/><path d="M12 9h7M12 15h4"/>'),
  refmarker: svg('<circle cx="16" cy="9" r="5"/><path d="M11 9h10"/><path d="M11 9H8L3 19"/><path d="M3 19l.6-3.4 2 1.1z"/>'),
  gridline: svg('<circle cx="12" cy="5" r="3.5"/><path d="M12 8.5V22"/><path d="M5 12h14M5 18h14" stroke-dasharray="2 2"/>'),
  redline: svg('<path d="M5 8a3 3 0 0 1 4-3 3 3 0 0 1 5 0 3 3 0 0 1 4 3 3 3 0 0 1 0 5 3 3 0 0 1-4 3 3 3 0 0 1-5 0 3 3 0 0 1-4-3 3 3 0 0 1 0-5z"/><path d="M18 16l3 4h-6"/>'),
  generalnotes: svg('<path d="M4 4h10"/><path d="M4 9h1M8 9h12M8 13h9M4 17h1M8 17h12M8 21h7"/>'),
  // title block border: a sheet's frame with its title block in the corner
  tbborder: svg('<rect x="3" y="5" width="18" height="14"/><path d="M12 19v-5h9M12 16.5h9"/>'),
  // elevation benchmark: a quartered circle, two quarters filled, and a leader
  benchmark: svg('<circle cx="7" cy="12" r="4"/><path d="M7 12V8a4 4 0 014 4zM7 12v4a4 4 0 01-4-4z" fill="currentColor"/><path d="M3 12h18M7 8v8"/><path d="M13 9h7"/>'),
  // north arrow: a circle with a needle, its right half filled
  northarrow: svg('<circle cx="12" cy="13" r="7"/><path d="M12 7l2 6-2 6-2-6z"/><path d="M12 7l2 6h-4z" fill="currentColor"/><path d="M10.5 4.5V1.5l3 3V1.5" stroke-width="1"/>'),
  // scale bar: segments alternately filled, with ticks
  scalebar: svg('<path d="M3 12h18v4H3z"/><path d="M3 12h4.5v4H3zM12 12h4.5v4H12z" fill="currentColor"/><path d="M3 9v-2M12 9V7M21 9V7"/>'),
  // data tag: a leader from a point to a box with a line of text
  datatag: svg('<circle cx="5" cy="18" r="1.5" fill="currentColor"/><path d="M6 17l5-5"/><rect x="11" y="6" width="10" height="7" rx="1"/><path d="M13.5 9.5h5"/>'),
  // graphic legend: swatches with names beside them
  legend: svg('<rect x="3" y="4" width="5" height="4"/><rect x="3" y="10" width="5" height="4" fill="currentColor"/><rect x="3" y="16" width="5" height="4"/><path d="M11 6h9M11 12h7M11 18h8"/>'),
  // symmetry label: an axis with two short bars across each end
  symmetry: svg('<path d="M12 2v20M8 5h8M8 7.5h8M8 16.5h8M8 19h8"/>'),
  // center mark: a circle crossed through its centre, the lines reaching past it
  centermark: svg('<circle cx="12" cy="12" r="6.5"/><path d="M2 12h20M12 2v20"/>'),
  // spur gear: a toothed wheel round its bore
  spurgear: svg('<path d="M10.5 3h3l.5 2.6 2 .8 2.2-1.5 2.1 2.1-1.5 2.2.8 2 2.6.5v3l-2.6.5-.8 2 1.5 2.2-2.1 2.1-2.2-1.5-2 .8-.5 2.6h-3l-.5-2.6-2-.8-2.2 1.5-2.1-2.1 1.5-2.2-.8-2L3 13.5v-3l2.6-.5.8-2-1.5-2.2 2.1-2.1 2.2 1.5 2-.8z"/><circle cx="12" cy="12" r="3"/>'),
  spurgear3d: svg('<path d="M10.5 3h3l.5 2.6 2 .8 2.2-1.5 2.1 2.1-1.5 2.2.8 2 2.6.5v3l-2.6.5-.8 2 1.5 2.2-2.1 2.1-2.2-1.5-2 .8-.5 2.6h-3l-.5-2.6-2-.8-2.2 1.5-2.1-2.1 1.5-2.2-.8-2L3 13.5v-3l2.6-.5.8-2-1.5-2.2 2.1-2.1 2.2 1.5 2-.8z"/><circle cx="12" cy="12" r="3"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // spur gear rack: a toothed bar
  gearrack: svg('<path d="M2 18h20v-6h-1.5l-1-3h-2l-1 3h-3l-1-3h-2l-1 3h-3l-1-3h-2l-1 3H2z"/>'),
  gearrack3d: svg('<path d="M2 18h20v-6h-1.5l-1-3h-2l-1 3h-3l-1-3h-2l-1 3h-3l-1-3h-2l-1 3H2z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // sprocket: a ring of rounded gaps for rollers round a bore
  sprocket: svg('<path d="M12 2.5a2 2 0 0 0 2 1.9l2.6 1.1a2 2 0 0 0 2.8.1l.9.9a2 2 0 0 0 .1 2.8l1.1 2.6a2 2 0 0 0 0 2.4l-1.1 2.6a2 2 0 0 0-.1 2.8l-.9.9a2 2 0 0 0-2.8.1l-2.6 1.1a2 2 0 0 0-2.4 0l-2.6-1.1a2 2 0 0 0-2.8-.1l-.9-.9a2 2 0 0 0-.1-2.8L3.5 14.4a2 2 0 0 0 0-2.4l1.1-2.6a2 2 0 0 0 .1-2.8l.9-.9a2 2 0 0 0 2.8-.1l2.6-1.1A2 2 0 0 0 12 2.5z"/><circle cx="12" cy="12" r="3"/>'),
  sprocket3d: svg('<path d="M12 2.5a2 2 0 0 0 2 1.9l2.6 1.1a2 2 0 0 0 2.8.1l.9.9a2 2 0 0 0 .1 2.8l1.1 2.6a2 2 0 0 0 0 2.4l-1.1 2.6a2 2 0 0 0-.1 2.8l-.9.9a2 2 0 0 0-2.8.1l-2.6 1.1a2 2 0 0 0-2.4 0l-2.6-1.1a2 2 0 0 0-2.8-.1l-.9-.9a2 2 0 0 0-.1-2.8L3.5 14.4a2 2 0 0 0 0-2.4l1.1-2.6a2 2 0 0 0 .1-2.8l.9-.9a2 2 0 0 0 2.8-.1l2.6-1.1A2 2 0 0 0 12 2.5z"/><circle cx="12" cy="12" r="3"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // linear roller chain: waisted plates over three rollers
  chainlinear: svg('<path d="M5 9c2.3 0 2.5 1 4.5 1h5c2 0 2.2-1 4.5-1a3 3 0 0 1 0 6c-2.3 0-2.5-1-4.5-1h-5c-2 0-2.2 1-4.5 1a3 3 0 0 1 0-6z"/><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  chainlinear3d: svg('<path d="M5 9c2.3 0 2.5 1 4.5 1h5c2 0 2.2-1 4.5-1a3 3 0 0 1 0 6c-2.3 0-2.5-1-4.5-1h-5c-2 0-2.2 1-4.5 1a3 3 0 0 1 0-6z"/><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // ball bearing: rings with balls between them
  ballbearing: svg('<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="5.6" r="1.9"/><circle cx="17.5" cy="15.2" r="1.9"/><circle cx="6.5" cy="15.2" r="1.9"/>'),
  ballbearing3d: svg('<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="5.6" r="1.9"/><circle cx="17.5" cy="15.2" r="1.9"/><circle cx="6.5" cy="15.2" r="1.9"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // roller bearing: cut through, the rings above and below a roller each side of the axis
  rollerbearing: svg('<path d="M3 3h18v3.5H3zM3 17.5h18V21H3zM3 11h18M3 13h18"/><rect x="7" y="6.5" width="10" height="4.5"/><rect x="7" y="13" width="10" height="4.5"/>'),
  rollerbearing3d: svg('<path d="M3 3h18v3.5H3zM3 17.5h18V21H3zM3 11h18M3 13h18"/><rect x="7" y="6.5" width="10" height="4.5"/><rect x="7" y="13" width="10" height="4.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // needle bearing: a thick outer ring over a row of thin needles
  needlebearing: svg('<path d="M3 3h18v6H3zM3 15h18v6H3z"/><path d="M5 10.5h14M5 13.5h14"/>'),
  needlebearing3d: svg('<path d="M3 3h18v6H3zM3 15h18v6H3z"/><path d="M5 10.5h14M5 13.5h14"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // tapered roller bearing: cut through, a tapered roller between sloping raceways
  taperedbearing: svg('<path d="M3 3h18v4l-18 3zM3 21h11v-4.5L3 13z"/><path d="M5 10.5l13-2.5v6l-13 1.5z"/>'),
  taperedbearing3d: svg('<path d="M3 3h18v4l-18 3zM3 21h11v-4.5L3 13z"/><path d="M5 10.5l13-2.5v6l-13 1.5z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // thrust bearing: two washers either side of a ball, cut through
  thrustbearing: svg('<path d="M3 3h5v18H3zM16 3h5v18h-5z"/><circle cx="12" cy="8" r="3"/><circle cx="12" cy="16" r="3"/>'),
  thrustbearing3d: svg('<path d="M3 3h5v18H3zM16 3h5v18h-5z"/><circle cx="12" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // pulley: a wheel with three spokes from its hub to its rim
  pulley: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 9.5V5M9.8 13.3 6 15.5M14.2 13.3 18 15.5"/><circle cx="12" cy="12" r="5.5"/>'),
  pulley3d: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 9.5V5M9.8 13.3 6 15.5M14.2 13.3 18 15.5"/><circle cx="12" cy="12" r="5.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // key: a parallel key's end with chamfered corners
  key: svg('<path d="M7 7h10l2 2v6l-2 2H7l-2-2V9z"/>'),
  key3d: svg('<path d="M7 7h10l2 2v6l-2 2H7l-2-2V9z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // Woodruff key: a half-moon under its flat
  woodruffkey: svg('<path d="M3 9h18a9 9 0 0 1-18 0z"/>'),
  woodruffkey3d: svg('<path d="M3 9h18a9 9 0 0 1-18 0z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // compression springs: coils from the side between their end planes
  compspring1: svg('<path d="M4 4v16M20 4v16M4 18 8 6l2 12 2-12 2 12 2-12 4 12"/>'),
  compspring13d: svg('<path d="M4 4v16M20 4v16M4 18 8 6l2 12 2-12 2 12 2-12 4 12"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  compspring2: svg('<path d="M4 4v16M20 4v16M4 18 7 6l2.5 12L12 6l2.5 12L17 6l3 12"/>'),
  compspring23d: svg('<path d="M4 4v16M20 4v16M4 18 7 6l2.5 12L12 6l2.5 12L17 6l3 12"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // conical spring: coils narrowing to the right
  conicalspring: svg('<path d="M4 3v18M20 8v8M4 20 7 4l3 15 3-13 3 11 2-9 2 8"/>'),
  conicalspring3d: svg('<path d="M4 3v18M20 8v8M4 20 7 4l3 15 3-13 3 11 2-9 2 8"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // die spring: square-wire coils between two lines
  diespring: svg('<path d="M3 5h18M3 19h18M5 5l3 14h2L7 5zM11 5l3 14h2l-3-14z"/>'),
  diespring3d: svg('<path d="M3 5h18M3 19h18M5 5l3 14h2L7 5zM11 5l3 14h2l-3-14z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // extension spring from the side: a loop at each end, close coils between
  extspringfront: svg('<circle cx="3.5" cy="12" r="2.5"/><circle cx="20.5" cy="12" r="2.5"/><path d="M6 12l1.5-5 1.5 10 1.5-10 1.5 10 1.5-10 1.5 10 1.5-10 1.5 5"/>'),
  extspring3d: svg('<circle cx="3.5" cy="12" r="2.5"/><circle cx="20.5" cy="12" r="2.5"/><path d="M6 12l1.5-5 1.5 10 1.5-10 1.5 10 1.5-10 1.5 10 1.5-10 1.5 5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // extension spring from its end: the coils' ring, the near loop across it
  extspringend: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6"/><path d="M10.5 2.5h3v19h-3z"/>'),
  // torsion spring, front: close-wound coils, a leg up from one end and down from the other
  torsionfront: svg('<path d="M9 8h7v8H9z"/><path d="M11 8v8M13 8v8"/><path d="M8 2v14M17 8v14"/>'),
  torsion3d: svg('<path d="M9 8h7v8H9z"/><path d="M11 8v8M13 8v8"/><path d="M8 2v14M17 8v14"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // torsion spring, end: the coils' ring, a leg off its side bent over at the top and one off its foot
  torsionend: svg('<circle cx="9" cy="15" r="5"/><path d="M4 15V3h3M9 20h12v-3"/>'),
  // Belleville springs: two discs facing each other, cut through their axis
  belleville: svg('<path d="M5 3l3 7M8 3l3 7M19 3l-3 7M16 3l-3 7M5 21l3-7M8 21l3-7M19 21l-3-7M16 21l-3-7"/><path d="M2 12h20" stroke-dasharray="3 2"/>'),
  belleville3d: svg('<path d="M5 3l3 7M8 3l3 7M19 3l-3 7M16 3l-3 7M5 21l3-7M8 21l3-7M19 21l-3-7M16 21l-3-7"/><path d="M2 12h20" stroke-dasharray="3 2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // bearing lock nut: a ring with four slots round a thread
  locknut: svg('<path d="M10.5 2.6a9.5 9.5 0 0 0-7.9 7.9H5v3H2.6a9.5 9.5 0 0 0 7.9 7.9V19h3v2.4a9.5 9.5 0 0 0 7.9-7.9H19v-3h2.4a9.5 9.5 0 0 0-7.9-7.9V5h-3z"/><circle cx="12" cy="12" r="4"/><path d="M12 6.5a5.5 5.5 0 1 1-5.5 5.5"/>'),
  locknut3d: svg('<path d="M10.5 2.6a9.5 9.5 0 0 0-7.9 7.9H5v3H2.6a9.5 9.5 0 0 0 7.9 7.9V19h3v2.4a9.5 9.5 0 0 0 7.9-7.9H19v-3h2.4a9.5 9.5 0 0 0-7.9-7.9V5h-3z"/><circle cx="12" cy="12" r="4"/><path d="M12 6.5a5.5 5.5 0 1 1-5.5 5.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // pillow block: a base, the housing's round top on it, the bore
  pillowblock: svg('<path d="M2 17h20v3H2zM5.5 17l1.3-4.2A6.5 6.5 0 1 1 17.2 12.8L18.5 17"/><circle cx="12" cy="10" r="2.5"/>'),
  pillowblock3d: svg('<path d="M2 17h20v3H2zM5.5 17l1.3-4.2A6.5 6.5 0 1 1 17.2 12.8L18.5 17"/><circle cx="12" cy="10" r="2.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // 2-hole flanged bearing: an oval flange with a hole in each lobe, the housing and bore
  flanged2: svg('<path d="M15.25 6.37 21.25 9.83A2.5 2.5 0 0 1 21.25 14.17L15.25 17.63A6.5 6.5 0 0 1 8.75 17.63L2.75 14.17A2.5 2.5 0 0 1 2.75 9.83L8.75 6.37A6.5 6.5 0 0 1 15.25 6.37z"/><circle cx="4" cy="12" r="1"/><circle cx="20" cy="12" r="1"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="2"/>'),
  flanged23d: svg('<path d="M15.25 6.37 21.25 9.83A2.5 2.5 0 0 1 21.25 14.17L15.25 17.63A6.5 6.5 0 0 1 8.75 17.63L2.75 14.17A2.5 2.5 0 0 1 2.75 9.83L8.75 6.37A6.5 6.5 0 0 1 15.25 6.37z"/><circle cx="4" cy="12" r="1"/><circle cx="20" cy="12" r="1"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // 4-hole flanged bearing: a square flange, a hole in each corner, the housing and bore
  flanged4: svg('<rect x="2" y="2" width="20" height="20" rx="4"/><circle cx="6" cy="6" r="1.3"/><circle cx="18" cy="6" r="1.3"/><circle cx="6" cy="18" r="1.3"/><circle cx="18" cy="18" r="1.3"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2.5"/>'),
  flanged43d: svg('<rect x="2" y="2" width="20" height="20" rx="4"/><circle cx="6" cy="6" r="1.3"/><circle cx="18" cy="6" r="1.3"/><circle cx="6" cy="18" r="1.3"/><circle cx="18" cy="18" r="1.3"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // circular roller chain: rollers round an arc, a centre mark
  // offset link: a link cranked from narrow to wide, its roller at the left and pin at the right
  offsetlink: svg('<path d="M6 8h5l3 2h4a2 2 0 0 1 0 4h-4l-3 2H6a4 4 0 0 1 0-8z"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="1"/>'),
  offsetlink3d: svg('<path d="M6 8h5l3 2h4a2 2 0 0 1 0 4h-4l-3 2H6a4 4 0 0 1 0-8z"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="1"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // bevel gears: two cones meeting at their apex, at right angles
  bevelgear: svg('<path d="M3 21V11l8-2v12zM11 9 3 11M3 3h10l-2 8z"/><path d="M3 3l8 6"/>'),
  bevelgear3d: svg('<path d="M3 21V11l8-2v12zM11 9 3 11M3 3h10l-2 8z"/><path d="M3 3l8 6"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // worm: a threaded shaft, its threads slanting across it, a hub at the right
  worm: svg('<path d="M3 7h13v10H3zM16 10h5v4h-5M5.5 7 8 17M9 7l2.5 10M12.5 7l2.5 10"/>'),
  worm3d: svg('<path d="M3 7h13v10H3zM16 10h5v4h-5M5.5 7 8 17M9 7l2.5 10M12.5 7l2.5 10"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // worm gear: a toothed wheel with a worm across its top
  wormgear: svg('<circle cx="12" cy="14" r="7"/><circle cx="12" cy="14" r="2"/><path d="M5 2h14v4H5zM8 2l1.5 4M11.5 2 13 6M15 2l1.5 4"/>'),
  wormgear3d: svg('<circle cx="12" cy="14" r="7"/><circle cx="12" cy="14" r="2"/><path d="M5 2h14v4H5zM8 2l1.5 4M11.5 2 13 6M15 2l1.5 4"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  shaft: svg('<path d="M2 10h5v-1h6v-2h6v2h3v6h-3v2h-6v-2H7v-1H2z"/><path d="M8 11h4"/><path d="M1 12h22" stroke-dasharray="2 2"/>'),
  shaft3d: svg('<path d="M2 10h5v-1h6v-2h6v2h3v6h-3v2h-6v-2H7v-1H2z"/><path d="M8 11h4"/><path d="M1 12h22" stroke-dasharray="2 2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  clevisinch: svg('<path d="M3 7h3v10H3zM6 9h14l1 1v4l-1 1H6z"/><circle cx="17" cy="12" r="1.2"/>'),
  clevisinch3d: svg('<path d="M3 7h3v10H3zM6 9h14l1 1v4l-1 1H6z"/><circle cx="17" cy="12" r="1.2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  clevismetric: svg('<path d="M3 7h3v10H3zM6 9h14l1 1v4l-1 1H6z"/><circle cx="17" cy="12" r="1.2"/><path d="M9 12h4"/>'),
  clevismetric3d: svg('<path d="M3 7h3v10H3zM6 9h14l1 1v4l-1 1H6z"/><circle cx="17" cy="12" r="1.2"/><path d="M9 12h4"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  clevisdin: svg('<path d="M3 7h3v10H3zM6 9h14l1 1v4l-1 1H6z"/><circle cx="17" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/>'),
  clevisdin3d: svg('<path d="M3 7h3v10H3zM6 9h14l1 1v4l-1 1H6z"/><circle cx="17" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  cotterpin: svg('<path d="M9 10.5H5a2.5 2.5 0 1 0 0 3h4M9 10.5h10M9 12h10M9 13.5h12"/>'),
  cotterpin3d: svg('<path d="M9 10.5H5a2.5 2.5 0 1 0 0 3h4M9 10.5h10M9 12h10M9 13.5h12"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  dowelpin: svg('<path d="M6 9h13l1.5 1.5v3L19 15H6a3 3 0 0 1 0-6z"/>'),
  dowelpin3d: svg('<path d="M6 9h13l1.5 1.5v3L19 15H6a3 3 0 0 1 0-6z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  parallelpin: svg('<path d="M6 9h13l1.5 1.5v3L19 15H6l-1.5-1.5v-3z"/><path d="M19 9v6"/>'),
  parallelpin3d: svg('<path d="M6 9h13l1.5 1.5v3L19 15H6l-1.5-1.5v-3z"/><path d="M19 9v6"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  taperpininch: svg('<path d="M4 8l16 2.5v3L4 16a4 4 0 0 1 0-8z"/>'),
  taperpininch3d: svg('<path d="M4 8l16 2.5v3L4 16a4 4 0 0 1 0-8z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  taperpindin: svg('<path d="M4 8l16 2.5v3L4 16a4 4 0 0 1 0-8z"/><path d="M1 12h22" stroke-dasharray="2 2"/>'),
  taperpindin3d: svg('<path d="M4 8l16 2.5v3L4 16a4 4 0 0 1 0-8z"/><path d="M1 12h22" stroke-dasharray="2 2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  rivetlarge: svg('<path d="M5 9a7 6 0 0 1 14 0zM9 9h6v12H9z"/>'),
  rivetlarge3d: svg('<path d="M5 9a7 6 0 0 1 14 0zM9 9h6v12H9z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  rivetsmall: svg('<path d="M7 11a5 4 0 0 1 10 0zM10 11h4v9h-4z"/>'),
  rivetsmall3d: svg('<path d="M7 11a5 4 0 0 1 10 0zM10 11h4v9h-4z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  rivetdin: svg('<path d="M5 8l14 0-5 4h-4zM10 12h4v9h-4z"/>'),
  rivetdin3d: svg('<path d="M5 8l14 0-5 4h-4zM10 12h4v9h-4z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  acornnut: svg('<path d="M4 20v-6h16v6zM8 14v6M16 14v6M6 14a6 7 0 0 1 12 0"/>'),
  acornnut3d: svg('<path d="M4 20v-6h16v6zM8 14v6M16 14v6M6 14a6 7 0 0 1 12 0"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  hexcapnut: svg('<path d="M4 20v-6h16v6zM12 14v6M6 14V12a6 6 0 0 1 12 0v2"/>'),
  hexcapnut3d: svg('<path d="M4 20v-6h16v6zM12 14v6M6 14V12a6 6 0 0 1 12 0v2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  knurleddin: svg('<path d="M3 6h18v5H3zM8 11v9h8v-9M6 6v5M9 6v5M12 6v5M15 6v5M18 6v5"/>'),
  knurleddin3d: svg('<path d="M3 6h18v5H3zM8 11v9h8v-9M6 6v5M9 6v5M12 6v5M15 6v5M18 6v5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  knurledinch: svg('<path d="M3 6h18v5H3zM8 11v9h8v-9M6 6v5M10 6v5M14 6v5M18 6v5"/><path d="M12 13v5" stroke-dasharray="1 1"/>'),
  knurledinch3d: svg('<path d="M3 6h18v5H3zM8 11v9h8v-9M6 6v5M10 6v5M14 6v5M18 6v5"/><path d="M12 13v5" stroke-dasharray="1 1"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  wingdin: svg('<path d="M9 20h6l-1-4h-4zM10 16C7 16 4 14 3 10a3 3 0 0 1 5-2l2 8M14 16c3 0 6-2 7-6a3 3 0 0 0-5-2l-2 8"/>'),
  wingdin3d: svg('<path d="M9 20h6l-1-4h-4zM10 16C7 16 4 14 3 10a3 3 0 0 1 5-2l2 8M14 16c3 0 6-2 7-6a3 3 0 0 0-5-2l-2 8"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  winga: svg('<path d="M9 20h6l-1-4h-4zM10 16C7 16 4 14 3 10a3 3 0 0 1 5-2l2 8M14 16c3 0 6-2 7-6a3 3 0 0 0-5-2l-2 8"/><path d="M12 17v2"/>'),
  winga3d: svg('<path d="M9 20h6l-1-4h-4zM10 16C7 16 4 14 3 10a3 3 0 0 1 5-2l2 8M14 16c3 0 6-2 7-6a3 3 0 0 0-5-2l-2 8"/><path d="M12 17v2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  wingb: svg('<path d="M9 20h6l-1-4h-4zM10 16 7 6a2.5 2.5 0 0 0-4 1l3 9zM14 16l3-10a2.5 2.5 0 0 1 4 1l-3 9z"/>'),
  wingb3d: svg('<path d="M9 20h6l-1-4h-4zM10 16 7 6a2.5 2.5 0 0 0-4 1l3 9zM14 16l3-10a2.5 2.5 0 0 1 4 1l-3 9z"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  wingc: svg('<path d="M9 20h6l-1-4h-4zM10 16C7 16 4 14 3 10a3 3 0 0 1 5-2l2 8M14 16c3 0 6-2 7-6a3 3 0 0 0-5-2l-2 8"/><circle cx="6" cy="10" r="1.2"/><circle cx="18" cy="10" r="1.2"/>'),
  wingc3d: svg('<path d="M9 20h6l-1-4h-4zM10 16C7 16 4 14 3 10a3 3 0 0 1 5-2l2 8M14 16c3 0 6-2 7-6a3 3 0 0 0-5-2l-2 8"/><circle cx="6" cy="10" r="1.2"/><circle cx="18" cy="10" r="1.2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  wingd: svg('<path d="M3 8c1 6 3 9 6 9h6c3 0 5-3 6-9M5 8c1 5 2.5 7 4.5 7h5c2 0 3.5-2 4.5-7M3 8h2M19 8h2"/>'),
  wingd3d: svg('<path d="M3 8c1 6 3 9 6 9h6c3 0 5-3 6-9M5 8c1 5 2.5 7 4.5 7h5c2 0 3.5-2 4.5-7M3 8h2M19 8h2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  ringasme: svg('<path d="M9.5 19.6A8 8 0 1 1 14.5 19.6M9.8 16.8A5.2 5.2 0 1 1 14.2 16.8M9.5 19.6l-1.2 1.6 2.4.6.7-2.6M14.5 19.6l1.2 1.6-2.4.6-.7-2.6"/>'),
  ringasme3d: svg('<path d="M9.5 19.6A8 8 0 1 1 14.5 19.6M9.8 16.8A5.2 5.2 0 1 1 14.2 16.8M9.5 19.6l-1.2 1.6 2.4.6.7-2.6M14.5 19.6l1.2 1.6-2.4.6-.7-2.6"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  ringdin: svg('<path d="M8 19a8 8 0 1 1 8 0M8.8 16.2a5.2 5.2 0 1 1 6.4 0M8 19l2.6-2.8M16 19l-2.6-2.8"/><circle cx="8.4" cy="18" r=".7"/><circle cx="15.6" cy="18" r=".7"/>'),
  ringdin3d: svg('<path d="M8 19a8 8 0 1 1 8 0M8.8 16.2a5.2 5.2 0 1 1 6.4 0M8 19l2.6-2.8M16 19l-2.6-2.8"/><circle cx="8.4" cy="18" r=".7"/><circle cx="15.6" cy="18" r=".7"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  washerdin: svg('<path d="M7 20a9 9 0 1 1 10 0l-2-1 .5-4M7 20l2-1-.5-4M8.5 15 7 9.5 10 8l2 3 2-3 3 1.5-1.5 5.5"/>'),
  washerdin3d: svg('<path d="M7 20a9 9 0 1 1 10 0l-2-1 .5-4M7 20l2-1-.5-4M8.5 15 7 9.5 10 8l2 3 2-3 3 1.5-1.5 5.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  eyebolt: svg('<circle cx="12" cy="6.5" r="4"/><circle cx="12" cy="6.5" r="1.8"/><path d="M11 10.4V21h2V10.4M11 15h2"/>'),
  eyebolt3d: svg('<circle cx="12" cy="6.5" r="4"/><circle cx="12" cy="6.5" r="1.8"/><path d="M11 10.4V21h2V10.4M11 15h2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  jbolt: svg('<path d="M13 3v13a4 4 0 0 1-4 4H6v-2.2h3a1.8 1.8 0 0 0 1.8-1.8V3zM10.8 8H13"/>'),
  jbolt3d: svg('<path d="M13 3v13a4 4 0 0 1-4 4H6v-2.2h3a1.8 1.8 0 0 0 1.8-1.8V3zM10.8 8H13"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  swingbolt: svg('<path d="M8.5 11V6.5a3.5 3.5 0 0 1 7 0V11zM11 11v10h2V11M11 16h2"/><circle cx="12" cy="6.5" r="1.6"/>'),
  swingbolt3d: svg('<path d="M8.5 11V6.5a3.5 3.5 0 0 1 7 0V11zM11 11v10h2V11M11 16h2"/><circle cx="12" cy="6.5" r="1.6"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  swingeyebolt: svg('<circle cx="12" cy="6" r="3.5"/><circle cx="12" cy="6" r="1.6"/><path d="M11 9.4V21h2V9.4M11 15h2"/>'),
  swingeyebolt3d: svg('<circle cx="12" cy="6" r="3.5"/><circle cx="12" cy="6" r="1.6"/><path d="M11 9.4V21h2V9.4M11 15h2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  tbolt: svg('<path d="M7 3h10v3H7zM11 6v15h2V6M11 15h2"/>'),
  tbolt3d: svg('<path d="M7 3h10v3H7zM11 6v15h2V6M11 15h2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  fastener: svg('<path d="M8 3h8l2 3.5-2 3.5H8L6 6.5zM10 10v11h4V10M10 14h4M10 17.5h4"/>'),
  thumbscrew: svg('<circle cx="12" cy="6.5" r="4"/><path d="M9.6 9.7 11 12.5 8 15h8l-3-2.5 1.4-2.8M11 15v6h2v-6M11 18h2"/>'),
  thumbscrew3d: svg('<circle cx="12" cy="6.5" r="4"/><path d="M9.6 9.7 11 12.5 8 15h8l-3-2.5 1.4-2.8M11 15v6h2v-6M11 18h2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  ubolt: svg('<path d="M5 21V10a7 7 0 0 1 14 0v11h-2.2V10a4.8 4.8 0 0 0-9.6 0v11zM5 16h2.2M16.8 16H19"/>'),
  ubolt3d: svg('<path d="M5 21V10a7 7 0 0 1 14 0v11h-2.2V10a4.8 4.8 0 0 0-9.6 0v11zM5 16h2.2M16.8 16H19"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  rivettubular: svg('<path d="M4 6h2v12H4zM18 6h2v12h-2zM6 9h12M6 15h12"/><path d="M20 9h2M20 15h2" stroke-dasharray="1 1"/>'),
  rivettubular3d: svg('<path d="M4 6h2v12H4zM18 6h2v12h-2zM6 9h12M6 15h12"/><path d="M20 9h2M20 15h2" stroke-dasharray="1 1"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  chaincircular: svg('<path d="M4.2 15.5a8 8 0 0 1 15.6 0"/><circle cx="4.5" cy="14.5" r="1.6"/><circle cx="7" cy="8.3" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="17" cy="8.3" r="1.6"/><circle cx="19.5" cy="14.5" r="1.6"/><path d="M12 16v3M10.5 17.5h3"/>'),
  chaincircular3d: svg('<path d="M4.2 15.5a8 8 0 0 1 15.6 0"/><circle cx="4.5" cy="14.5" r="1.6"/><circle cx="7" cy="8.3" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="17" cy="8.3" r="1.6"/><circle cx="19.5" cy="14.5" r="1.6"/><path d="M12 16v3M10.5 17.5h3"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // feature control frame: a row of boxes, a position symbol in the first
  // dimension tape: a line with hash marks and smaller subdivisions, a number over the middle one
  dimtape: svg('<path d="M2 15h20M3 12v6M12 12v6M21 12v6M7.5 13.5v3M16.5 13.5v3"/><path d="M10.5 5h3v4"/>'),
  // geom dim and tol note: a diameter sign and a depth symbol
  gdtnote: svg('<circle cx="6.5" cy="12" r="3.5"/><path d="M2.5 17l8-10M15 7h6M18 7v10M15.5 13.5l2.5 3.5 2.5-3.5"/>'),
  fcf: svg('<path d="M2 8h20v8H2zM9 8v8M16 8v8"/><circle cx="5.5" cy="12" r="1.6"/><path d="M3.5 12h4M5.5 10v4"/>'),
  // weldfilletaws and weldfilletiso: a reference line and its arrow with a fillet weld under it
  weldfilletaws: svg('<path d="M2 8h13l6 10"/><path d="M6 8v5l5-5"/>'),
  weldfilletiso: svg('<path d="M2 8h13l6 10"/><path d="M6 8v5l5-5"/>'),
  // weldflangeaws and weldflangeiso: a reference line and its arrow with an edge-flange weld under it
  weldflangeaws: svg('<path d="M2 8h13l6 10"/><path d="M4 8q2 0 2 2v4M12 8q-2 0-2 2v4"/>'),
  weldflangeiso: svg('<path d="M2 8h13l6 10"/><path d="M4 8q2 0 2 2v4M12 8q-2 0-2 2v4"/>'),
  // weldgrooveaws and weldgrooveiso: a reference line and its arrow with a V-groove weld under it
  weldgrooveaws: svg('<path d="M2 8h13l6 10"/><path d="M5 13l3-5 3 5"/>'),
  weldgrooveiso: svg('<path d="M2 8h13l6 10"/><path d="M5 13l3-5 3 5"/>'),
  // weldmiscaws and weldmisciso: a reference line and its arrow with a spot weld under it
  weldmiscaws: svg('<path d="M2 8h13l6 10"/><circle cx="8" cy="11" r="2.6"/>'),
  weldmisciso: svg('<path d="M2 8h13l6 10"/><circle cx="8" cy="11" r="2.6"/>'),
  // weldslotplugaws and weldslotplugiso: a reference line and its arrow with a plug weld under it
  weldslotplugaws: svg('<path d="M2 8h13l6 10"/><path d="M5 8v4.5h6V8"/>'),
  weldslotplugiso: svg('<path d="M2 8h13l6 10"/><path d="M5 8v4.5h6V8"/>'),
  // drilled hole: a hole cut through, its walls meeting in the drill's point, on its axis
  drilledhole: svg('<path d="M8 3v12l4 5 4-5V3"/><path d="M12 1v22" stroke-dasharray="3 2"/>'),
  drilledhole3d: svg('<path d="M8 3v12l4 5 4-5V3"/><path d="M12 1v22" stroke-dasharray="3 2"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // tapped holes: the tap drill's circle and three quarters of the thread's
  tappedmm: svg('<circle cx="12" cy="12" r="5"/><path d="M12 4a8 8 0 1 0 8 8"/><path d="M1 23v-5l2 3 2-3v5"/>'),
  tappedmm3d: svg('<circle cx="12" cy="12" r="5"/><path d="M12 4a8 8 0 1 0 8 8"/><path d="M1 23v-5l2 3 2-3v5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  tappedin: svg('<circle cx="12" cy="12" r="5"/><path d="M12 4a8 8 0 1 0 8 8"/><path d="M2 18v3M4.5 18v3"/>'),
  tappedin3d: svg('<circle cx="12" cy="12" r="5"/><path d="M12 4a8 8 0 1 0 8 8"/><path d="M2 18v3M4.5 18v3"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // slot: a long hole with round ends on its centre line
  slot: svg('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M1 12h22" stroke-dasharray="3 2"/>'),
  // hole pattern: holes round a bolt circle
  holepattern: svg('<circle cx="12" cy="12" r="7" stroke-dasharray="3 2"/><circle cx="12" cy="5" r="2"/><circle cx="18" cy="15.5" r="2"/><circle cx="6" cy="15.5" r="2"/>'),
  // screw threads: a threaded end from the side, crests across it
  screwthread: svg('<path d="M3 8h18v8H3z"/><path d="M6 8v8M9 9.5v5M12 8v8M15 9.5v5"/>'),
  // keyway: a shaft cut across with a key seat at the top
  keyway: svg('<path d="M10 4.3A8 8 0 1 0 14 4.3V8h-4z"/>'),
  // stipple: dots thinning across a box
  stipple: svg('<g fill="currentColor"><circle cx="5" cy="6" r="1"/><circle cx="8" cy="10" r="1"/><circle cx="4" cy="13" r="1"/><circle cx="7" cy="17" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="10" cy="19" r="1"/><circle cx="16" cy="11" r="1"/><circle cx="19" cy="17" r="1"/></g>'),
  // bolt: a hex head and a threaded shank, from the side
  bolt: svg('<path d="M3 7h4v10H3z"/><path d="M7 9.5h13.5l.5.5v4l-.5.5H7"/><path d="M14 9.5v5M14 10.5h6M14 13.5h6"/>'),
  // screw: a countersunk head and a threaded, pointed shank
  screw: svg('<path d="M3 6v12l3-3.5h11.5L21 12l-3.5-2.5H6z"/><path d="M10 9.5l1.5 5M13 9.5l1.5 5M16 9.5l1.2 4"/>'),
  // nail: a flat head and a pointed shank
  nail: svg('<path d="M4 6v12h2v-5h11l4-1-4-1H6V6z"/>'),
  // anchor: a nut and washer on a rod, the sleeve near its tip
  anchor: svg('<path d="M3 10.5h18v3H3z"/><path d="M5 8h3v8H5z"/><path d="M8.5 7h1v10h-1z"/><path d="M14 9.5h5v5h-5zM14 12h5"/>'),
  // carriagebolt: a domed head over a square neck and a threaded shank
  carriagebolt: svg('<path d="M4 8a8 5 0 0 1 16 0z"/><path d="M9.5 8h5v3h-5zM12 8v3"/><path d="M10.5 11v10h3V11M10.5 15h3M10.5 17.5h3"/>'),
  carriagebolt3d: svg('<path d="M4 8a8 5 0 0 1 16 0z"/><path d="M9.5 8h5v3h-5zM12 8v3"/><path d="M10.5 11v10h3V11M10.5 15h3M10.5 17.5h3"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  boltnutinch: svg('<path d="M4 8a8 5 0 0 1 16 0z"/><path d="M9.5 8h5v3h-5zM12 8v3"/><path d="M10.5 11v10h3V11M10.5 15h3M10.5 17.5h3"/>'),
  boltnutmm: svg('<path d="M4 8a8 5 0 0 1 16 0z"/><path d="M9.5 8h5v3h-5zM12 8v3"/><path d="M10.5 11v10h3V11M10.5 15h3M10.5 17.5h3"/>'),
  // lagscrew: a hex head over a shank threaded to a gimlet point
  lagscrew: svg('<path d="M7 3h10v4H7zM10 3v4M14 3v4"/><path d="M10 7v10l2 4 2-4V7"/><path d="M10 10.5l4 1.5M10 13.5l4 1.5"/>'),
  lagscrew3d: svg('<path d="M7 3h10v4H7zM10 3v4M14 3v4"/><path d="M10 7v10l2 4 2-4V7"/><path d="M10 10.5l4 1.5M10 13.5l4 1.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // woodscrew: a countersunk head over a shank threaded most of its length to a gimlet point
  woodscrew: svg('<path d="M6 3h12l-4 4h-4z"/><path d="M10 7v10l2 4 2-4V7"/><path d="M10 10l4 1.5M10 12.5l4 1.5M10 15l4 1.5"/>'),
  woodscrew3d: svg('<path d="M6 3h12l-4 4h-4z"/><path d="M10 7v10l2 4 2-4V7"/><path d="M10 10l4 1.5M10 12.5l4 1.5M10 15l4 1.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // sheetmetalscrew: a pan head over a shank threaded to the head, to a point
  sheetmetalscrew: svg('<path d="M6 7V5.5Q6 3 9 3h6q3 0 3 2.5V7z"/><path d="M10 7v10l2 4 2-4V7"/><path d="M10 8l4 1.5M10 10.5l4 1.5M10 13l4 1.5M10 15.5l4 1.5"/>'),
  sheetmetalscrew3d: svg('<path d="M6 7V5.5Q6 3 9 3h6q3 0 3 2.5V7z"/><path d="M10 7v10l2 4 2-4V7"/><path d="M10 8l4 1.5M10 10.5l4 1.5M10 13l4 1.5M10 15.5l4 1.5"/><path d="M18 2l3.5 2v4L18 10l-3.5-2V4zM14.5 4L18 6l3.5-2M18 6v4"/>'),
  // weld: an arrow to the joint and a reference line with a fillet under it
  weld: svg('<path d="M3 20l7-11h11"/><path d="M3 20l.8-3.3 2 1.3z"/><path d="M14 9v4l4-4"/>'),
  // table and chairs: a table with a chair on each long side
  tablechairs: svg('<rect x="5" y="8" width="14" height="8"/><path d="M8 5h3v3H8zM13 5h3v3h-3zM8 16h3v3H8zM13 16h3v3h-3z"/><path d="M8 4h3M13 4h3M8 20h3M13 20h3"/>'),
  // desk: an L-shaped top with its chair
  desk: svg('<path d="M3 5h18v6H8v8H3z"/><path d="M12.5 14h4v3.5h-4zM12.5 19.5h4"/>'),
  // shelving unit: the sides and back as cut, the shelf between them
  shelving: svg('<path d="M3 6h18v12H3z"/><path d="M5.5 6v12M18.5 6v12M5.5 8.5h13"/>'),
  // clothes rod: the shelf with the rod's centre line under it
  clothesrod: svg('<path d="M3 3.5h18"/><path d="M3 3.5v10h18v-10"/><path d="M3 9h18" stroke-dasharray="3 2"/>'),
  // bath-shower: a tub's outline, its rounded basin and drain
  bathshower: svg('<path d="M3 6h18v12H3z"/><rect x="5.5" y="8.5" width="13" height="7" rx="2.5"/><circle cx="8" cy="12" r="1"/>'),
  // grab bars: a bar standing off the wall, its ends turning back to it
  grabbars: svg('<path d="M3 5h18"/><path d="M5.5 5v8h13V5"/><path d="M4 6.5h3M17 6.5h3"/>'),
  // fireplace: a unit narrowing to the wall, its firebox and flue
  fireplace: svg('<path d="M3 19h18l-3-14H6z"/><path d="M8 19l1.5-6h5l1.5 6"/><circle cx="12" cy="8.5" r="1.5"/>'),
  // toilet stall: partitions, a toilet against the back and the door swung in
  toiletstall: svg('<path d="M4 4v16M20 4v16M4 20h3M15 20h5"/><path d="M10 4h4v2.5h-4z"/><ellipse cx="12" cy="10" rx="2" ry="3"/><path d="M7 20v-7M7 13a7 7 0 017 7"/>'),
  // ceiling grid: an outline with its tiles
  ceilinggrid: svg('<path d="M3 5h18v14H3z"/><path d="M9 5v14M15 5v14M3 12h18"/>'),
  // cabinet: a run of base cabinets under a counter, one tall cabinet crossed
  cabinet: svg('<path d="M3 5h18v9H3z"/><path d="M3 12h11M14 5v9"/><path d="M14 5l7 9M21 5l-7 9"/><path d="M3 17h11"/>'),
  // custom cabinet: its outline crossed
  customcab: svg('<path d="M3 6h18v12H3z"/><path d="M3 6l18 12M21 6L3 18"/>'),
  // countertop: an L of counter with its backsplash line along the wall
  countertop: svg('<path d="M3 3h18v8h-10v10H3z"/><path d="M5.5 21V5.5H21"/>'),
  compsink: svg('<path d="M2 6h20v12H2z"/><path d="M2 8h20"/><rect x="4" y="10" width="5" height="6" rx="1"/><rect x="10" y="10" width="5" height="6" rx="1"/><rect x="16" y="10" width="4" height="6" rx="1"/>'),
  // seating section: an outline with rows of chairs facing down
  seating: svg('<path d="M3 3h18v18H3z"/><path d="M6 7h3v3H6zM10.5 7h3v3h-3zM15 7h3v3h-3zM6 13h3v3H6zM10.5 13h3v3h-3zM15 13h3v3h-3z"/>'),
  // space: a room's outline with its name and area
  space: svg('<path d="M3 4h18v16H3z"/><path d="M8 10.5h8M9.5 14h5"/>'),
  spacelink: svg('<path d="M3 3h7v7H3zM14 14h7v7h-7z"/><path d="M10 10l4 4"/>'),
  adjacencymatrix: svg('<path d="M3 4h7v16H3zM3 9.3h7M3 14.7h7"/><path d="M10 4l11 8-11 8M10 14.7l3.700-2.700-3.700-2.700"/>'),
  adjacencyscore: svg('<path d="M3 5h18v14H3z"/><path d="M8 9.500h2.500v2.500H8v2.500h2.500M14 9.500v5"/>'),
  stackingdiagram: svg('<path d="M3 5h18v5H3zM3 14h13v5H3zM9 5v5M15 5v5M8 14v5"/>'),
  // hardscape: a paved area, its border and joints
  hardscape: svg('<path d="M3 5h18v14H3z"/><path d="M5.5 7.5h13v9h-13z"/><path d="M10 7.5v9M14 7.5v9M5.5 12h13"/>'),
  // landscape area: a cloud-edged bed with its label
  landscape: svg('<path d="M6 6.5a2.2 2.2 0 014-1 2.2 2.2 0 014 0 2.2 2.2 0 014 1 2.2 2.2 0 011.5 3.5 2.2 2.2 0 010 4 2.2 2.2 0 01-1.5 3.5 2.2 2.2 0 01-4 1 2.2 2.2 0 01-4 0 2.2 2.2 0 01-4-1 2.2 2.2 0 01-1.5-3.5 2.2 2.2 0 010-4A2.2 2.2 0 016 6.5z"/><path d="M9 12h6"/>'),
  // existing tree: a canopy round its trunk, a dashed root zone beyond
  existingtree: svg('<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="10" stroke-dasharray="2 2"/>'),
  // sitesculpt: a mound on the ground with an arrow pulling it up
  sitesculpt: svg('<path d="M3 19c4 0 5-6 9-6s5 6 9 6"/><path d="M12 10V3M9 6l3-3 3 3"/>'),
  // sitecontour: nested contour lines, one picked out with a vertex
  sitecontour: svg('<path d="M4 16c3-6 13-6 16 0"/><path d="M8 18c2-3 6-3 8 0"/><path d="M3 11c4-7 14-7 18 0"/><circle cx="12" cy="6" r="1.4"/>'),
  // massingmodel: a block of a building with a hipped roof
  massingmodel: svg('<path d="M4 11l8-5 8 5"/><path d="M5 11v9h14v-9"/><path d="M5 15h14"/>'),
  // sitelabels: a contour line broken by a label's handle
  sitelabels: svg('<path d="M3 14c3-3 5-4 6-4M15 10c2 0 4 1 6 4"/><rect x="9.5" y="7.5" width="5" height="5"/><path d="M4 20c5-3 11-3 16 0"/>'),
  // spotnumber (Spotlight Numbering by clicks): a pointer clicking a numbered bubble
  spotnumber: svg('<circle cx="9" cy="9" r="6"/><path d="M7.5 7l1.5-1v6"/><path d="M14 14l6 2.5-2.5 1-1 2.5z"/>'),
  // visualzone: an eye over dark ground
  visualzone: svg('<path d="M4 9s3-4 8-4 8 4 8 4-3 4-8 4-8-4-8-4z"/><circle cx="12" cy="9" r="1.5"/><path d="M4 19l5-3 4 2 7-3"/>'),
  // grade: a slope between two marked points
  grade: svg('<path d="M4 17 20 7"/><circle cx="4.5" cy="17" r="2"/><circle cx="19.5" cy="7" r="2"/><path d="M11 18h6m-2-2 2 2-2 2"/>'),
  // sitemodifier: a pad on sloping ground, its outline dashed round it
  sitemodifier: svg('<path d="M4 5h16v14H4z" stroke-dasharray="2 2"/><path d="M8 9h8v6H8z"/><path d="M4 12h4M16 12h4M12 5v4M12 15v4"/>'),
  // hedgerow: a band of billows along its dashed path
  hedgerow: svg('<path d="M3 9q1.5-3 3 0q1.5-3 3 0q1.5-3 3 0q1.5-3 3 0q1.5-3 3 0q1.5-3 3 0v6q-1.5 3-3 0q-1.5 3-3 0q-1.5 3-3 0q-1.5 3-3 0q-1.5 3-3 0q-1.5 3-3 0z"/><path d="M1 12h22" stroke-dasharray="2 2"/>'),
  // property line: a lot's boundary with a bearing along a side
  propline: svg('<path d="M4 8l14-4 2 15H5z" stroke-dasharray="4 1.5 1 1.5"/><path d="M8 13l5-1.4"/>'),
  // parking space: angled stalls off a curb
  parking: svg('<path d="M3 19h18"/><path d="M4 19l4-12M10 19l4-12M16 19l4-12"/><path d="M8 7h12"/>'),
  parkingspaces: svg('<path d="M3 19h18"/><path d="M4 19l4-12M10 19l4-12M16 19l4-12"/><path d="M8 7h12"/><path d="M5 3h14"/>'),
  // column: a square column with its diagonals
  column: svg('<path d="M6 6h12v12H6z"/><path d="M6 6l12 12M18 6L6 18"/>'),
  // stair: treads, the walk line's arrow and the break line
  stair: svg('<path d="M7 3v18M17 3v18M7 7h10M7 11h10M7 15h10M7 19h10"/><path d="M12 19V5M10 7.5L12 5l2 2.5"/>'),
  simplestair: svg('<path d="M3 6h12v12H3z"/><path d="M6 6v12M9 6v12M12 6v12"/><path d="M15 6h6v12h-6"/><path d="M4.5 12h13"/><path d="M16 10.5l2 1.5-2 1.5"/>'),
  ramp: svg('<path d="M3 7h18v10H3z"/><path d="M4.5 12h14"/><path d="M16.5 10l2.5 2-2.5 2"/>'),
  elevator: svg('<path d="M4 3h16v15H4z"/><path d="M7 6h10v9H7z"/><path d="M7 6l10 9M17 6L7 15"/><path d="M8 19.5h3M13 19.5h3"/>'),
  escalator: svg('<path d="M2 7h20v10H2z"/><path d="M6 9v6M9 9v6M12 9v6M15 9v6M18 9v6"/><path d="M4 8h16M4 16h16"/>'),
  // pilaster: a shaft standing out from a wall's face, its structural part inside
  pilaster: svg('<path d="M2 6h20M2 9h20"/><path d="M7 9v8h10V9"/><rect x="10" y="11" width="4" height="4"/>'),
  // structural member: a beam in plan meeting a wide flange column
  chainextrude: svg('<path d="M3 9l12-5 6 3v3l-6-2-12 5z"/><path d="M7 13v6M12 11v8M17 9v10"/>'),
  structmember: svg('<path d="M3 10h12v4H3z"/><path d="M15 6h6M15 18h6M18 6v12"/>'),
  // railing: a top rail along a bent path with posts on it
  railing: svg('<path d="M3 17L12 8l9 9"/><rect x="1.5" y="15.5" width="3" height="3"/><rect x="10.5" y="6.5" width="3" height="3"/><rect x="19.5" y="15.5" width="3" height="3"/><circle cx="7.5" cy="12.5" r="1"/><circle cx="16.5" cy="12.5" r="1"/>'),
  // stake: a triangle indicator with its label and leader line
  stake: svg('<path d="M6 13l3.5 6h-7z"/><path d="M7.5 13l4-5h2"/><path d="M14 5h8M14 9h6"/>'),
  // fence: posts along a run of boards, turning a corner
  fence: svg('<path d="M3 15h18M21 15V5"/><path d="M2 14h2v2H2zM10 14h2v2h-2zM18 14h2v2h-2zM20 9h2v2h-2zM20 3h2v2h-2z"/><path d="M6 17v-1M8 17v-1M14 17v-1M16 17v-1"/>'),
  // curb: a kerb's units along a front edge, turning a corner, its foundation dashed behind
  curb: svg('<path d="M3 12h13v9M3 16h9v5"/><path d="M8 12v4M12 12v4M12 16l4-4"/><path d="M3 8h17v13" stroke-dasharray="2 2"/>'),
  // roadways: a straight section between curbs, a curved one, and a tee
  roadstraight: svg('<path d="M2 6h20M2 8h20M2 16h20M2 18h20"/><path d="M5 12h3M11 12h3M17 12h3"/>'),
  roadcurved: svg('<path d="M3 21A18 18 0 0 1 21 3"/><path d="M3 18A15 15 0 0 1 18 3"/><path d="M9 21A12 12 0 0 1 21 9"/><path d="M12 21A9 9 0 0 1 21 12"/>'),
  roadtee: svg('<path d="M2 4h20M2 6h20"/><path d="M2 13h4a3 3 0 0 1 3 3v6M22 13h-4a3 3 0 0 0-3 3v6"/>'),
  // roadway (poly): a road between its curbs bending along its centre line
  roadpoly: svg('<path d="M2 20l6-8h8l6-8"/><path d="M2 16l5-7h8l5-7M6 22l4-6h7l5-7"/>'),
  // parking area: an outline holding a row of angled stalls about a stripe
  parkingarea: svg('<path d="M3 4h18v16H3z"/><path d="M3 12h18M6 8l2 4 2 4M10 8l2 4 2 4M14 8l2 4 2 4"/>'),
  // parking along path: stalls standing either side of a bending path
  parkingpath: svg('<path d="M2 12l8-3 12 2"/><path d="M5 11V5M8 10V4M5 5h3M13 9.5V4M17 10V4M13 4h4M5 11v6M9 9.5v6M5 17h4M14 10v6M18 10.5v6M14 16h4"/>'),
  // stage deck: a deck in perspective on four legs
  stagedeck: svg('<path d="M2 9l5-4h15l-5 4z"/><path d="M2 9v3h15V9M17 12l5-4V5M4 12v7M15 12v7M20 10v6"/>'),
  // stage plug: an odd-shaped deck with a notch, its legs dashed under it
  stageplug: svg('<path d="M3 5h18v14h-7l-2-4-2 4H3z"/><circle cx="6" cy="8" r="1"/><circle cx="18" cy="8" r="1"/><circle cx="6" cy="16" r="1"/><circle cx="18" cy="16" r="1"/>'),
  // stage steps: a flight of treads in plan with an arrow up to the stage
  stagesteps: svg('<path d="M3 3h18M6 3v18h12V3M6 9h12M6 15h12"/><path d="M12 19V7M9.5 9.5L12 7l2.5 2.5"/>'),
  // stage ramp: a sloping deck up to a stage block
  stageramp: svg('<path d="M2 20h20M2 20l13-7h7v7M15 13v7"/><path d="M5 15l7-4"/>'),
  // soft goods: a pleated curtain hanging from a pipe
  softgoods: svg('<path d="M2 5h20"/><path d="M4 5v15M4 20q2 -1.5 4 0t4 0t4 0t4 0M20 5v15M8 5v15M12 5v15M16 5v15"/>'),
  // television: a flat screen on a stand
  television: svg('<path d="M2 4h20v12H2z"/><path d="M12 16v4M8 20h8"/>'),
  // video screen: a screen on goalpost legs, a projector throwing onto it
  videoscreen: svg('<path d="M3 3h18v11H3zM3 14v7M21 14v7"/><path d="M9 21h6v-3H9zM12 18l-6-4M12 18l6-4"/>'),
  // LED screen: a wall of modules in a grid
  ledscreen: svg('<path d="M2 4h20v14H2z"/><path d="M2 8.7h20M2 13.3h20M7 4v14M12 4v14M17 4v14"/><path d="M8 21h8"/>'),
  // speaker: a cabinet throwing its dispersion lines
  speaker: svg('<path d="M8 2h8v4H8z"/><path d="M10 6L3 19M14 6l7 13"/><path d="M5.5 14.5a10 10 0 0013 0"/>'),
  // speakerarray: a bumper with boxes hung under it, curving down
  speakerarray: svg('<path d="M5 2h14v2H5z"/><path d="M7 4h10v4H7zM7.5 8h9l-.5 4h-8zM8.5 12h7l-1.5 4h-4z"/><path d="M12 4v-2"/>'),
  // rackruler: a ruler's column beside a rack, ticked up its side
  rackruler: svg('<path d="M4 3h5v18H4z"/><path d="M9 6H7M9 9H6.5M9 12H7M9 15H6.5M9 18H7"/><path d="M13 3h7v18h-7zM13 8h7M13 13h7"/>'),
  // receptacle: a duplex outlet's circle, its lines down to the wall
  receptacle: svg('<path d="M3 21h18"/><circle cx="12" cy="9" r="6"/><path d="M10 3v18M14 3v18"/>'),
  // switch: an S struck through, off the wall
  switch: svg('<path d="M3 21h18"/><path d="M16 5.5c-1-1.5-6.5-2-7.5 1s7.5 3 7 6.5-6.5 3-8 .5"/><path d="M12 2v16"/>'),
  // comm device: a telephone's triangle on its stem
  commdevice: svg('<path d="M3 21h18"/><path d="M5 4h14l-7 10z"/><path d="M12 14v7"/>'),
  // straight truss: two chords laced corner to corner between end bars
  trussstraight: svg('<path d="M2 8h20M2 16h20M2 8v8M22 8v8"/><path d="M2 16l5-8 5 8 5-8 5 8"/>'),
  // curved truss: two concentric chords with bars across
  trusscurved: svg('<path d="M3 21a9 9 0 0118 0M7 21a5 5 0 0110 0"/><path d="M5.6 14.6l3.5 2.6M12 12v4M18.4 14.6l-3.5 2.6"/>'),
  // piping run: a conduit turning a corner, with couplings along it
  pipingrun: svg('<path d="M3 19h9a4 4 0 0 0 4-4V4"/><path d="M8 17v4M18 8h-4"/>'),
  hvacduct: svg('<path d="M2 8h20M2 16h20M6 8v8M18 8v8"/>'),
  hvacelbow: svg('<path d="M3 21V11a8 8 0 0 1 8-8h10M9 21v-9a3 3 0 0 1 3-3h9"/>'),
  hvacflex: svg('<path d="M3 16c4-10 8 4 12-3s3-8 6-8M3 21c6-9 9 3 14-4s2-7 4-7"/>'),
  hvacvertical: svg('<rect x="4" y="4" width="16" height="16"/><path d="M4 4l16 16M20 4L4 20"/>'),
  hvactransition: svg('<path d="M3 5l18 4v6L3 19z"/>'),
  hvacsplitter: svg('<path d="M2 8h6l8-6 5 5-6 5 6 5-5 5-8-6H2z"/>'),
  hvacdamper: svg('<rect x="3" y="7" width="18" height="10"/><path d="M8 17l8-10"/><circle cx="12" cy="12" r="1.5"/>'),
  hvacdiffuser: svg('<rect x="3" y="3" width="18" height="18"/><rect x="8" y="8" width="8" height="8"/><path d="M3 3l5 5M21 3l-5 5M3 21l5-5M21 21l-5-5"/>'),
  hvacoutlet: svg('<rect x="3" y="4" width="18" height="6"/><path d="M12 10v10M8 16l4 4 4-4"/>'),
  graticule: svg('<path d="M3 8h18M3 16h18"/><path d="M8 3c-1 6-1 12 0 18M16 3c1 6 1 12 0 18"/>'),
  greatcircle: svg('<path d="M4 18C7 8 17 8 20 18"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="18" r="1.5"/>'),
  surveypoint: svg('<circle cx="12" cy="12" r="5"/><path d="M12 3v18M3 12h18"/>'),
  gisstake: svg('<path d="M12 21l-5-9a6 6 0 1 1 10 0z"/><circle cx="12" cy="9" r="2"/>'),
  // lighting pipe: a pipe with end markers and tick marks along it
  lightingpipe: svg('<path d="M2 12h20"/><path d="M2 8v8M22 8v8M7 10v4M12 10v4M17 10v4"/>'),
  // lighting pipe ladder: two sides with rungs across
  pipeladder: svg('<path d="M6 3v18M18 3v18M6 7h12M6 12h12M6 17h12"/>'),
  // house rigging point: a square round a circle, crossed through its middle
  rigpoint: svg('<path d="M5 5h14v14H5z"/><circle cx="12" cy="12" r="4.5"/><path d="M5 12h14M12 5v14"/>'),
  // hoist: a motor's circle in quarters, two filled
  hoist: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4v16"/><path d="M12 12V4a8 8 0 00-8 8z" fill="currentColor" stroke="none"/><path d="M12 12v8a8 8 0 008-8z" fill="currentColor" stroke="none"/>'),
  // hoistorigin: a square round a circle, crossed, its name below
  hoistorigin: svg('<path d="M8 4h8v8H8z"/><circle cx="12" cy="8" r="2.2"/><path d="M12 1v14M5 8h14"/><path d="M6 20h12"/>'),
  // outlet: a spray head's square in its coverage circle
  outlet: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5h5v5h-5z" fill="currentColor"/>'),
  // drip outlet: a drip line snaking back and forth across its area
  dripoutlet: svg('<path d="M3 5h15a3 3 0 010 6H6a3 3 0 000 6h15"/>'),
  // blended screen: a wide screen, three projectors' cones overlapping on it
  blendedscreen: svg('<path d="M2 5h20"/><path d="M3 5l4 11 4-11M8 5l4 11 4-11M13 5l4 11 4-11"/>'),
  // irrigation pipe: a line, its flow arrowhead at the middle
  irrpipe: svg('<path d="M2 12h20"/><path d="M10 8l5 4-5 4z" fill="currentColor"/>'),
  // valve: a circle in quarters on a stub of pipe, two quarters filled
  valve: svg('<path d="M1 12h22M12 5v14"/><circle cx="12" cy="12" r="7"/><path d="M12 12V5a7 7 0 00-7 7z" fill="currentColor" stroke="none"/><path d="M12 12v7a7 7 0 007-7z" fill="currentColor" stroke="none"/>'),
  // point of connection: a union's two flanges across a pipe
  poc: svg('<path d="M2 12h20"/><path d="M8 6h3v12H8zM13 6h3v12h-3z"/>'),
  // controller: two solid triangles meeting point to point
  controller: svg('<path d="M5 4h14l-7 8zM12 12l7 8H5z" fill="currentColor"/>'),
  // system component: two solid triangles point to point on a pipe
  syscomponent: svg('<path d="M2 12h20"/><path d="M8 6h8l-4 6zM12 12l4 6H8z" fill="currentColor"/>'),
  // design zone: a zone's outline round its ID
  designzone: svg('<path d="M3 4h18v16H3z"/><path d="M9 9h6l-6 6h6"/>'),
  // hydrozone: an area's outline round a drop of water
  hydrozone: svg('<path d="M3 4h18v16H3z"/><path d="M12 7c2 3 3 4.5 3 6a3 3 0 01-6 0c0-1.5 1-3 3-6z"/>'),
  // bridle: two legs from the connection's square up to their rigging points' dots
  bridle: svg('<path d="M12 16L4 5M12 16l8-11"/><circle cx="4" cy="5" r="2" fill="currentColor"/><circle cx="20" cy="5" r="2" fill="currentColor"/><path d="M10 14h4v4h-4z" fill="currentColor"/>'),
  // mother grid: a truss with a hoist at each end and one in the middle
  mothergrid: svg('<path d="M6 10.5h12M6 13.5h12"/><circle cx="4" cy="12" r="2.5"/><circle cx="20" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/>'),
  // rigging load: a weight hanging from a bar
  riggingload: svg('<path d="M4 5h16M12 5v5"/><path d="M8.5 10h7l2.5 9h-12z"/>'),
  // cable path: a broad route with a rounded bend
  cablepath: svg('<path d="M3 19h6a6 6 0 006-6V5h6" stroke-width="3.5" opacity="0.45"/><path d="M3 19h6a6 6 0 006-6V5h6"/>'),
  // lighting device: a spotlight's housing and barrel, its channel bubble in front
  // hangingposition: a pipe with its lights, and its name below
  hangingposition: svg('<path d="M3 6h18M7 6v3M12 6v3M17 6v3M8 18h8"/><circle cx="7" cy="11" r="2"/><circle cx="12" cy="11" r="2"/><circle cx="17" cy="11" r="2"/>'),
  // lightaccessory: barn doors opening off a lamp
  lightaccessory: svg('<path d="M3 8h8v8H3zM11 9l8-4v14l-8-4"/><path d="M21 12h1"/>'),
  lightdevice: svg('<path d="M3 8h6v8H3zM9 9.5h7v5H9z"/><circle cx="19.5" cy="12" r="2"/>'),
  // stageorigin: the centre line crossing the plaster line
  stageorigin: svg('<path d="M12 3v18M3 15h18"/><circle cx="12" cy="15" r="2"/>'),
  // focusinstrument: a beam from a lamp to its hot spot
  focusinstrument: svg('<path d="M4 4l4 4M12 12l6 6"/><rect x="3" y="3" width="6" height="6" rx="1"/><ellipse cx="17" cy="17" rx="4" ry="3"/>'),
  // spikemark: a corner of tape on the floor
  spikemark: svg('<path d="M5 19V5h14"/><path d="M9 15l3-3M12 15l3-3"/>'),
  // ganging: two devices joined by a two-fer down to its numbered circle
  ganging: svg('<path d="M3 3h5v5H3zM16 3h5v5h-5z"/><path d="M5.5 8v6a3 3 0 003 3H10M18.5 8v6a3 3 0 01-3 3H14"/><circle cx="12" cy="17" r="2"/>'),
  // distributor: a box of numbered sockets in a row
  distributor: svg('<rect x="2" y="8" width="20" height="8" rx="1"/><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/>'),
  // electrical component: a drum on a square base, seen from above
  eleccomponent: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><circle cx="12" cy="12" r="5.5" fill="currentColor"/>'),
  // focus point: an octagon round the point, its name's line beside it
  photometer: svg('<circle cx="8" cy="10" r="4"/><path d="M8 10l2.5-2.5M5 16h6M13 6l3-3M16 11h4M14 15l3 3"/>'),
  photogrid: svg('<path d="M4 6h16v12H4z"/><circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="12" cy="10" r="1" fill="currentColor"/><circle cx="16" cy="10" r="1" fill="currentColor"/><circle cx="8" cy="14" r="1" fill="currentColor"/><circle cx="12" cy="14" r="1" fill="currentColor"/><circle cx="16" cy="14" r="1" fill="currentColor"/>'),
  equipmentkey: svg('<path d="M4 4h16v16H4zM4 9h16M9 14h7M9 17h7"/><circle cx="6.5" cy="14" r=".8" fill="currentColor"/><circle cx="6.5" cy="17" r=".8" fill="currentColor"/>'),
  focusalongpath: svg('<path d="M3 20c5-3 13-3 18 0"/><path d="M7 4l-2 13M12 4v13M17 4l2 13"/><rect x="5" y="2.5" width="4" height="2"/><rect x="10" y="2.5" width="4" height="2"/><rect x="15" y="2.5" width="4" height="2"/>'),
  // the 3D Modeling set's edit tools: a corner cut straight, a corner rounded, a hollowed box, a leaning side
  chamferedge: svg('<path d="M4 20V10l6-6h10v16z"/><path d="M4 10h6V4"/>'),
  filletedge: svg('<path d="M4 20v-9a7 7 0 0 1 7-7h9v16z"/>'),
  shellsolid: svg('<path d="M4 6h16v14H4z"/><path d="M8 6v10h8V6"/>'),
  pushpull: svg('<path d="M4 20h16v-6H4z"/><path d="M12 11V3"/><path d="m9 6 3-3 3 3"/>'),
  offsetedge: svg('<path d="M4 20V4h16"/><path d="M9 20V9h11" stroke-dasharray="2 2"/>'),
  deform: svg('<path d="M7 21c3-3-2-6 1-9s-1-6 1-9"/><path d="M17 21c3-3-2-6 1-9s-1-6 1-9"/><path d="M7 21h10"/><path d="M9 3h10"/>'),
  taperface: svg('<path d="M3 20h18"/><path d="M7 20 9.5 5h5L17 20"/>'),
  // a polygon rising from a plane
  locus3d: svg('<path d="M12 4v16"/><path d="M4 12h16"/><path d="M6.5 17.5l11-11"/>'),
  extract: svg('<path d="M4 9v11h11"/><path d="M4 9l5-5h11v11l-5 5"/><path d="M15 9v11"/><path d="M4 9h11"/><circle cx="20" cy="4" r="1.5"/>'),
  project: svg('<path d="M7 3h10l-3 5H10z"/><path d="M12 8v7"/><path d="m9.5 13 2.5 2.5 2.5-2.5"/><path d="M3 19c4-3 14-3 18 0"/><path d="M3 21h18"/>'),
  analysis: svg('<path d="M3 18c4-9 10-13 18-14"/><circle cx="9" cy="15" r="5"/><path d="m9 7 8 3"/><path d="M9 10.5v-3"/>'),
  poly3d: svg('<path d="M4 19 9 6l6 3 5-5v13l-7 3z"/><path d="M9 6v8l6-5"/>'),
  // two sections and the surface between them
  loftsurface: svg('<ellipse cx="12" cy="5.5" rx="4" ry="2"/><ellipse cx="12" cy="18.5" rx="8" ry="2.5"/><path d="M8 5.5 4 18.5M16 5.5l4 13"/>'),
  // a block laid on a plane: an arrow down onto it
  // ccdevice: a device's box with an input in at the left and an output out at the right
  ccdevice: svg('<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M6 9l3 1.5L6 12zM18 9l-3 1.5 3 1.5zM8 6.5h8"/>'),
  // ccdevicebuilder: a device's box with socket rows and a plus for one more
  ccdevicebuilder: svg('<rect x="4" y="4" width="11" height="16" rx="1"/><path d="M4 8h3M4 11h3M15 8h-3M15 11h-3M19 14v6M16 17h6"/>'),
  // ccexternal: a box pointed at its left end, an output out at its right
  ccexternal: svg('<path d="M8 6h12v12H8l-5-6z"/><path d="M20 10.5l-3 1.5 3 1.5z"/>'),
  // ccda: a box with one input in at its left and three outputs out at its right
  ccda: svg('<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M6 10.5l3 1.5-3 1.5zM18 5.5l-3 1.5 3 1.5zM18 10.5l-3 1.5 3 1.5zM18 15.5l-3 1.5 3 1.5z"/>'),
  // cctermpanel: a small box with a line straight through it, a socket at each end
  cctermpanel: svg('<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M2 12h20M7 10.5 9.5 12 7 13.5z"/>'),
  // ccjack: a jack pair: two round jacks one above the other on a panel
  ccjack: svg('<rect x="5" y="3" width="14" height="18" rx="1"/><circle cx="12" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/>'),
  // cclinkedjack: a jack pair joined by a link down its side
  cclinkedjack: svg('<rect x="5" y="3" width="14" height="18" rx="1"/><circle cx="11" cy="8" r="2.5"/><circle cx="11" cy="16" r="2.5"/><path d="M13.5 8h2.5v8h-2.5"/>'),
  // ccconnectorpanel: a facilities box plate with one round connector and a line wired through it
  ccconnectorpanel: svg('<rect x="6" y="5" width="12" height="14" rx="1.5"/><circle cx="12" cy="12" r="3.5"/><path d="M2 12h4.5M17.5 12H22"/>'),
  // ccadapter: a small box on a device's edge, two sockets out of its far side
  ccadapter: svg('<path d="M6 3v18"/><rect x="8" y="7" width="8" height="10" rx="1"/><path d="M16 8.5l3 1.5-3 1.5zM16 13l3 1.5-3 1.5z"/>'),
  // ccreroute: three circuits running side by side round a corner
  ccreroute: svg('<path d="M3 5h13v15M3 9h9v11M3 13h5v7"/>'),
  // ccsocket: a socket's triangle on a box's edge, with a plus
  ccsocket: svg('<path d="M9 3v18"/><path d="M9 9l5 3-5 3z"/><path d="M17 5v6M14 8h6"/>'),
  // ccsocketloop: two input triangles on a box's edge joined by a loop outside it
  ccsocketloop: svg('<path d="M14 3v18"/><path d="M14 7l3 1.5-3 1.5zM14 14l3 1.5-3 1.5z"/><path d="M14 8.5c-4 0-6 1.5-6 3.5s2 3.5 6 3.5"/>'),
  // ccterminator: a socket closed off by a small block outside the box
  ccterminator: svg('<path d="M14 3v18"/><path d="M14 9l-4 3 4 3z"/><rect x="15.5" y="10" width="4" height="4"/>'),
  // ccconnect: two boxes joined by a squared circuit
  ccconnect: svg('<rect x="2" y="3" width="6" height="8" rx="1"/><rect x="16" y="13" width="6" height="8" rx="1"/><path d="M8 7h4v10h4"/>'),
  // cclegend: a key's box, two rows of a line sample and its name
  // cclayoutroom: a room's outline with its ID in the top left and a rack inside
  cclayoutroom: svg('<path d="M3 4h18v16H3z"/><path d="M6 7h5" stroke-width="1"/><rect x="13" y="11" width="5" height="6"/>'),
  // ccrack: a rack standing, its posts and two units of equipment in it
  ccrack: svg('<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M8 2v20M16 2v20"/><rect x="8" y="6" width="8" height="3" stroke-width="1"/><rect x="8" y="11" width="8" height="3" stroke-width="1"/>'),
  // ccequip: a unit of equipment from the front, its ears with holes and a row of controls
  ccequip: svg('<rect x="2" y="8" width="20" height="8" rx="1"/><path d="M5 8v8M19 8v8"/><circle cx="3.5" cy="12" r="0.6"/><circle cx="20.5" cy="12" r="0.6"/><path d="M8 12h2M12 12h2M16 12h1" stroke-width="1.5"/>'),
  // ccrackframe: a frame three units tall from the front, its ears and four modules side by side in it
  // ccadapterslot: a unit from the front, its ears, a slot with a card in it and an empty one crossed
  ccadapterslot: svg('<rect x="2" y="7" width="20" height="10" rx="1"/><path d="M5 7v10M19 7v10"/><rect x="7" y="9.5" width="5" height="5" stroke-width="1.2"/><path d="M8.5 12h2" stroke-width="1.2"/><rect x="13" y="9.5" width="4" height="5" stroke-width="1.2"/><path d="M13 9.5l4 5M17 9.5l-4 5" stroke-width="1"/>'),
  ccrackframe: svg('<rect x="2" y="5" width="20" height="14" rx="1"/><path d="M5 5v14M19 5v14"/><path d="M8.5 8v8M12 8v8M15.5 8v8" stroke-width="1"/><path d="M5 8h14M5 16h14" stroke-width="1"/>'),
  // ccrackws: a worksheet's grid beside a rack with a unit in it
  ccrackws: svg('<rect x="2" y="4" width="13" height="16" rx="1"/><path d="M2 9h13M2 14h13M7 4v16" stroke-width="1"/><rect x="17" y="4" width="5" height="16" rx="0.5"/><path d="M17 10h5" stroke-width="1"/>'),
  // cccableroute: a cable path turning a corner, a ring where it rises, on to a drop point's box
  cccableroute: svg('<path d="M3 19V9h9v-4h6"/><circle cx="12" cy="9" r="1.6" stroke-width="1"/><rect x="18" y="2" width="4" height="6" stroke-width="1.2"/>'),
  // cceditcabling: a cable path with a list of circuits over it
  cceditcabling: svg('<path d="M2 20h8v-6h12"/><rect x="11" y="2" width="11" height="9" rx="1" stroke-width="1.2"/><path d="M13 5h7M13 8h7" stroke-width="1"/>'),
  // ccpanelconnector: a D-series flange with an XLR's round cutout and its three pins
  ccpanelconnector: svg('<rect x="5" y="2.5" width="14" height="19" rx="1"/><circle cx="12" cy="12" r="5"/><circle cx="10" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="14" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="14.3" r=".9" fill="currentColor" stroke="none"/>'),
  // cclabelcolor: a label with a row of three colour bands, the first filled
  cclabelcolor: svg('<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><rect x="5" y="9" width="4.5" height="6" fill="currentColor" stroke="none"/><rect x="9.75" y="9" width="4.5" height="6"/><rect x="14.5" y="9" width="4.5" height="6"/>'),
  // cclabelqr: a QR code's three finder squares and a few modules
  cclabelqr: svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 19h2M19 14h2" /><rect x="5.5" y="5.5" width="2" height="2" fill="currentColor" stroke="none"/><rect x="16.5" y="5.5" width="2" height="2" fill="currentColor" stroke="none"/><rect x="5.5" y="16.5" width="2" height="2" fill="currentColor" stroke="none"/>'),
  // ccdroppoint: a drop point's box with its cross, and its letter beside
  ccdroppoint: svg('<rect x="3" y="7" width="10" height="10"/><path d="M5 9l6 6M11 9l-6 6" stroke-width="1"/><path d="M16 17l2.5-8 2.5 8M17 14h3" stroke-width="1.2"/>'),
  cclegend: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M6 10h5M6 15h5"/><path d="M13 10h5M13 15h4" stroke-width="1"/>'),
  videocamera: svg('<rect x="6" y="5" width="10" height="7" rx="1"/><path d="M16 7.5l4-2v6l-4-2M11 12v3M11 15l-5 6M11 15l5 6M11 15v6"/>'),
  alignplane: svg('<path d="M2 19l5-5h15l-5 5z"/><path d="M10 3h5v6h-5z"/><path d="M12.5 9v4"/><path d="m10.5 11 2 2 2-2"/>'),
  focuspoint: svg('<path d="M7 3.5h5l3.5 3.5v5L12 15.5H7L3.5 12V7z"/><circle cx="9.5" cy="9.5" r="1" fill="currentColor"/><path d="M15 20h6"/>'),
  // align and distribute: three fixtures set evenly along a guide line
  aligndistribute: svg('<path d="M3 15h18"/><rect x="3.5" y="7" width="3" height="5" rx="1"/><rect x="10.5" y="7" width="3" height="5" rx="1"/><rect x="17.5" y="7" width="3" height="5" rx="1"/><path d="M5 12v3M12 12v3M19 12v3"/>'),
  // cable: a line with a connector chevron along it and a plug at its end
  cable: svg('<path d="M3 18c5 0 6-12 12-12h3"/><path d="M6.5 13.5l2.5 1.2-.4-2.7"/><path d="M18 3.5h3v5h-3z" fill="currentColor"/>'),
  // hopover: a level line hopping in a half circle over an upright one
  hopover: svg('<path d="M12 3v18"/><path d="M3 14h5.5a3.5 3.5 0 017 0H21"/>'),
  // incandescent fixture: a lamp's circle, a down light's diagonal across it
  incandescent: svg('<circle cx="12" cy="12" r="8"/><path d="M6.3 6.3l11.4 11.4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>'),
  // rope and stanchion: posts on bases with ropes sagging between them
  ropestanchion: svg('<path d="M5 6v13M12 6v13M19 6v13M3 19h4M10 19h4M17 19h4"/><path d="M5 8q3.5 4 7 0q3.5 4 7 0"/><circle cx="5" cy="5" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/>'),
  // plant: a scalloped canopy round a trunk
  plant: svg('<path d="M12 3.5a3 3 0 014.6 1.9 3 3 0 013.5 4.2 3 3 0 010 4.8 3 3 0 01-3.5 4.2 3 3 0 01-4.6 1.9 3 3 0 01-4.6-1.9 3 3 0 01-3.5-4.2 3 3 0 010-4.8 3 3 0 013.5-4.2A3 3 0 0112 3.5z"/><circle cx="12" cy="12" r="1.2"/><path d="M9.5 12h5M12 9.5v5"/>'),
  // chamfer: a corner cut off by a diagonal
  chamfer: svg('<path d="M4 20V10l6-6h10"/><path d="M4 10l6-6" stroke-dasharray="2 2"/>'),
  // double line: two parallel strokes
  doubleline: svg('<path d="M3 9h18M3 15h18"/>'),
  // double line polygon: a square inside a square
  dlpolygon: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="0.5"/><rect x="8" y="8" width="8" height="8" rx="0.5"/>'),
  // regular polygon: a hexagon
  regpoly: svg('<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>'),
  // freehand: a loose curve
  freehand: svg('<path d="M3 17c3-6 5 2 8-4s5-6 10-3"/>'),
  // oval: an ellipse
  oval: svg('<ellipse cx="12" cy="12" rx="9" ry="6"/>'),
  roundrect: svg('<rect x="4" y="6" width="16" height="12" rx="4"/>'),
  // spiral: two and a half loops out from the centre
  spiral: svg('<path d="M12 12c0-1 1.5-1.5 2-0.5s-0.5 3-2.5 3-3.5-2-3-4 3-3.5 5-3 4 3 3.5 5.5-3.5 5-6.5 5-6-3-6-6 2.5-7.5 6.5-7.5"/>'),
  // move by points: a dashed square carried along an arrow to a solid one
  moveby: svg('<rect x="3" y="13" width="7" height="7" stroke-dasharray="2 2"/><rect x="14" y="4" width="7" height="7"/><path d="M8 16l7-7M11 9h4v4"/>'),
  // zoom: a magnifier
  zoom: svg('<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20M10 7v6M7 10h6"/>'),
  // extruded rectangle: a box standing on its footprint
  extrect: svg('<path d="M4 9l5-4h11v10l-5 4H4z"/><path d="M4 9h11v10M15 9l5-4"/>'),
  // extruded polygon: a pentagonal prism
  extpoly: svg('<path d="M4 9l4-4h9l3 4v8l-3 3H8l-4-3z"/><path d="M4 9h16M8 9v11M17 9v11"/>'),
  // sphere: a ball with its equator
  sphere: svg('<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="2.8"/>'),
  // hemisphere: a dome on its base
  hemisphere: svg('<path d="M4 16a8 8 0 0116 0"/><ellipse cx="12" cy="16" rx="8" ry="2.5"/>'),
  // cone: a point over an elliptical base
  cone: svg('<path d="M12 3.5L4.5 17M12 3.5L19.5 17"/><ellipse cx="12" cy="17" rx="7.5" ry="2.8"/>'),
};

/** Bar and palette icons. */
export const UI_ICON = {
  open: svg('<path d="M3.5 7.5V18a1 1 0 001 1h15a1 1 0 001-1V9.5a1 1 0 00-1-1h-7.2L10.5 6h-6a1 1 0 00-1 1.5z"/>'),
  save: svg('<path d="M5 4h11l3 3v12a1 1 0 01-1 1H6a1 1 0 01-1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>'),
  // fit: corners closing on the drawing
  fit: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>'),
  zoomIn: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>'),
  zoomOut: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>'),
  // zoom to the selection: a dashed box with a magnifier
  zoomSel: svg('<rect x="3.5" y="3.5" width="11" height="11" stroke-dasharray="2 2"/><circle cx="15" cy="15" r="3.5"/><path d="M17.6 17.6L21 21"/>'),
  plan: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h9M13 4v16"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  snapObjects: svg('<path d="M5 19L19 5"/><circle cx="12" cy="12" r="3.2"/>'),
  gridShow: svg('<path d="M4 9h16M4 15h16M9 4v16M15 4v16"/>'),
  snapGrid: svg('<path d="M4 9h16M4 15h16M9 4v16M15 4v16" opacity="0.45"/><circle cx="15" cy="9" r="2.4" fill="currentColor"/>'),
  dims: svg('<path d="M4 7v10M20 7v10"/><path d="M4 12h16"/><path d="M7 9l-3 3 3 3M17 9l3 3-3 3"/>'),
  insertion: svg('<rect x="4" y="4" width="10" height="10" rx="1.5"/><path d="M14 14l6 6M17 20h3v-3"/>'),
  layers: svg('<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>'),
  // a class: a tag
  classes: svg('<path d="M4 4.5h7.5l8.5 8.5-7 7-8.5-8.5z"/><circle cx="8.5" cy="9" r="1.6"/>'),
  // a render mode: a half-shaded sphere
  render: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor" fill-opacity="0.3" stroke="none"/><path d="M4.5 10c4.5 2 10.5 2 15 0" opacity="0.55"/>'),
  // a saved view: a bookmark
  savedViews: svg('<path d="M7 4h10v16l-5-3.6L7 20z"/>'),
  // a standard view: an eye on a cube's corner
  // projection: a box drawn in perspective, its far face smaller
  projection: svg('<path d="M3 7h11v11H3z"/><path d="M14 7l6-3v11l-6 3M3 7l6-3h11" opacity="0.6"/>'),
  standardViews: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" opacity="0.5"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  // view panes: the drawing area in two
  viewPanes: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M12 5v14"/>'),
  // Exit Group: an arrow out of a box
  exitGroup: svg('<path d="M14 4.5h4.5a1 1 0 011 1v13a1 1 0 01-1 1H14"/><path d="M9.5 8l-4 4 4 4M5.5 12H15"/>'),
  // the active plane: a plane seen at a slant, with its two axes from a corner
  workingPlane: svg('<path d="M3 16l6-9h12l-6 9z"/><path d="M9 7v-3M9 7l-3 4.5" opacity="0.6"/>'),
  // Quick Preferences: three sliders
  quickPrefs: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
  caret: svg('<path d="M8 10l4 4 4-4"/>'),
  // Spline's menu button: two bars
  menu: svg('<path d="M5 9h14M5 15h14"/>'),
  // the Notification Center: a bell
  bell: svg('<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  // more options: three dots
  more: svg('<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>'),
  // tool preferences: a pencil over a sheet, as the mode bar's preferences button
  prefs: svg('<path d="M5 4h9l4 4v5"/><path d="M5 4v16h6"/><path d="M19.5 14.5l-6 6H11v-2.5l6-6z"/>'),
};

/** The palettes' icons in the docks' rails. */
export const PALETTE_ICON = {
  // the Basic palette: tools in a two-column grid
  tools: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>'),
  // Tool Sets: a row of set tabs over the tools
  toolSets: svg('<path d="M4 8V5.5A1.5 1.5 0 015.5 4H9v4M9 4h6v4"/><rect x="4" y="8" width="16" height="12" rx="1.5"/><path d="M8 12h2M14 12h2M8 16h2M14 16h2"/>'),
  // Navigation: a compass
  navigation: svg('<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  // Resources: books on a shelf
  resources: svg('<path d="M4 20h16"/><rect x="5" y="5" width="3.5" height="15" rx="0.6"/><rect x="9.5" y="7.5" width="3.5" height="12.5" rx="0.6"/><path d="M14.6 8.3l3.3-1 3 12.6-3.3 0.9z"/>'),
  // Object Info: an information mark
  objectInfo: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.6" fill="currentColor"/>'),
  // Attributes: a filled swatch under a pen stroke
  attributes: svg('<rect x="4" y="9" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity="0.25"/><path d="M9 15L19 5"/><path d="M17 4.5l2.5 2.5"/>'),
  // Snapping: a magnet
  snapping: svg('<path d="M5 4h4v7a3 3 0 006 0V4h4v7a7 7 0 01-14 0z"/><path d="M5 7.5h4M15 7.5h4"/>'),
  // Visualization: a light bulb
  visualization: svg('<path d="M9 17.5h6M10 20.5h4"/><path d="M8.5 14.5a6 6 0 117 0c-.7.6-1 1.3-1 2v1h-5v-1c0-.7-.3-1.4-1-2z"/>'),
  // Working Planes: a plane at a slant with its axes
  workingPlanes: svg('<path d="M3 16l6-9h12l-6 9z"/><path d="M9 7v-3M9 7l-3 4.5" opacity="0.6"/>'),
  // Collaborators: two people
  people: svg('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0111 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.2a4.5 4.5 0 015 4.8"/>'),
  // Crit: a speech bubble with a mark in it
  crit: svg('<path d="M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1h-8l-4 3.5V16H5a1 1 0 01-1-1V6a1 1 0 011-1z"/><path d="M9 10.5l2 2 4-4"/>'),
  // Version History: a clock turned back
  history: svg('<path d="M4.5 12a7.5 7.5 0 101.8-4.9"/><path d="M4 4.5v3.2h3.2"/><path d="M12 8v4.5l3 1.8"/>'),
};

/** The tabs of the tabbed palettes (Object Info's, Navigation's), shown as Tab Style has them. */
export const TAB_ICON = {
  // Shape: a box with its handles
  shape: svg('<path d="M6 6h12v12H6z"/><path d="M4.5 4.5h3v3h-3zM16.5 4.5h3v3h-3zM4.5 16.5h3v3h-3zM16.5 16.5h3v3h-3z" fill="currentColor"/>'),
  // Data: a record's fields
  data: svg('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M9.5 9v11M12.5 12.5h4.5M12.5 16h4.5"/>'),
  render: UI_ICON.render,
  layers: UI_ICON.layers,
  classes: UI_ICON.classes,
  // Stories: a building's floors
  stories: svg('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 9h14M5 15h14"/><path d="M10.5 21v-3h3v3"/>'),
  // Sheet layers: a sheet with its title block
  sheets: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M14.5 19v-4.5H21M14.5 16.8H21"/>'),
  // Viewports: a sheet with a view framed on it
  viewports: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><rect x="6.5" y="8" width="11" height="8" stroke-dasharray="2 1.5"/>'),
  views: UI_ICON.savedViews,
  lights: TOOL_ICON.light,
  cameras: TOOL_ICON.camera,
};

/** Snapping palette icons. */
export const SNAP_ICON = {
  // a magnet: snapping to objects at all
  objects: svg('<path d="M5 4h4v7a3 3 0 006 0V4h4v7a7 7 0 01-14 0z"/><path d="M5 7.5h4M15 7.5h4"/>'),
  end: svg('<path d="M4 20L15.5 8.5"/><rect x="15" y="3" width="6" height="6" fill="currentColor" fill-opacity="0.3"/>'),
  mid: svg('<path d="M4 20L20 4"/><path d="M3 17l4 4M17 3l4 4"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>'),
  center: svg('<circle cx="12" cy="12" r="8"/><path d="M12 9v6M9 12h6"/>'),
  intersection: svg('<path d="M4 4l16 16M20 4L4 20"/><circle cx="12" cy="12" r="3.2"/>'),
  // a point on a curve
  nearest: svg('<path d="M4 18c3-8 13-8 16 0"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>'),
  // a line touching a circle: tangents (and perpendiculars)
  tangent: svg('<circle cx="12" cy="14.5" r="5.5"/><path d="M3 9h18"/>'),
  // a point with dashed guides running from it: smart points
  smart: svg('<circle cx="7" cy="7" r="2.6" fill="currentColor" stroke="none"/><path d="M7 11.5V21M11.5 7H21" stroke-dasharray="2.2 2.2"/>'),
};

const EYE = '<path d="M2.5 12S5.8 6.5 12 6.5 21.5 12 21.5 12 18.2 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>';

export function visibilityIcon(v: Visibility): string {
  if (v === "visible") return svg(EYE);
  if (v === "grayed") return svg(`<g opacity="0.4">${EYE}</g>`);
  return svg(`${EYE}<path d="M4 4l16 16"/>`);
}

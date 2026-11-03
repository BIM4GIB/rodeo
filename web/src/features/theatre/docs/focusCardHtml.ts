// The focus cards as HTML: each card's plan (its CL and PL, the hanging point, the focus with its pools
// sized true to the throw and aim, a performer's mark and the distances from CL and PL) and its QR code,
// laid out for A4 or Letter with six a page. The preview and the printed sheet are this same markup, so
// the preview matches the print. Every value is escaped here. The CSS is focusCards.css, added by the caller.

import { moduleRects, qrModules } from "../../../app/qrCode.ts";
import type { FocusCard } from "./focusCards.ts";

export type Paper = "A4" | "Letter";

const PER_PAGE = 6;
/** the plan's drawing area, mm (the viewBox is this square; the card sets its size) */
const PLAN = 36;
/** the drawing's usable square inside the plan, mm */
const INSIDE = 29;
/** a performer's plan mark, diameter mm */
const PERSON_MM = 500;
/** the QR code's quiet zone, in modules */
const QUIET = 4;
const DEG = Math.PI / 180;

const ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text safe in HTML and in SVG. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** The card's plan, as an SVG. Upstage is at the top and stage left at the right, as the audience sees the stage. */
export function planSvg(c: FocusCard): string {
  const f = c.focus;
  // the area to show: the hanging point and the focus, the performer and the pools
  const pts = [{ across: c.hang.across, up: c.hang.up, r: 0 }];
  let pools: { ex: number; ey: number; major: number; minor: number }[] = [];
  if (f && c.beam) {
    const dx = f.across - c.hang.across;
    const du = f.up - c.hang.up;
    const len = Math.hypot(dx, du) || 1;
    const ux = dx / len;
    const uy = du / len;
    const sinE = Math.sin(Math.max(c.beam.elevationDeg, 0) * DEG);
    pools = sinE > 0.02
      ? [c.beam.fieldMm, c.beam.beamMm].map((diameter) => {
          const minor = diameter / 2;
          const major = minor / sinE;
          // the half extents of a tilted ellipse, axis-aligned
          const ex = Math.hypot(major * ux, minor * uy);
          const ey = Math.hypot(major * uy, minor * ux);
          return { ex, ey, major, minor };
        })
      : [];
    pts.push({ across: f.across, up: f.up, r: PERSON_MM / 2 });
    for (const p of pools) pts.push({ across: f.across + p.ex, up: f.up + p.ey, r: 0 }, { across: f.across - p.ex, up: f.up - p.ey, r: 0 });
  } else {
    pts.push({ across: c.hang.across - 1500, up: c.hang.up - 1500, r: 0 }, { across: c.hang.across + 1500, up: c.hang.up + 1500, r: 0 });
  }
  const lo = { across: Math.min(...pts.map((p) => p.across - p.r)), up: Math.min(...pts.map((p) => p.up - p.r)) };
  const hi = { across: Math.max(...pts.map((p) => p.across + p.r)), up: Math.max(...pts.map((p) => p.up + p.r)) };
  // at least 3 m across, with room to spare, and the same scale both ways
  const w = Math.max(hi.across - lo.across, 3000) * 1.15;
  const h = Math.max(hi.up - lo.up, 3000) * 1.15;
  const k = INSIDE / Math.max(w, h);
  const ca = (lo.across + hi.across) / 2;
  const cu = (lo.up + hi.up) / 2;
  const X = (across: number): number => PLAN / 2 + (across - ca) * k;
  const Y = (up: number): number => PLAN / 2 - (up - cu) * k;
  const inView = (v: number): boolean => v >= 0 && v <= PLAN;
  const out: string[] = [];
  out.push(`<rect x="0.15" y="0.15" width="${PLAN - 0.3}" height="${PLAN - 0.3}" fill="none" stroke="#000" stroke-width="0.25"/>`);
  const x0 = X(0);
  const y0 = Y(0);
  if (inView(x0)) {
    out.push(`<line x1="${n(x0)}" y1="0" x2="${n(x0)}" y2="${PLAN}" stroke="#000" stroke-width="0.15" stroke-dasharray="1 0.8"/>`);
    out.push(`<text x="${n(x0 + 0.7)}" y="3.4" font-size="2.2">CL</text>`);
  }
  if (inView(y0)) {
    out.push(`<line x1="0" y1="${n(y0)}" x2="${PLAN}" y2="${n(y0)}" stroke="#000" stroke-width="0.15" stroke-dasharray="1 0.8"/>`);
    out.push(`<text x="${PLAN - 0.8}" y="${n(y0 - 0.7)}" font-size="2.2" text-anchor="end">PL</text>`);
  }
  out.push(`<text x="0.9" y="2.6" font-size="1.9">Upstage</text>`);
  const hx = X(c.hang.across);
  const hy = Y(c.hang.up);
  if (f && c.beam) {
    const fx = X(f.across);
    const fy = Y(f.up);
    out.push(`<line x1="${n(hx)}" y1="${n(hy)}" x2="${n(fx)}" y2="${n(fy)}" stroke="#000" stroke-width="0.2" stroke-dasharray="0.8 0.6"/>`);
    const [field, beam] = pools;
    if (field) {
      const turn = Math.atan2(-(f.up - c.hang.up), f.across - c.hang.across) / DEG;
      out.push(
        `<ellipse cx="${n(fx)}" cy="${n(fy)}" rx="${n(field.major * k)}" ry="${n(field.minor * k)}" transform="rotate(${n(turn)} ${n(fx)} ${n(fy)})" fill="none" stroke="#000" stroke-width="0.25" stroke-dasharray="1 0.6"/>`,
      );
      out.push(
        `<ellipse cx="${n(fx)}" cy="${n(fy)}" rx="${n(beam!.major * k)}" ry="${n(beam!.minor * k)}" transform="rotate(${n(turn)} ${n(fx)} ${n(fy)})" fill="#000" fill-opacity="0.14" stroke="#000" stroke-width="0.35"/>`,
      );
    }
    out.push(`<circle cx="${n(fx)}" cy="${n(fy)}" r="${n((PERSON_MM / 2) * k)}" fill="#fff" stroke="#000" stroke-width="0.25"/>`);
    out.push(`<circle cx="${n(fx)}" cy="${n(fy)}" r="0.45" fill="#000"/>`);
    if (inView(x0)) {
      out.push(`<line x1="${n(x0)}" y1="${n(fy)}" x2="${n(fx)}" y2="${n(fy)}" stroke="#000" stroke-width="0.15" stroke-dasharray="0.4 0.6"/>`);
      out.push(`<text x="${n((x0 + fx) / 2)}" y="${n(fy - 0.7)}" font-size="1.9" text-anchor="middle">${esc(c.acrossText)}</text>`);
    }
    if (inView(y0)) {
      out.push(`<line x1="${n(fx)}" y1="${n(y0)}" x2="${n(fx)}" y2="${n(fy)}" stroke="#000" stroke-width="0.15" stroke-dasharray="0.4 0.6"/>`);
      out.push(`<text x="${n(fx + 0.7)}" y="${n((y0 + fy) / 2)}" font-size="1.9">${esc(c.upText)}</text>`);
    }
  }
  out.push(`<circle cx="${n(hx)}" cy="${n(hy)}" r="0.7" fill="#000"/>`);
  return `<svg viewBox="0 0 ${PLAN} ${PLAN}" role="img" aria-label="Plan of ${esc(c.title)}">${out.join("")}</svg>`;
}

/** The QR code of `text` as an SVG, with its quiet zone; "" when the text is too long for one. */
export function qrSvg(text: string): string {
  const dark = qrModules(text);
  if (!dark) return "";
  const size = dark.length + 2 * QUIET;
  const d = moduleRects(dark)
    .map((r) => `M${r.x + QUIET} ${r.y + QUIET}h${r.w}v${r.h}h-${r.w}z`)
    .join("");
  return `<svg viewBox="0 0 ${size} ${size}" role="img"><title>${esc(text)}</title><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** One card's markup. */
export function cardHtml(c: FocusCard): string {
  const facts: [string, string][] = [
    ["Channel", c.channel],
    ["Patch", c.patch],
    ["Colour", c.colour],
    ["Gobo", c.gobo],
    ["Purpose", c.purpose],
    ["Hung at", c.hungAt],
    ["Lens", c.lens],
  ];
  const spot = c.focused
    ? `<div class="docs-spot">${esc(c.hotSpot)}</div><div class="docs-sub">Throw ${esc(c.throwText)}</div><div class="docs-sub">Field pool ${esc(c.fieldText)}, beam pool ${esc(c.beamText)}</div>`
    : `<div class="docs-spot"><span class="th-warn docs-unfocused">Not focused yet</span></div>`;
  return `<div class="docs-card">
<div class="docs-head"><div class="docs-title">${esc(c.title)}</div><div class="docs-sub">${esc(c.type)}</div></div>
<div class="docs-mid"><div class="docs-facts">${facts.map(([k, v]) => `<span class="docs-k">${esc(k)}</span><span class="docs-v">${v ? esc(v) : "-"}</span>`).join("")}</div><div class="docs-plan">${planSvg(c)}</div></div>
<div class="docs-foot"><div class="docs-qr">${qrSvg(c.qr)}</div><div class="docs-spotbox"><div class="docs-label">Hot spot</div>${spot}</div></div>
</div>`;
}

/** The cards in one wrapped grid: the preview. */
export function gridHtml(cards: readonly FocusCard[]): string {
  return `<div class="docs-grid">${cards.map(cardHtml).join("")}</div>`;
}

/** The cards as printed pages of six each. */
export function pagesHtml(cards: readonly FocusCard[]): string {
  const pages: string[] = [];
  for (let i = 0; i < cards.length; i += PER_PAGE) pages.push(`<div class="docs-page">${cards.slice(i, i + PER_PAGE).map(cardHtml).join("")}</div>`);
  return pages.join("\n");
}

/** The page's rules for printing: the paper, the margins, and a break after each page of cards. */
function pageCss(paper: Paper): string {
  return `@page { size: ${paper === "A4" ? "A4" : "letter"}; margin: 10mm; }
html, body { margin: 0; background: #fff; color: #000; }
.docs-page:not(:last-child) { break-after: page; page-break-after: always; }
@media screen { body { padding: 10mm; } .docs-page { margin-bottom: 8mm; } }`;
}

/** A standalone HTML document of the cards on `paper`, with `css` (focusCards.css) for their look; it prints as the preview does. */
export function sheetDocument(cards: readonly FocusCard[], paper: Paper, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Focus Cards</title>
<style>
${pageCss(paper)}
${css}
</style>
</head>
<body class="docs-paper-${paper}">
${pagesHtml(cards)}
</body>
</html>
`;
}

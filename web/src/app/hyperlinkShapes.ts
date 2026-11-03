// What Dims/Notes' Hyperlink tool (tools/hyperlink.ts) draws, as plain geometry in mm on its
// insertion point. Vectorworks draws a hyperlink from a symbol whose #Hyperlinktext# shows its label;
// this draws a chain link with the label beside it, starting at the point. A QR code is its modules
// centred on the point on a white square: the code with a margin four modules wide, the image width
// across. Its dark modules are one keyhole polygon, each rectangle reached along a bridge that's
// walked back again, so the bridges enclose nothing and the code is a single object. Kept apart from
// the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import type { MarkerText } from "./markerShapes.ts";
import { moduleRects, qrModules } from "./qrCode.ts";

/** a QR code's light margin, in modules, as the standard asks */
export const QUIET_MODULES = 4;
/** points round each end of a chain link */
const LINK_STEPS = 10;

export interface HyperlinkDrawing {
  /** the chain link's two loops */
  readonly links: Pt[][];
  readonly texts: MarkerText[];
  /** a QR code's white square and its dark modules */
  readonly qr: { readonly back: Pt[]; readonly dark: Pt[] } | null;
}

/** A loop round a link: `half` along `u` each side of `c` to its ends' centres, `r` its ends' radius. */
function loop(c: Pt, u: Pt, half: number, r: number): Pt[] {
  const t = Math.atan2(u.y, u.x);
  const end = (o: Pt, from: number): Pt[] =>
    Array.from({ length: LINK_STEPS + 1 }, (_, i) => {
      const g = from + (Math.PI * i) / LINK_STEPS;
      return { x: o.x + r * Math.cos(g), y: o.y + r * Math.sin(g) };
    });
  return [...end({ x: c.x + half * u.x, y: c.y + half * u.y }, t - Math.PI / 2), ...end({ x: c.x - half * u.x, y: c.y - half * u.y }, t + Math.PI / 2)];
}

/** A label `size` high starting at the origin, a chain link before it. */
export function hyperlinkLabel(text: string, size: number): HyperlinkDrawing {
  // two loops along a 45° rise, linked through each other
  const u = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const c = { x: size * 0.5, y: 0 };
  const off = size * 0.22;
  const links = [-1, 1].map((k) => loop({ x: c.x + k * off * u.x, y: c.y + k * off * u.y }, u, size * 0.16, size * 0.17));
  return { links, texts: [{ at: { x: size * 1.25, y: 0 }, text, height: size, justify: "left" }], qr: null };
}

/** A QR code holding `text`, `width` across with its margin, centred on the origin; or why it can't be drawn. */
export function hyperlinkQr(text: string, width: number): HyperlinkDrawing | string {
  if (!text) return "Enter the text or URL the QR code holds.";
  if (!(width > 0)) return "Set the QR code's image width over 0.";
  const m = qrModules(text);
  if (!m) return "That's too long for a QR code: it holds up to 2,331 bytes.";
  const n = m.length;
  const k = width / (n + 2 * QUIET_MODULES);
  const h = width / 2;
  // module (x, y), rows from the top, to the drawing, y up
  const at = (x: number, y: number): Pt => ({ x: (x - n / 2) * k, y: (n / 2 - y) * k });
  const dark: Pt[] = [];
  const corners: Pt[] = [];
  for (const r of moduleRects(m)) {
    const c = at(r.x, r.y);
    corners.push(c);
    dark.push(c, at(r.x, r.y + r.h), at(r.x + r.w, r.y + r.h), at(r.x + r.w, r.y), c);
  }
  // back along the bridges to the first rectangle
  dark.push(...corners.slice(0, -1).reverse());
  const back = [
    { x: -h, y: -h },
    { x: h, y: -h },
    { x: h, y: h },
    { x: -h, y: h },
  ];
  return { links: [], texts: [], qr: { back, dark } };
}

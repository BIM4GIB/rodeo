// The admin page's globe: a dot-matrix globe drawn on a canvas, with the land as dots and the
// visitors as dots on it (those with live set pulse). It turns slowly on its own, and turns under
// a drag with a little inertia; hovering a dot names it. Colours are the admin tokens, read again
// when the theme changes. Drawing stops while the tab is hidden or the globe is off screen.

import "./globe.css";
import { h } from "../app/dom.ts";
import { COUNTRY_CENTRES, LAND_BITS, LAND_H, LAND_W } from "./geoData.ts";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** the spin, in degrees a second */
const SPIN = 4;
/** a drag or its inertia stops this far from the poles, in degrees */
const TILT = 70;
const FOCUS_MS = 800;
const GROW_MS = 400;
const PULSE_MS = 2000;
const PAUSE_AFTER_DRAG_MS = 4000;
const PAUSE_AFTER_FOCUS_MS = 6000;
/** the land's brightness steps as it turns over the limb */
const LEVELS = 5;

const BYTES = Uint8Array.from(atob(LAND_BITS), (c) => c.charCodeAt(0));

/** A dot on the globe: a visitor now, or a place visitors came from. */
export interface GlobeDot {
  readonly lat: number;
  readonly lon: number;
  /** how big: 1 for one visitor; the radius grows with its square root */
  readonly weight: number;
  /** pulses: someone there now */
  readonly live?: boolean;
  /** "series-1" (default) or "series-2": the admin page's two series colours */
  readonly tone?: "series-1" | "series-2";
  /** shown on hover */
  readonly label?: string;
  /** stays the same between updates, so a dot that was already there doesn't flash as new */
  readonly key?: string;
}

export interface GlobeOptions {
  /** aborted when the tab goes: the globe stops drawing and lets go of its listeners */
  readonly signal: AbortSignal;
  /** the largest it is drawn, in CSS pixels (it fits its box's width up to this) */
  readonly maxSize?: number;
  /** drag to turn it, hover for labels (default true) */
  readonly interactive?: boolean;
  /** turns on its own, slowly (default true; never with prefers-reduced-motion) */
  readonly spin?: boolean;
}

export interface Globe {
  readonly el: HTMLElement;
  /** puts these dots on it in place of those before */
  setDots(dots: readonly GlobeDot[]): void;
  /** turns it to face a place */
  focus(lat: number, lon: number): void;
}

/** A dot as drawn: its unit vector, its full radius, when it appeared, and where it was last drawn. */
interface Mark {
  readonly dot: GlobeDot;
  readonly ux: number;
  readonly uy: number;
  readonly uz: number;
  readonly r: number;
  readonly born: number;
  readonly phase: number;
  front: boolean;
  sx: number;
  sy: number;
}

/** A turn from where the globe was to where it faces, in progress. */
interface Turn {
  readonly fromLat: number;
  readonly fromLon: number;
  readonly toLat: number;
  readonly toLon: number;
  readonly start: number;
}

/** A drag: the pointer's last place and when it was there. */
interface Drag {
  readonly id: number;
  x: number;
  y: number;
  t: number;
}

/** The token colours the globe paints with. */
interface Colours {
  readonly back: string;
  readonly rim: string;
  readonly land: string;
  readonly ink: string;
  readonly series1: string;
  readonly series2: string;
}

function readColours(): Colours {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    back: token("--surface-2"),
    rim: token("--border"),
    land: token("--text-3"),
    ink: token("--text"),
    series1: token("--series-1"),
    series2: token("--series-2"),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Whether the 1° cell holding a point is land. */
function isLand(lat: number, lon: number): boolean {
  const row = clamp(Math.floor(90 - lat), 0, LAND_H - 1);
  const col = clamp(Math.floor(lon + 180), 0, LAND_W - 1);
  const i = row * LAND_W + col;
  return ((BYTES[i >> 3] >> (7 - (i & 7))) & 1) === 1;
}

let landPoints: Float32Array | null = null;

/**
 * Unit vectors of the land dots, computed once: a row every 2° of latitude, and along each row a
 * dot every 2°/cos(lat) of longitude, so the dots spread evenly and there are fewer by the poles.
 */
function landDots(): Float32Array {
  if (landPoints) return landPoints;
  const out: number[] = [];
  for (let lat = -89; lat <= 89; lat += 2) {
    const c = Math.cos(lat * DEG);
    const n = Math.max(1, Math.round(180 * c));
    for (let j = 0; j < n; j++) {
      const lon = -180 + ((j + 0.5) * 360) / n;
      if (!isLand(lat, lon)) continue;
      out.push(c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG));
    }
  }
  landPoints = new Float32Array(out);
  return landPoints;
}

/** A fixed fraction of a pulse cycle from a key, so that dots don't pulse in step. */
function phaseOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ((hash >>> 0) % 1000) / 1000;
}

/**
 * Where a point (lat, lon) falls on a unit sphere turned to face (lat0, lon0): x to the right,
 * y down (north is up), and visible while it faces the viewer.
 */
export function project(lat: number, lon: number, lat0: number, lon0: number): { x: number; y: number; visible: boolean } {
  const p = lat * DEG;
  const l = lon * DEG;
  const p0 = lat0 * DEG;
  const l0 = lon0 * DEG;
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0);
  return {
    x: Math.cos(p) * Math.sin(l - l0),
    y: -(Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0)),
    visible: cosc > 0,
  };
}

/** A dot-matrix globe drawn on a canvas. */
export function globe(opts: GlobeOptions): Globe {
  const maxSize = opts.maxSize ?? 520;
  const interactive = opts.interactive !== false;
  const spinning = opts.spin !== false;

  const canvas = h("canvas", { attrs: { role: "img", "aria-label": "A globe showing where visitors are" } });
  const ctx = canvas.getContext("2d")!;
  const tip = h("div", { cls: "adm-globe-tip", hidden: true });
  const el = h("div", { cls: "adm-globe" }, canvas, tip);
  el.style.maxWidth = `${maxSize}px`;

  const reduceMq = matchMedia("(prefers-reduced-motion: reduce)");
  const schemeMq = matchMedia("(prefers-color-scheme: light)");

  let colours = readColours();
  /** the box's width in CSS px (the canvas is square); 0 until it is laid out */
  let size = 0;
  let dpr = 0;
  let marks: Mark[] = [];
  let bornByKey = new Map<string, number>();
  let growUntil = 0;
  let pulsing = false;
  /** the view's centre, in degrees */
  let lat0 = 20;
  let lon0 = 0;
  /** the speed of the last drag move, then its inertia, in degrees a second */
  let vLat = 0;
  let vLon = 0;
  let pausedUntil = 0;
  let turn: Turn | null = null;
  let drag: Drag | null = null;
  let pointer: { x: number; y: number } | null = null;
  let dirty = true;
  let onScreen = true;
  let rafId = 0;
  let last = performance.now();
  let dead = false;

  function schedule(): void {
    if (rafId === 0 && !dead) rafId = requestAnimationFrame(tick);
  }

  /** Sizes the canvas to the box, at the screen's pixel density. */
  function fit(): void {
    const w = el.clientWidth;
    const ratio = window.devicePixelRatio || 1;
    if (w === 0 || (w === size && ratio === dpr)) return;
    size = w;
    dpr = ratio;
    const px = Math.round(w * ratio);
    canvas.width = px;
    canvas.height = px;
    ctx.setTransform(px / w, 0, 0, px / w, 0, 0);
    dirty = true;
    schedule();
  }

  function restyle(): void {
    colours = readColours();
    dirty = true;
    schedule();
  }

  /** Moves the view one step (a focus turn, the drag's inertia, the spin); true while it is still moving. */
  function step(now: number, dt: number): boolean {
    let moving = false;
    if (turn) {
      const t = clamp((now - turn.start) / FOCUS_MS, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      lat0 = turn.fromLat + (turn.toLat - turn.fromLat) * e;
      lon0 = turn.fromLon + (turn.toLon - turn.fromLon) * e;
      if (t >= 1) turn = null;
      moving = true;
    } else if (!drag) {
      if (vLat !== 0 || vLon !== 0) {
        moving = true;
        lat0 = clamp(lat0 + vLat * dt, -TILT, TILT);
        lon0 += vLon * dt;
        const decay = Math.exp(-3 * dt);
        vLat = Math.abs(vLat * decay) < 0.5 ? 0 : vLat * decay;
        vLon = Math.abs(vLon * decay) < 0.5 ? 0 : vLon * decay;
      }
      // the loop keeps going through a pause, so the spin picks up again when it ends
      if (spinning && !reduceMq.matches) {
        if (now >= pausedUntil) lon0 += SPIN * dt;
        moving = true;
      }
    }
    lon0 = ((lon0 % 360) + 360) % 360;
    return moving;
  }

  function draw(now: number): void {
    if (size === 0) return;
    const c = size / 2;
    const R = c - 0.5;
    // the view's axes in the unit sphere: towards the viewer, screen right, screen up
    const p0 = lat0 * DEG;
    const l0 = lon0 * DEG;
    const ax = Math.cos(p0) * Math.cos(l0);
    const ay = Math.cos(p0) * Math.sin(l0);
    const az = Math.sin(p0);
    const bx = -Math.sin(l0);
    const by = Math.cos(l0);
    const ux = -Math.sin(p0) * Math.cos(l0);
    const uy = -Math.sin(p0) * Math.sin(l0);
    const uz = Math.cos(p0);

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.fillStyle = colours.back;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colours.rim;
    ctx.stroke();

    const pts = landDots();
    const dot = Math.max(0.5, (0.9 * size) / 360);
    const levels = Array.from({ length: LEVELS }, () => new Path2D());
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i];
      const y = pts[i + 1];
      const z = pts[i + 2];
      const depth = x * ax + y * ay + z * az;
      if (depth <= 0) continue;
      const sx = c + R * (x * bx + y * by);
      const sy = c - R * (x * ux + y * uy + z * uz);
      const level = Math.min(LEVELS - 1, Math.floor(Math.min(1, depth / 0.3) * LEVELS));
      levels[level].moveTo(sx + dot, sy);
      levels[level].arc(sx, sy, dot, 0, TAU);
    }
    ctx.fillStyle = colours.land;
    levels.forEach((path, level) => {
      ctx.globalAlpha = (level + 1) / LEVELS;
      ctx.fill(path);
    });

    for (const m of marks) {
      const depth = m.ux * ax + m.uy * ay + m.uz * az;
      m.front = depth > 0;
      if (!m.front) continue;
      m.sx = c + R * (m.ux * bx + m.uy * by);
      m.sy = c - R * (m.ux * ux + m.uy * uy + m.uz * uz);
      const grow = 1 - (1 - clamp((now - m.born) / GROW_MS, 0, 1)) ** 3;
      const tone = m.dot.tone === "series-2" ? colours.series2 : colours.series1;
      if (m.dot.live) {
        const t = (now / PULSE_MS + m.phase) % 1;
        ctx.globalAlpha = 0.6 * (1 - t) * grow;
        ctx.beginPath();
        ctx.arc(m.sx, m.sy, m.r + 10 * t, 0, TAU);
        ctx.strokeStyle = tone;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 0.85 * grow;
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, m.r * grow, 0, TAU);
      ctx.fillStyle = tone;
      ctx.fill();
      ctx.globalAlpha = 0.45 * grow;
      ctx.lineWidth = 1;
      ctx.strokeStyle = colours.ink;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function hide(): void {
    tip.hidden = true;
  }

  /** Names the front dot under the pointer, if it has a label, within 10 px of its edge. */
  function updateHover(): void {
    let best: Mark | null = null;
    let bestDist = Infinity;
    if (pointer && !drag) {
      for (const m of marks) {
        if (!m.front) continue;
        const d = Math.hypot(m.sx - pointer.x, m.sy - pointer.y);
        if (d <= m.r + 10 && d < bestDist) {
          best = m;
          bestDist = d;
        }
      }
    }
    if (!best?.dot.label) {
      hide();
      return;
    }
    tip.textContent = best.dot.label;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const left = clamp(best.sx - tw / 2, 0, Math.max(0, size - tw));
    let top = best.sy - best.r - 8 - th;
    if (top < 0) top = best.sy + best.r + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function tick(now: number): void {
    rafId = 0;
    if (dead || document.hidden || !onScreen) return;
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    if ((window.devicePixelRatio || 1) !== dpr) fit();
    const moving = step(now, dt);
    const growing = now < growUntil;
    if (dirty || moving || pulsing || growing) {
      dirty = false;
      draw(now);
      updateHover();
    }
    if (moving || pulsing || growing) schedule();
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0 || size === 0) return;
    canvas.setPointerCapture(e.pointerId);
    turn = null;
    vLat = 0;
    vLon = 0;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    canvas.style.cursor = "grabbing";
    hide();
  }

  function onMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) {
      const box = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
      updateHover();
      return;
    }
    const now = performance.now();
    // the surface follows the pointer: a drag across the globe's radius turns it about 57°
    const perPx = 2 / (DEG * size);
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const secs = Math.max(1, now - drag.t) / 1000;
    lon0 -= dx * perPx;
    lat0 = clamp(lat0 + dy * perPx, -TILT, TILT);
    vLon = (-dx * perPx) / secs;
    vLat = (dy * perPx) / secs;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    dirty = true;
    schedule();
  }

  function onLeave(): void {
    pointer = null;
    updateHover();
  }

  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    // a drag that stopped before it was let go has no inertia
    if (performance.now() - drag.t > 80) {
      vLat = 0;
      vLon = 0;
    }
    drag = null;
    pausedUntil = performance.now() + PAUSE_AFTER_DRAG_MS;
    canvas.style.cursor = "grab";
    schedule();
  }

  function wake(): void {
    if (!document.hidden) {
      dirty = true;
      schedule();
    }
  }

  if (interactive) {
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
  }

  const ro = new ResizeObserver(fit);
  ro.observe(el);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) onScreen = e.isIntersecting;
    if (onScreen) {
      dirty = true;
      schedule();
    }
  });
  io.observe(el);
  const theme = new MutationObserver(restyle);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  schemeMq.addEventListener("change", restyle);
  reduceMq.addEventListener("change", schedule);
  document.addEventListener("visibilitychange", wake);

  function teardown(): void {
    dead = true;
    cancelAnimationFrame(rafId);
    rafId = 0;
    ro.disconnect();
    io.disconnect();
    theme.disconnect();
    schemeMq.removeEventListener("change", restyle);
    reduceMq.removeEventListener("change", schedule);
    document.removeEventListener("visibilitychange", wake);
    if (interactive) {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    }
    turn = null;
    drag = null;
    pointer = null;
  }

  if (opts.signal.aborted) teardown();
  else opts.signal.addEventListener("abort", teardown, { once: true });

  fit();
  schedule();

  return {
    el,
    setDots(dots) {
      const now = performance.now();
      const born = new Map<string, number>();
      let until = 0;
      marks = dots.map((d) => {
        // without a key, a dot is known by where it is and its colour
        const key = d.key ?? `${d.lat},${d.lon},${d.tone ?? ""}`;
        const at = bornByKey.get(key) ?? now;
        born.set(key, at);
        until = Math.max(until, at + GROW_MS);
        const lat = d.lat * DEG;
        const lon = d.lon * DEG;
        const c = Math.cos(lat);
        return {
          dot: d,
          ux: c * Math.cos(lon),
          uy: c * Math.sin(lon),
          uz: Math.sin(lat),
          r: Math.min(14, 2.5 + 2.2 * Math.sqrt(Math.max(0, d.weight))),
          born: at,
          phase: phaseOf(key),
          front: false,
          sx: 0,
          sy: 0,
        };
      });
      bornByKey = born;
      growUntil = until;
      pulsing = marks.some((m) => m.dot.live === true);
      dirty = true;
      schedule();
    },
    focus(lat, lon) {
      if (dead) return;
      const now = performance.now();
      // the way round that is shorter
      const along = ((((lon - lon0) % 360) + 540) % 360) - 180;
      turn = { fromLat: lat0, fromLon: lon0, toLat: lat, toLon: lon0 + along, start: now };
      vLat = 0;
      vLon = 0;
      pausedUntil = now + PAUSE_AFTER_FOCUS_MS;
      schedule();
    },
  };
}

/** The middle of a country (its two-letter code), or null. */
export function countryCentre(code: string): readonly [number, number] | null {
  return COUNTRY_CENTRES[code.toUpperCase()] ?? null;
}

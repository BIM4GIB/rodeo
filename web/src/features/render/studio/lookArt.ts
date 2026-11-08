// The picture on each Look's tile: one small scene (a sky with a sun, a lawn, a house with a window
// and a tree) drawn as inline SVG, graded by the look (a CSS filter from its saturation, contrast,
// light and warmth; a blue wash for a cool look), with a vignette laid over it and grain when the
// look has some. Each call makes its own ids, so the tiles never share one. No three.js here.

import { h } from "../../../app/dom.ts";
import type { Look } from "../settings.ts";

let serial = 0;

/** The grading as CSS filters, from a look's effects ("none" when it grades nothing). */
export function gradeFilter(effects: Look["effects"]): string {
  const parts: string[] = [];
  if (effects.saturation <= -1) parts.push("grayscale(1)");
  else if (effects.saturation !== 0) parts.push(`saturate(${(1 + effects.saturation).toFixed(2)})`);
  if (effects.contrast !== 0) parts.push(`contrast(${(1 + effects.contrast).toFixed(2)})`);
  // the light a little: lifted shadows and pulled-back highlights both show as overall brightness
  const light = 1 + (effects.shadows - effects.highlights) * 0.08;
  if (Math.abs(light - 1) > 0.005) parts.push(`brightness(${light.toFixed(3)})`);
  // warm: sepia toward amber (a hue turn would shift the greens and blues of the whole scene too)
  if (effects.temperature > 0) parts.push(`sepia(${(effects.temperature * 0.5).toFixed(3)})`, `hue-rotate(${(-effects.temperature * 8).toFixed(1)}deg)`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

/** The scene, its gradients named under `p`. */
function sceneSvg(p: string): string {
  return `<svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="${p}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b96dc"/><stop offset="1" stop-color="#d7e8f6"/></linearGradient>
<radialGradient id="${p}-sun"><stop offset="0" stop-color="#fff9e2"/><stop offset="0.4" stop-color="#fff0b4" stop-opacity="0.85"/><stop offset="1" stop-color="#fff0b4" stop-opacity="0"/></radialGradient>
<linearGradient id="${p}-lawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9dbb76"/><stop offset="1" stop-color="#5d7d46"/></linearGradient>
</defs>
<rect width="120" height="80" fill="url(#${p}-sky)"/>
<circle cx="90" cy="19" r="18" fill="url(#${p}-sun)"/>
<circle cx="90" cy="19" r="5.5" fill="#fffbea"/>
<rect y="56" width="120" height="24" fill="url(#${p}-lawn)"/>
<rect x="41" y="38" width="38" height="20" fill="#f4eee4"/>
<path d="M35 40L60 19L85 40Z" fill="#b5593e"/>
<rect x="50" y="45" width="12" height="12" fill="#3f4f63"/>
<path d="M56 45v12M50 51h12" stroke="#f4eee4" stroke-width="1.2"/>
<rect x="68" y="46" width="7" height="12" fill="#7a5439"/>
<rect x="17.2" y="53" width="2.6" height="7" fill="#6b4c33"/>
<circle cx="18.5" cy="46" r="10" fill="#4f7d45"/>
</svg>`;
}

/** Film grain over the scene: fractal noise in grey, laid with its own filter id. */
function grainSvg(p: string): string {
  return `<svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<filter id="${p}-noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
<rect width="120" height="80" filter="url(#${p}-noise)"/>
</svg>`;
}

/** A look's tile picture: the scene graded by the look, a blue wash when it is cool, its vignette and grain over it. */
export function lookArt(look: Look): HTMLElement {
  const p = `rs-look-${++serial}`;
  const e = look.effects;
  const scene = h("div", { cls: "rs-look-scene", html: sceneSvg(p) });
  scene.style.filter = gradeFilter(e);
  const layers: HTMLElement[] = [scene];
  if (e.temperature < 0) {
    const cool = h("div", { cls: "rs-look-cool", attrs: { "aria-hidden": "true" } });
    cool.style.opacity = String(Math.min(1, -e.temperature * 1.2));
    layers.push(cool);
  }
  const vignette = h("div", { cls: "rs-look-vignette", attrs: { "aria-hidden": "true" } });
  vignette.style.opacity = String(Math.min(1, e.vignette * 1.6));
  layers.push(vignette);
  if (e.grain > 0.2) {
    const grain = h("div", { cls: "rs-look-grain", html: grainSvg(p) });
    grain.style.opacity = String(Math.min(1, e.grain * 0.6));
    layers.push(grain);
  }
  return h("div", { cls: "rs-look-art" }, ...layers);
}

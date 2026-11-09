// The moving view's picture: while the camera moves, the path tracer gives one noisy, low-resolution
// frame an animation frame, and this filter turns that stream into a steady, full-resolution one.
// Each frame has the surfaces' colour taken out (demodulation), is reprojected and blended with the
// history of the frames before, where the same surface was in view, and is smoothed with edge-stopping
// à-trous passes; then the colour goes back in at full resolution. A static scene seen by a moving
// camera, so the history holds wherever a surface was seen before.

import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { GuidePass } from "./guide.ts";
import type { RenderScene } from "./sceneBuilder.ts";
import type { MotionFrame } from "./traceEngine.ts";

/** The à-trous passes' steps: each one spreads the 5 × 5 kernel over this many pixels. */
const ATROUS_STEPS = [1, 2, 4, 8];
/** Below this many frames of history a pixel's variance is taken from its neighbours in the frame. */
const SPATIAL_VARIANCE_BELOW = 4;

const SCREEN_VERTEX = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const LUMA = "const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);";

/** The light: the frame's colour divided by the albedo (floored at 0.03, so a black face does not blow up), and the sky's as it is. */
const DEMOD_FRAGMENT = `
uniform sampler2D tColor;
uniform sampler2D tAlbedo;
out vec4 fragColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(tColor, p, 0).rgb;
  vec4 a = texelFetch(tAlbedo, p, 0);
  vec3 light = a.a > 0.5 ? c / max(a.rgb, vec3(0.03)) : c;
  fragColor = vec4(light, a.a);
}
`;

/** The view-space point at linear depth d (metres) along the ray through an NDC position. */
const VIEW_AT = `
uniform float uOrtho;
uniform mat4 uProjInv;

vec3 viewAt(vec2 ndc, float d) {
  if (uOrtho > 0.5) {
    vec4 q = uProjInv * vec4(ndc, 0.0, 1.0);
    return vec3(q.xy, -d);
  }
  vec4 q = uProjInv * vec4(ndc, 1.0, 1.0);
  q.xyz /= q.w;
  return vec3(q.xy * (d / -q.z), -d);
}
`;

/**
 * Temporal accumulation. A surface's previous frame is found by reprojecting its world point into
 * the last camera; the four texels around that point are used where they were a surface too, at the
 * same depth (3 %) and with a normal within 0.9 of this one, weighted bilinearly and renormalised.
 * The history is averaged with weight 1 / length, the length capped at 32; the variance is the
 * history's, or the frame's own 3 × 3 spread while the history is short.
 */
const TEMPORAL_FRAGMENT = `
uniform sampler2D tDemod;
uniform sampler2D tNormalDepth;
uniform sampler2D tPrevAlbedo;
uniform sampler2D tPrevNormalDepth;
uniform sampler2D tHist;
uniform sampler2D tMoments;
uniform vec2 uSize;
uniform float uHasPrev;
uniform mat4 uCamWorld;
uniform mat4 uPrevViewProj;
uniform mat4 uPrevView;
layout(location = 0) out vec4 oHist;
layout(location = 1) out vec4 oMoments;

${LUMA}
${VIEW_AT}

float spatialVariance(ivec2 p) {
  ivec2 size = ivec2(uSize);
  float s = 0.0;
  float s2 = 0.0;
  float n = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 q = p + ivec2(i, j);
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      vec4 d = texelFetch(tDemod, q, 0);
      if (d.a < 0.5) continue;
      float l = dot(d.rgb, LUMA);
      s += l;
      s2 += l * l;
      n += 1.0;
    }
  }
  if (n < 1.0) return 0.0;
  float m = s / n;
  return max(0.0, s2 / n - m * m);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = ivec2(uSize);
  vec2 ndc = (vec2(p) + 0.5) / uSize * 2.0 - 1.0;
  vec4 dem = texelFetch(tDemod, p, 0);
  vec3 I = dem.rgb;

  if (dem.a < 0.5) {
    // sky has no surface to follow and is smooth: the sky the frame before is mixed in at half weight, where it was sky too
    vec3 sky = I;
    float L = 1.0;
    if (uHasPrev > 0.5) {
      vec4 farPoint = uCamWorld * vec4(viewAt(ndc, 1.0e5), 1.0);
      vec4 clip = uPrevViewProj * farPoint;
      if (clip.w > 0.0) {
        ivec2 q = ivec2(floor((clip.xy / clip.w * 0.5 + 0.5) * uSize));
        if (q.x >= 0 && q.y >= 0 && q.x < size.x && q.y < size.y && texelFetch(tPrevAlbedo, q, 0).a < 0.5) {
          sky = mix(texelFetch(tHist, q, 0).rgb, I, 0.5);
          L = 2.0;
        }
      }
    }
    oHist = vec4(sky, L);
    oMoments = vec4(0.0);
    return;
  }

  vec4 nd = texelFetch(tNormalDepth, p, 0);
  vec3 n = nd.xyz;
  vec3 wpos = (uCamWorld * vec4(viewAt(ndc, nd.w), 1.0)).xyz;
  float lum = dot(I, LUMA);
  vec3 Ih = I;
  float L = 1.0;
  vec2 mom = vec2(lum, lum * lum);

  float wsum = 0.0;
  vec3 accI = vec3(0.0);
  float accL = 0.0;
  vec2 accM = vec2(0.0);
  if (uHasPrev > 0.5) {
    vec4 clip = uPrevViewProj * vec4(wpos, 1.0);
    float expect = -(uPrevView * vec4(wpos, 1.0)).z;
    if (clip.w > 0.0) {
      vec2 pix = (clip.xy / clip.w * 0.5 + 0.5) * uSize - 0.5;
      ivec2 base = ivec2(floor(pix));
      vec2 f = pix - vec2(base);
      for (int k = 0; k < 4; k++) {
        ivec2 o = ivec2(k & 1, k >> 1);
        ivec2 q = base + o;
        if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
        if (texelFetch(tPrevAlbedo, q, 0).a < 0.5) continue;
        vec4 pnd = texelFetch(tPrevNormalDepth, q, 0);
        if (abs(pnd.w - expect) > 0.03 * expect) continue;
        if (dot(pnd.xyz, n) <= 0.9) continue;
        float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
        vec4 h = texelFetch(tHist, q, 0);
        accI += w * h.rgb;
        accL += w * h.a;
        accM += w * texelFetch(tMoments, q, 0).xy;
        wsum += w;
      }
    }
  }
  if (wsum > 0.0) {
    L = min(accL / wsum + 1.0, 32.0);
    float t = 1.0 / L;
    Ih = mix(accI / wsum, I, t);
    mom = mix(accM / wsum, mom, t);
  }
  float v = max(0.0, mom.y - mom.x * mom.x);
  if (L < ${SPATIAL_VARIANCE_BELOW.toFixed(1)}) v = spatialVariance(p);
  oHist = vec4(Ih, L);
  oMoments = vec4(mom, v, 0.0);
}
`;

/**
 * One à-trous step: the 5 × 5 B3-spline spread over `uStep` pixels, each tap weighted by its
 * normal (pow 64), its depth against the centre's slope and its luminance against the centre's
 * blurred variance (scaled up by the history length). Sky and surface never mix. The variance is
 * filtered along by the squared weights, as SVGF does.
 */
const ATROUS_FRAGMENT = `
uniform sampler2D tColor;
uniform sampler2D tVar;
uniform float uVarAlpha;
uniform sampler2D tHist;
uniform sampler2D tAlbedo;
uniform sampler2D tNormalDepth;
uniform int uStep;
out vec4 fragColor;

${LUMA}
const float KERNEL[5] = float[5](0.0625, 0.25, 0.375, 0.25, 0.0625);
const float GAUSS[3] = float[3](0.25, 0.5, 0.25);

float varianceOf(vec4 v) {
  return uVarAlpha > 0.5 ? v.a : v.b;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(tColor, 0);
  bool surf = texelFetch(tAlbedo, p, 0).a > 0.5;
  vec4 nd = texelFetch(tNormalDepth, p, 0);
  vec3 I = texelFetch(tColor, p, 0).rgb;
  float L = texelFetch(tHist, p, 0).a;
  float lc = dot(I, LUMA);

  float dz = 0.0;
  float sigma = 1.0;
  if (surf) {
    // the depth's slope across one pixel, from the surface neighbours only (a sky neighbour has no depth)
    ivec2 px = min(p + ivec2(1, 0), size - 1);
    ivec2 py = min(p + ivec2(0, 1), size - 1);
    float dx = texelFetch(tAlbedo, px, 0).a > 0.5 ? texelFetch(tNormalDepth, px, 0).w - nd.w : 0.0;
    float dy = texelFetch(tAlbedo, py, 0).a > 0.5 ? texelFetch(tNormalDepth, py, 0).w - nd.w : 0.0;
    dz = length(vec2(dx, dy));
    // the centre's variance blurred by a 3 × 3 Gaussian sets how far luminance may differ (widening it
    // with the history's length only blurred a held view more, measured)
    float vb = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        ivec2 q = clamp(p + ivec2(i, j), ivec2(0), size - 1);
        vb += GAUSS[i + 1] * GAUSS[j + 1] * varianceOf(texelFetch(tVar, q, 0));
      }
    }
    sigma = 4.0 * sqrt(max(vb, 0.0)) + 1e-4;
  }

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float vacc = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      ivec2 off = ivec2(i, j) * uStep;
      ivec2 q = p + off;
      if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
      if ((texelFetch(tAlbedo, q, 0).a > 0.5) != surf) continue;
      float w = KERNEL[i + 2] * KERNEL[j + 2];
      vec3 Iq = texelFetch(tColor, q, 0).rgb;
      float vq = varianceOf(texelFetch(tVar, q, 0));
      if (surf) {
        vec4 qnd = texelFetch(tNormalDepth, q, 0);
        w *= pow(max(dot(nd.xyz, qnd.xyz), 0.0), 64.0);
        w *= exp(-abs(nd.w - qnd.w) / (dz * length(vec2(off)) + 1e-3));
        w *= exp(-abs(lc - dot(Iq, LUMA)) / sigma);
      }
      acc += w * Iq;
      wsum += w;
      vacc += w * w * vq;
    }
  }
  if (wsum <= 0.0) {
    fragColor = vec4(I, varianceOf(texelFetch(tVar, p, 0)));
    return;
  }
  fragColor = vec4(acc / wsum, vacc / (wsum * wsum));
}
`;

/**
 * Full resolution: the filtered light at the frame's size, bilinearly up to the output, weighted by
 * depth and normal against the frame's own guides, then the colour put back. The colour is floored
 * at 0.03 as the demodulation floors it, so the two undo each other.
 */
const LIFT_FRAGMENT = `
uniform sampler2D tFiltered;
uniform sampler2D tLowAlbedo;
uniform sampler2D tLowNormalDepth;
uniform sampler2D tFullAlbedo;
uniform sampler2D tFullNormalDepth;
out vec4 fragColor;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 full = textureSize(tFullAlbedo, 0);
  ivec2 low = textureSize(tFiltered, 0);
  vec4 fa = texelFetch(tFullAlbedo, p, 0);
  vec4 fnd = texelFetch(tFullNormalDepth, p, 0);
  bool surf = fa.a > 0.5;
  vec2 pl = (vec2(p) + 0.5) / vec2(full) * vec2(low) - 0.5;
  ivec2 base = ivec2(floor(pl));
  vec2 f = pl - vec2(base);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 q = clamp(base + o, ivec2(0), low - 1);
    float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    if ((texelFetch(tLowAlbedo, q, 0).a > 0.5) != surf) continue;
    if (surf) {
      vec4 ln = texelFetch(tLowNormalDepth, q, 0);
      w *= exp(-abs(fnd.w - ln.w) / (0.02 * fnd.w + 1e-3)) * pow(max(dot(fnd.xyz, ln.xyz), 0.0), 16.0);
    }
    acc += w * texelFetch(tFiltered, q, 0).rgb;
    wsum += w;
  }
  vec3 light;
  if (wsum < 1e-4) light = texelFetch(tFiltered, clamp(ivec2(floor(pl + 0.5)), ivec2(0), low - 1), 0).rgb;
  else light = acc / wsum;
  fragColor = vec4(surf ? light * max(fa.rgb, vec3(0.03)) : light, 1.0);
}
`;

/** A full-screen pass: its own shader and uniforms (set before each draw), blending off, drawing into whatever target is bound. */
function screenPass<U extends Record<string, THREE.IUniform>>(fragmentShader: string, uniforms: U): { readonly uniforms: U; readonly material: THREE.ShaderMaterial; readonly quad: FullScreenQuad } {
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SCREEN_VERTEX,
    fragmentShader,
    glslVersion: THREE.GLSL3,
    blending: THREE.NoBlending,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  return { uniforms, material, quad: new FullScreenQuad(material) };
}

/** A half-float target that is not filtered: a pixel's values are read as they were written. */
function makeTarget(count: number, filter: THREE.MagnificationTextureFilter = THREE.NearestFilter): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { count, type: THREE.HalfFloatType, minFilter: filter, magFilter: filter, depthBuffer: false });
}

/** The camera a frame was traced through, rebuilt from its matrices (not updated from a transform). */
function cameraOf(frame: MotionFrame): THREE.Camera {
  // a perspective projection has -1 in its fourth row's third place, an orthographic one 0
  const perspective = Math.abs(frame.projectionMatrix.elements[11]) > 0.5;
  const camera = perspective ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  camera.matrixWorld.copy(frame.matrixWorld);
  camera.matrixWorldInverse.copy(frame.matrixWorld).invert();
  camera.projectionMatrix.copy(frame.projectionMatrix);
  camera.projectionMatrixInverse.copy(frame.projectionMatrix).invert();
  return camera;
}

/** The renderer's state a pass changes, as it was found. */
interface RendererState {
  readonly target: THREE.WebGLRenderTarget | null;
  readonly autoClear: boolean;
  readonly viewport: THREE.Vector4;
  readonly scissor: THREE.Vector4;
  readonly scissorTest: boolean;
  readonly clear: THREE.Color;
  readonly clearAlpha: number;
}

function saveState(r: THREE.WebGLRenderer): RendererState {
  return {
    target: r.getRenderTarget(),
    autoClear: r.autoClear,
    viewport: r.getViewport(new THREE.Vector4()),
    scissor: r.getScissor(new THREE.Vector4()),
    scissorTest: r.getScissorTest(),
    clear: r.getClearColor(new THREE.Color()),
    clearAlpha: r.getClearAlpha(),
  };
}

function restoreState(r: THREE.WebGLRenderer, s: RendererState): void {
  // the target last: setting it applies the viewport and scissor that belong to it
  r.setViewport(s.viewport);
  r.setScissor(s.scissor);
  r.setScissorTest(s.scissorTest);
  r.setClearColor(s.clear, s.clearAlpha);
  r.autoClear = s.autoClear;
  r.setRenderTarget(s.target);
}

/**
 * Turns the path tracer's moving frames into a steady picture: one call per animation frame, with
 * the newest frame (taken into the history once per serial) and the size of the picture wanted.
 */
export class MotionFilter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly demod = screenPass(DEMOD_FRAGMENT, {
    tColor: { value: null as THREE.Texture | null },
    tAlbedo: { value: null as THREE.Texture | null },
  });
  private readonly temporal = screenPass(TEMPORAL_FRAGMENT, {
    tDemod: { value: null as THREE.Texture | null },
    tNormalDepth: { value: null as THREE.Texture | null },
    tPrevAlbedo: { value: null as THREE.Texture | null },
    tPrevNormalDepth: { value: null as THREE.Texture | null },
    tHist: { value: null as THREE.Texture | null },
    tMoments: { value: null as THREE.Texture | null },
    uSize: { value: new THREE.Vector2(1, 1) },
    uHasPrev: { value: 0 },
    uOrtho: { value: 0 },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uPrevView: { value: new THREE.Matrix4() },
  });
  private readonly atrous = screenPass(ATROUS_FRAGMENT, {
    tColor: { value: null as THREE.Texture | null },
    tVar: { value: null as THREE.Texture | null },
    uVarAlpha: { value: 0 },
    tHist: { value: null as THREE.Texture | null },
    tAlbedo: { value: null as THREE.Texture | null },
    tNormalDepth: { value: null as THREE.Texture | null },
    uStep: { value: 1 },
  });
  private readonly lift = screenPass(LIFT_FRAGMENT, {
    tFiltered: { value: null as THREE.Texture | null },
    tLowAlbedo: { value: null as THREE.Texture | null },
    tLowNormalDepth: { value: null as THREE.Texture | null },
    tFullAlbedo: { value: null as THREE.Texture | null },
    tFullNormalDepth: { value: null as THREE.Texture | null },
  });
  /** the frame's guides, two of them so the last frame's stays for the reprojection */
  private readonly guides = [new GuidePass(1, 1), new GuidePass(1, 1)];
  /** the output size's guides, for the full-resolution pass */
  private readonly full = new GuidePass(1, 1);
  /** the light divided by the colour, one per frame */
  private readonly demodTarget = makeTarget(1);
  /** the history: [light rgb, length] and [m1, m2, variance]; the newest is `current` */
  private readonly hist = [makeTarget(2), makeTarget(2)];
  private current = 0;
  /** the à-trous ping-pong; the filtered light is the last one written */
  private readonly atrousA = makeTarget(1);
  private readonly atrousB = makeTarget(1);
  private filtered: THREE.Texture;
  private readonly output = makeTarget(1, THREE.LinearFilter);
  private readonly prevViewProj = this.temporal.uniforms.uPrevViewProj.value;
  private readonly prevView = this.temporal.uniforms.uPrevView.value;
  /** the size the history and the guides are kept at */
  private fw = 1;
  private fh = 1;
  /** the picture's size, and the serial of the last frame taken in (null: none) */
  private outW = 0;
  private outH = 0;
  private serial: number | null = null;
  /** whether the history holds frames from the current size and scene */
  private hasHistory = false;
  /** the guide of the last frame taken in, which the next frame reprojects from */
  private guideNow: GuidePass | null = null;
  /** the last frame's camera and scene, for the full-resolution pass */
  private camera: THREE.Camera | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.filtered = this.atrousB.texture;
  }

  /** Frames of history the picture holds at its centre, about (for the status line and tests). */
  get history(): number {
    if (!this.hasHistory) return 0;
    // the length is the history's alpha; read back as half floats
    const buffer = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.hist[this.current], Math.floor(this.fw / 2), Math.floor(this.fh / 2), 1, 1, buffer, undefined, 0);
    return THREE.DataUtils.fromHalfFloat(buffer[3]);
  }

  /** Takes `frame` into the history (once per serial) and returns the steady picture at width × height: linear HDR, through frame's camera. */
  render(scene: RenderScene, frame: MotionFrame, width: number, height: number): THREE.Texture {
    const r = this.renderer;
    const fw = Math.max(1, Math.round(frame.width));
    const fh = Math.max(1, Math.round(frame.height));
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const saved = saveState(r);
    try {
      const fresh = frame.serial !== this.serial;
      if (fresh) {
        this.advance(scene, frame, fw, fh);
        this.serial = frame.serial;
      }
      if (fresh || w !== this.outW || h !== this.outH) this.liftTo(scene, w, h);
    } finally {
      restoreState(r, saved);
    }
    return this.output.texture;
  }

  /** Forgets the history (another scene, new settings, a jump). */
  reset(): void {
    this.hasHistory = false;
    this.guideNow = null;
    this.serial = null;
  }

  dispose(): void {
    for (const g of this.guides) g.dispose();
    this.full.dispose();
    for (const pass of [this.demod, this.temporal, this.atrous, this.lift]) {
      pass.quad.dispose();
      pass.material.dispose();
    }
    this.demodTarget.dispose();
    for (const t of this.hist) t.dispose();
    this.atrousA.dispose();
    this.atrousB.dispose();
    this.output.dispose();
    this.hasHistory = false;
    this.guideNow = null;
    this.serial = null;
  }

  /** Takes a new frame into the history: its guides, the light, the reprojection and the smoothing. */
  private advance(scene: RenderScene, frame: MotionFrame, fw: number, fh: number): void {
    if (fw !== this.fw || fh !== this.fh) this.allocate(fw, fh);
    const r = this.renderer;
    const camera = cameraOf(frame);
    const prev = this.guideNow;
    const cur = prev === this.guides[0] ? this.guides[1] : this.guides[0];

    // 1. the guides of this frame, at its size
    cur.render(r, scene, camera, fw, fh);

    // 2. the light: the colour divided out of the frame
    this.demod.uniforms.tColor.value = frame.color;
    this.demod.uniforms.tAlbedo.value = cur.albedo;
    this.draw(this.demod.quad, this.demodTarget);

    // 3. reprojected into the history, which is read from one target and written to the other
    const hasPrev = this.hasHistory && prev !== null;
    const read = this.hist[this.current];
    const write = this.hist[1 - this.current];
    const t = this.temporal.uniforms;
    t.tDemod.value = this.demodTarget.texture;
    t.tNormalDepth.value = cur.normalDepth;
    t.tPrevAlbedo.value = hasPrev ? prev.albedo : cur.albedo;
    t.tPrevNormalDepth.value = hasPrev ? prev.normalDepth : cur.normalDepth;
    t.tHist.value = read.textures[0];
    t.tMoments.value = read.textures[1];
    t.uSize.value.set(fw, fh);
    t.uHasPrev.value = hasPrev ? 1 : 0;
    t.uOrtho.value = camera instanceof THREE.OrthographicCamera ? 1 : 0;
    t.uProjInv.value.copy(camera.projectionMatrixInverse);
    t.uCamWorld.value.copy(camera.matrixWorld);
    this.draw(this.temporal.quad, write);
    this.current = 1 - this.current;
    this.hasHistory = true;

    // 4. the smoothing: four à-trous steps, the first reading the history's light and variance
    const newest = this.hist[this.current];
    const a = this.atrous.uniforms;
    a.tHist.value = newest.textures[0];
    a.tAlbedo.value = cur.albedo;
    a.tNormalDepth.value = cur.normalDepth;
    let color: THREE.Texture = newest.textures[0];
    let variance: THREE.Texture = newest.textures[1];
    let alpha = 0;
    for (let s = 0; s < ATROUS_STEPS.length; s++) {
      const target = s % 2 === 0 ? this.atrousA : this.atrousB;
      a.tColor.value = color;
      a.tVar.value = variance;
      a.uVarAlpha.value = alpha;
      a.uStep.value = ATROUS_STEPS[s];
      this.draw(this.atrous.quad, target);
      color = target.texture;
      variance = target.texture;
      alpha = 1;
    }
    this.filtered = color;

    // the next frame reprojects with this one's camera
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevView.copy(camera.matrixWorldInverse);
    this.guideNow = cur;
    this.camera = camera;
  }

  /** The filtered light at w × h, with the colour put back at full resolution through the last frame's camera. */
  private liftTo(scene: RenderScene, w: number, h: number): void {
    const camera = this.camera;
    const cur = this.guideNow;
    if (!camera || !cur) return;
    this.full.render(this.renderer, scene, camera, w, h);
    this.output.setSize(w, h);
    const u = this.lift.uniforms;
    u.tFiltered.value = this.filtered;
    u.tLowAlbedo.value = cur.albedo;
    u.tLowNormalDepth.value = cur.normalDepth;
    u.tFullAlbedo.value = this.full.albedo;
    u.tFullNormalDepth.value = this.full.normalDepth;
    this.draw(this.lift.quad, this.output);
    this.outW = w;
    this.outH = h;
  }

  /** Sizes the history and the guides for a frame of fw × fh; the history starts again. */
  private allocate(fw: number, fh: number): void {
    this.fw = fw;
    this.fh = fh;
    for (const g of this.guides) g.setSize(fw, fh);
    this.demodTarget.setSize(fw, fh);
    for (const t of this.hist) t.setSize(fw, fh);
    this.atrousA.setSize(fw, fh);
    this.atrousB.setSize(fw, fh);
    this.hasHistory = false;
    this.guideNow = null;
    this.serial = null;
  }

  /** Draws a full-screen pass into `target`, without clearing it. */
  private draw(quad: FullScreenQuad, target: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(target);
    this.renderer.autoClear = false;
    quad.render(this.renderer);
  }
}

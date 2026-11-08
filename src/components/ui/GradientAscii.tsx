"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import {
  ASCII_DEFAULTS,
  ASCII_RISE_SOURCE,
  type AsciiClickEffect,
  type AsciiShape,
  type AsciiSurface,
} from "@/components/ui/gradient-ascii-tokens";
import { cn } from "@/lib/utils";

/**
 * A field of light drawn in characters: a soft gradient that drifts, with a
 * grid of monospaced glyphs over it, denser where it is brighter. The pointer
 * scrambles the glyphs under it and a click sends a ring of scrambled ones out,
 * and on arrival the light fades in from its source while the glyphs decode.
 * React Bits' GradientASCII, ported to TypeScript and onto our tokens: its
 * colours are theme variables and its glyphs are drawn in the element's own
 * typeface (`font-mono`, JetBrains Mono, unless the caller's class says other).
 *
 * The SAME palette works on both surfaces. A palette is a ramp of tones from
 * darkest to lightest; on a dark surface the light end glows, on a light one
 * the ramp is read the other way round so the strongest tone is the core and
 * the faintest is the edge that dissolves into the page.
 *
 * Plain WebGL2: four small passes (the light at half size, an optional halo
 * blurred at quarter size, then glyphs and grain at full size). Decorative and
 * best effort: it draws nothing where WebGL2 is not available, so give it a
 * place where an empty box is fine. Runs only while on screen and the tab is
 * visible, and under reduced motion draws one still frame (styles.md §6.2).
 *
 * Its palettes, glyph ramp and positions are in ui/gradient-ascii-tokens.
 */

const MAX_COLORS = 8;
const MAX_CLICKS = 4;
const MAX_TRAIL = 24;
const CLICK_LIFE = 1.2;
const TRAIL_LIFE = 0.7;
const TRAIL_STEP = 0.015;
const INTRO_SECONDS = 2.4;
const ATLAS_CELL_W = 60;
const ATLAS_CELL_H = 100;
const ATLAS_COLUMNS = 16;
const FONT_SCALE = 0.78;
/** Thin glyphs glow on a dark surface; on a light one they need the ink. */
const GLYPH_WEIGHT: Record<AsciiSurface, number> = { dark: 300, light: 500 };
const SHAPES: Record<AsciiShape, number> = { horizon: 0, pinch: 1, rise: 2, eclipse: 3, wave: 4, rings: 5, beam: 6, orbit: 7, cloud: 8 };
const CLICK_EFFECTS: Record<AsciiClickEffect, number> = { none: 0, wave: 1, burst: 2 };

const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

// The light: one of nine shapes, warped by noise, toned along the ramp in
// Oklab. Also writes, to a second target, how far the intro has revealed each
// point and how scrambled the pointer and clicks have left it.
const FIELD = `#version 300 es
precision highp float;
precision highp int;
uniform float uAspect;
uniform vec2 uCenter;
uniform float uTime;
uniform int uShape;
uniform vec3 uRamp[8];
uniform int uCount;
uniform float uScale;
uniform float uSoftness;
uniform float uFlow;
uniform vec2 uSeed;
uniform vec4 uTrail[24];
uniform float uRadius;
uniform vec4 uClicks[4];
uniform int uClickEffect;
uniform float uIntro;
uniform float uFrame;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;
${COMMON}
vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy) * 2.0 - 1.0;
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash22(i), f);
  float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return 0.5 + 0.5 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    v += a * noise(q);
    q = q * 2.1 + vec2(float(i) * 1.72 + 3.1, float(i) * 0.93 + 1.7);
    a *= 0.5;
  }
  return v;
}

vec3 labToRgb(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 horizon(vec2 p, float time, out float order) {
  float span = 0.5 * max(uAspect, 1.0);
  float x = p.x / span;
  float arch = -0.17 - 0.2 * x * x + 0.02 * sin(time * 0.6);
  float soft = mix(0.05, 0.22, uSoftness);
  float edge = p.y - arch;
  float rim = 0.38 * smoothstep(-soft, 0.42, edge);
  vec2 sun = vec2(0.08 * sin(time * 0.31) * span, 0.58);
  float spread = length((p - sun) / vec2(0.95 * span, 0.75));
  float sky = mix(0.55, 1.0, smoothstep(0.2, 0.95, spread));
  order = clamp(edge * 1.3, 0.0, 1.0);
  return vec3(rim, sky, smoothstep(0.18, 0.62, edge));
}

vec3 pinch(vec2 p, float time, out float order) {
  float span = 0.5 * max(uAspect, 0.75);
  float x = p.x / span;
  float sway = 0.02 * sin(x * 1.7 + time * 0.55);
  float breathe = 1.0 + 0.06 * sin(time * 0.8);
  float width = (0.13 + 0.22 * x * x) * breathe * mix(0.85, 1.2, uSoftness);
  float y = abs(p.y - sway) / width;
  float t = exp(-pow(y, 2.2)) * (0.42 + 0.58 * exp(-x * x * 1.8));
  order = clamp(abs(p.y - sway) * 2.4 + abs(x) * 0.3, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 rise(vec2 p, float time, out float order) {
  float wide = max(uAspect, 0.9);
  vec2 center = vec2(0.05 * sin(time * 0.45) * wide, -${ASCII_RISE_SOURCE.toFixed(2)});
  vec2 radius = vec2(0.82 * wide, 0.64 * (1.0 + 0.04 * sin(time * 0.8)));
  float d = length((p - center) / radius);
  float soft = mix(0.6, 1.15, uSoftness);
  float t = clamp(pow(clamp(1.0 - d, 0.0, 1.0), soft) * 1.35, 0.0, 1.0);
  order = clamp((d - 0.2) * 1.3, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 eclipse(vec2 p, float time, out float order) {
  float fit = min(1.0, uAspect * 1.25);
  float r = 0.23 * fit * (1.0 + 0.015 * sin(time * 0.9));
  float angle = atan(p.y, p.x);
  float rays = noise(vec2(cos(angle), sin(angle)) * 2.2 + time * 0.08) * 0.8 + 0.6;
  float d = length(p) - r;
  float reach = mix(0.07, 0.15, uSoftness) * rays * fit;
  float t = smoothstep(-0.006, 0.006 + 0.02 * uSoftness, d) * exp(-max(d, 0.0) / reach);
  order = clamp(d * 2.0, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 wave(vec2 p, float time, out float order) {
  float span = max(uAspect, 0.8);
  float freq = 6.2832 * 2.0 / span;
  float trace = 0.17 * sin(freq * p.x - time * 1.3) + 0.05 * sin(freq * 2.5 * p.x - time * 2.0);
  float soft = mix(0.022, 0.065, uSoftness);
  float core = exp(-pow((p.y - trace) / soft, 2.0));
  float echoTrace = trace + 0.11 + 0.03 * sin(time * 0.7);
  float echo = 0.3 * exp(-pow((p.y - echoTrace) / (soft * 1.6), 2.0));
  float t = clamp(core + echo, 0.0, 1.0);
  order = clamp(p.x / span + 0.5, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 rings(vec2 p, float time, out float order) {
  float dist = length(p);
  float spacing = 0.2;
  float phase = dist / spacing - time * 0.55;
  float sharpness = mix(6.0, 2.5, uSoftness);
  float ring = pow(clamp(0.5 + 0.5 * cos(phase * 6.2832), 0.0, 1.0), sharpness);
  float fade = 1.0 - smoothstep(0.15, 0.95, dist);
  float inner = smoothstep(0.0, 0.07, dist);
  float t = clamp(ring * fade * inner, 0.0, 1.0);
  order = clamp(dist * 2.2, 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 beam(vec2 p, float time, out float order) {
  float cosA = 0.8192;
  float sinA = -0.5736;
  float nx = 0.5736;
  float ny = 0.8192;
  float sweep = 0.28 * sin(time * 0.38);
  float perp = p.x * nx + p.y * ny - sweep;
  float along = p.x * cosA + p.y * sinA;
  float soft = mix(0.07, 0.19, uSoftness);
  float core = exp(-perp * perp / (soft * soft));
  float fade = exp(-along * along * 0.65);
  float t = clamp(core * (0.5 + 0.5 * fade) * 1.3, 0.0, 1.0);
  float span = 0.65;
  order = clamp((along + span) / (2.0 * span), 0.0, 1.0);
  return vec3(t, t, 0.0);
}

vec3 orbit(vec2 p, float time, out float order) {
  float fit = min(1.0, uAspect * 0.8);
  // The path widens with the box, so in a banner the two glows travel apart
  // instead of circling side by side in its middle.
  float reach = 0.3 * fit * max(1.0, uAspect * 0.45);
  float angle = time * 0.6;
  vec2 g1 = vec2(cos(angle) * reach, sin(angle) * 0.2);
  vec2 g2 = -g1;
  float soft = mix(0.07, 0.16, uSoftness);
  float d1 = length(p - g1);
  float d2 = length(p - g2);
  float glow = exp(-d1 * d1 / (soft * soft)) + exp(-d2 * d2 / (soft * soft));
  vec2 seg = g2 - g1;
  float segLen2 = max(dot(seg, seg), 0.0001);
  float along = clamp(dot(p - g1, seg) / segLen2, 0.0, 1.0);
  float bridgeDist = length(p - g1 - along * seg);
  float pinch = 0.3 + 0.7 * abs(along * 2.0 - 1.0);
  float bSoft = soft * 0.45 * pinch;
  float breathe = 0.45 + 0.55 * (0.5 + 0.5 * sin(time * 1.5));
  float bridge = breathe * 0.55 * exp(-bridgeDist * bridgeDist / max(bSoft * bSoft, 0.0001));
  // Eased rather than clipped: a hard clip flattens each glow into a disc of
  // the last glyph, where this keeps a bright centre fading out.
  float total = 1.0 - exp(-1.6 * (glow + bridge));
  order = clamp(min(d1, d2) * 2.8, 0.0, 1.0);
  return vec3(total, total, 0.0);
}

vec3 cloud(vec2 p, float time, out float order) {
  vec2 drift1 = vec2(time * 0.11, time * 0.07);
  vec2 drift2 = vec2(-time * 0.09, time * 0.05);
  // Phase offsets shift the t=0 still frame to a state with visible patches.
  float n1 = fbm3(p * 1.7 + drift1 + vec2(2.3, 1.1));
  float n2 = fbm3(p * 1.0 + drift2 + vec2(5.3, 2.1));
  // fbm3 sits near 0.44 give or take 0.06; spread it over 0..1 first, or no
  // threshold catches more than a few faint wisps.
  float n = clamp((n1 * 0.65 + n2 * 0.35 - 0.44) * 5.0 + 0.5, 0.0, 1.0);
  // Rising across the whole patch rather than levelling off, so a patch keeps
  // a bright heart and grades out instead of filling with the last glyph.
  // Softness lowers where a patch starts, which softens its edge.
  float t = smoothstep(mix(0.58, 0.4, uSoftness), 1.0, n);
  float arrival = clamp((fbm3(p * 1.7 + vec2(1.1, 2.3)) - 0.44) * 5.0 + 0.5, 0.0, 1.0);
  order = 1.0 - arrival;
  return vec3(t, t, 0.0);
}

vec4 tone(float t) {
  float x = smoothstep(0.3, 1.0, t) * float(uCount - 1);
  int index = int(floor(x));
  return vec4(mix(uRamp[index], uRamp[min(index + 1, uCount - 1)], fract(x)), smoothstep(0.0, 0.38, t));
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float time = uTime;
  // The shape moves; p does not, so the pointer still lands where it is.
  vec2 q = (p - uCenter) / uScale;
  vec2 warp = vec2(
    noise(q * 1.6 + uSeed + vec2(0.0, time * 0.3)),
    noise(q * 1.6 + uSeed.yx + vec2(4.3, -time * 0.24))
  ) - 0.5;
  // How far the noise bends each shape: a light touch for the ones drawn as
  // lines (eclipse, wave, rings, beam, orbit) so they keep their form, more
  // for the clouds.
  float bend = 0.18;
  if (uShape == 3) bend = 0.04;
  else if (uShape == 4) bend = 0.08;
  else if (uShape == 5) bend = 0.06;
  else if (uShape == 6) bend = 0.10;
  else if (uShape == 7) bend = 0.08;
  else if (uShape == 8) bend = 0.25;
  q += warp * uFlow * bend;
  float order = 0.0;
  vec3 shape;
  if (uShape == 0) shape = horizon(q, time, order);
  else if (uShape == 1) shape = pinch(q, time, order);
  else if (uShape == 2) shape = rise(q, time, order);
  else if (uShape == 3) shape = eclipse(q, time, order);
  else if (uShape == 4) shape = wave(q, time, order);
  else if (uShape == 5) shape = rings(q, time, order);
  else if (uShape == 6) shape = beam(q, time, order);
  else if (uShape == 7) shape = orbit(q, time, order);
  else shape = cloud(q, time, order);

  float reveal = clamp((uIntro * 1.45 - order) / 0.45, 0.0, 1.0);
  reveal = reveal * reveal * (3.0 - 2.0 * reveal);

  float scramble = 0.0;
  for (int i = 0; i < 24; i++) {
    vec4 point = uTrail[i];
    if (point.z <= 0.0) continue;
    vec2 d = p - point.xy;
    scramble = max(scramble, point.z * exp(-dot(d, d) / (uRadius * uRadius)));
  }
  for (int i = 0; i < 4; i++) {
    vec4 c = uClicks[i];
    if (c.w <= 0.0) continue;
    float d = length(p - c.xy);
    if (uClickEffect == 1) {
      scramble = max(scramble, exp(-pow((d - c.z * 0.75) / 0.06, 2.0)) * c.w);
    } else if (uClickEffect == 2) {
      float size = 0.08 + 0.22 * (1.0 - exp(-c.z * 5.0));
      scramble = max(scramble, (1.0 - smoothstep(size * 0.6, size, d)) * c.w);
    }
  }
  vec2 t = clamp(shape.xy * mix(0.7, 1.0, reveal), 0.0, 1.0);
  vec4 mixed = mix(tone(t.x), tone(t.y), shape.z);
  vec3 color = encode(labToRgb(mixed.rgb));
  float alpha = mixed.a * reveal;
  float dither = (hash12(gl_FragCoord.xy + uFrame * 13.7) - 0.5) / 255.0;
  outColor = clamp(vec4(color * alpha + dither, alpha + dither), 0.0, 1.0);
  outAux = vec4(reveal, scramble, 0.0, 1.0);
}`;

// The glyph a cell shows, shared by the halo pass and the final one: picked
// from the atlas by how bright the light is under the cell, flickered, and
// scrambled where the intro or the pointer says so.
const GLYPHS = `
uniform sampler2D uField;
uniform sampler2D uAux;
uniform sampler2D uAtlas;
uniform vec2 uResolution;
uniform vec2 uCell;
uniform vec2 uOffset;
uniform vec2 uAtlasGrid;
uniform float uCount;
uniform float uDensity;
uniform float uOpacity;
uniform float uFlicker;
uniform float uDepth;
uniform float uGlyphTime;
uniform float uSeedValue;
uniform float uLight;
uniform float uInkGain;
${COMMON}
float sampleGlyph(float index, vec2 local, vec2 coord, float soft) {
  float column = mod(index, uAtlasGrid.x);
  float row = floor(index / uAtlasGrid.x);
  vec2 atlasUv = vec2((column + local.x) / uAtlasGrid.x, (row + 1.0 - local.y) / uAtlasGrid.y);
  vec2 continuous = coord / uAtlasGrid;
  float scale = exp2(soft);
  return textureGrad(uAtlas, atlasUv, dFdx(continuous) * scale, dFdy(continuous) * scale).a;
}

vec4 glyphAt(vec2 px) {
  vec2 coord = (px - uOffset) / uCell;
  vec2 cell = floor(coord);
  vec2 local = coord - cell;
  vec2 uv = clamp(((cell + 0.5) * uCell + uOffset) / uResolution, vec2(0.0), vec2(1.0));
  vec4 field = texture(uField, uv);
  vec4 aux = texture(uAux, uv);
  vec3 visible = uLight > 0.5 ? field.rgb + (1.0 - field.a) : field.rgb;
  float luma = dot(visible, vec3(0.2126, 0.7152, 0.0722));
  float value = uLight > 0.5 ? clamp((1.0 - luma) * uInkGain, 0.0, 1.0) : luma;
  float pick = hash12(cell + uSeedValue * 7.31);
  float level = hash12(cell * 1.73 + 4.1 + uSeedValue);
  float tick = floor(uGlyphTime * 9.0 + level * 9.0);
  float wobble = (hash12(cell * 2.31 + tick * 17.7) - 0.5) * uFlicker * 0.4 + (level - 0.5) * 0.1;
  float tone = clamp(pow(value, 0.75) + wobble, 0.0, 1.0);
  float index = floor(tone * (uCount - 1.0) + 0.5);
  float decode = max(aux.g, 1.0 - aux.r);
  if (decode > 0.02) {
    float frame = floor(uGlyphTime * 20.0);
    if (hash12(cell * 3.7 + frame * 5.3) < decode * 1.25) index = 1.0 + floor(hash12(cell + frame * 1.37) * (uCount - 1.0));
  }
  float present = step(pick, uDensity * mix(1.0, 0.3 + tone * 1.1, 0.55));
  float cutoff = smoothstep(0.03, 0.1, value);
  float focus = step(hash12(cell * 0.71 + 9.2 + uSeedValue), uDepth);
  float coverage = sampleGlyph(index, local, coord, focus * 1.2);
  float alpha = uOpacity * present * cutoff * coverage * mix(1.0, 0.35 + 0.65 * level, 0.55) * (1.0 - focus * 0.5);
  if (uLight < 0.5) {
    vec3 light = field.rgb * 0.55 + vec3(0.03) * field.a;
    return vec4(light * alpha, 0.6 * field.a * alpha);
  }
  vec3 ink = visible * 0.8;
  return vec4(ink * alpha, alpha);
}
`;

const HALO = `#version 300 es
precision highp float;
uniform float uDownscale;
in vec2 vUv;
out vec4 outColor;
${GLYPHS}
void main() {
  outColor = glyphAt(gl_FragCoord.xy * uDownscale);
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 sum = texture(uSource, vUv) * 0.2270270270;
  sum += texture(uSource, vUv + uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uSource, vUv - uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uSource, vUv + uStep * 3.2307692308) * 0.0702702703;
  sum += texture(uSource, vUv - uStep * 3.2307692308) * 0.0702702703;
  outColor = sum;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uHalo;
uniform float uGlow;
uniform float uGradient;
uniform float uGrain;
uniform float uFrame;
in vec2 vUv;
out vec4 outColor;
${GLYPHS}
void main() {
  vec4 base = texture(uField, vUv) * uGradient;
  vec4 glyph = glyphAt(gl_FragCoord.xy);
  vec4 halo = texture(uHalo, vUv) * uGlow;
  vec4 color;
  if (uLight < 0.5) {
    color = base + glyph + halo;
  } else {
    color = glyph + base * (1.0 - glyph.a);
    color += halo * 0.6 * (1.0 - color.a);
  }
  float grain = (hash12(gl_FragCoord.xy + uFrame * vec2(17.0, 59.0)) + hash12(gl_FragCoord.xy * 1.31 + uFrame * 7.0) - 1.0) * uGrain;
  float body = clamp(color.a, 0.0, 1.0);
  color.rgb += grain * (0.25 + body) * 0.5;
  color.a = clamp(color.a, 0.0, 1.0);
  color.rgb = clamp(color.rgb, 0.0, color.a);
  outColor = color;
}`;

type Rgb = [number, number, number];
type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> };
type Target = { textures: WebGLTexture[]; framebuffer: WebGLFramebuffer; width: number; height: number };
type Atlas = { texture: WebGLTexture; count: number; grid: [number, number] };
type Mark = { x: number; y: number; age: number };

/** The props the way the drawing loop reads them: clamped, shapes and click
 *  effects as the shader's numbers. */
type FieldSettings = {
  colors: readonly string[];
  surface: AsciiSurface;
  shape: number;
  center: readonly [number, number];
  characters: string;
  cellSize: number;
  density: number;
  glyphOpacity: number;
  gradientOpacity: number;
  glow: number;
  depthOfField: number;
  flicker: number;
  softness: number;
  scale: number;
  flow: number;
  speed: number;
  grain: number;
  variation: number;
  pointerScramble: boolean;
  scrambleRadius: number;
  clickEffect: number;
  intro: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Brightness the way the glyph pass weighs it: Rec. 709 on encoded sRGB. */
const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

/** sRGB to Oklab, which the ramp is mixed in so its midpoints do not muddy. */
function toLab([r, g, b]: Rgb): Rgb {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  // Otherwise the field just draws nothing: in development, say why.
  if (process.env.NODE_ENV !== "production") console.warn("GradientAscii shader:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function link(gl: WebGL2RenderingContext, fragmentSource: string): Program | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== "production") console.warn("GradientAscii program:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const uniforms: Program["uniforms"] = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, "");
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function createTarget(gl: WebGL2RenderingContext, count: number): Target {
  const textures = Array.from({ length: count }, () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  });
  return { textures, framebuffer: gl.createFramebuffer(), width: 0, height: 0 };
}

function sizeTarget(gl: WebGL2RenderingContext, target: Target, width: number, height: number) {
  if (target.width === width && target.height === height) return;
  target.width = width;
  target.height = height;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  target.textures.forEach((texture, i) => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/** Every distinct glyph drawn once, white on clear, into a mipmapped grid. */
function buildAtlas(gl: WebGL2RenderingContext, characters: string, font: string): Atlas {
  const list = [...new Set([...characters].filter((char) => char !== "\n" && char !== "\r"))];
  if (!list.length) list.push(" ");
  const columns = Math.min(ATLAS_COLUMNS, list.length);
  const rows = Math.ceil(list.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_CELL_W * columns;
  canvas.height = ATLAS_CELL_H * rows;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#fff";
    list.forEach((char, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      context.fillText(char, column * ATLAS_CELL_W + ATLAS_CELL_W / 2, row * ATLAS_CELL_H + ATLAS_CELL_H / 2 + 3);
    });
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, count: list.length, grid: [columns, rows] };
}

/**
 * Builds the field inside `host` and runs it until the function it returns
 * is called; null where WebGL2 will not start. Reads the props through
 * `settingsRef` on every frame, and leaves `wakeRef` holding the call that
 * asks for one more frame (a prop change while the field is still).
 */
function mountField(
  host: HTMLElement,
  probe: HTMLElement,
  settingsRef: RefObject<FieldSettings>,
  wakeRef: RefObject<(() => void) | null>,
): (() => void) | null {
  // Made here rather than rendered, so Strict Mode's second mount gets a
  // fresh canvas: the first one's context is lost on the way out.
  const canvas = document.createElement("canvas");
  canvas.className = "absolute inset-0 block size-full";
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;

  const field = link(gl, FIELD);
  const halo = link(gl, HALO);
  const blur = link(gl, BLUR);
  const composite = link(gl, COMPOSITE);
  if (!field || !halo || !blur || !composite) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  const vao = gl.createVertexArray();
  const fieldTarget = createTarget(gl, 2);
  const haloA = createTarget(gl, 1);
  const haloB = createTarget(gl, 1);
  host.appendChild(canvas);
  host.dataset.gradientAscii = "live";

  // Any CSS colour to sRGB: the probe resolves theme variables, then a 2D
  // canvas converts whatever colour space the token is written in.
  const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const read = (value: string): Rgb => {
    probe.style.color = "";
    probe.style.color = value;
    const resolved = getComputedStyle(probe).color;
    if (!paint) return [0, 0, 0];
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = "#000";
    paint.fillStyle = resolved;
    paint.fillRect(0, 0, 1, 1);
    const [r, g, b] = paint.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };

  // The element's own typeface (font-mono unless its class says other).
  const family = getComputedStyle(host).fontFamily;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const view = { width: 1, height: 1, ratio: 1 };
  const ramp = new Float32Array(MAX_COLORS * 3);
  const clickData = new Float32Array(MAX_CLICKS * 4);
  const clicks: Mark[] = [];
  const trailData = new Float32Array(MAX_TRAIL * 4);
  const trail: Mark[] = [];
  const pointer = { x: 0, y: 0, inside: false };
  let atlas: Atlas | null = null;
  let atlasKey = "";
  let paletteKey = "";
  let inkGain = 1;
  let time = 0;
  let glyphTime = 0;
  let introClock = settingsRef.current.intro && !reduce ? 0 : 1;
  let frameSeed = 0;
  let grainClock = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let disposed = false;

  const syncAtlas = () => {
    const s = settingsRef.current;
    const font = `${GLYPH_WEIGHT[s.surface]} ${Math.round(ATLAS_CELL_H * FONT_SCALE)}px ${family}`;
    const key = `${font}|${s.characters}`;
    if (key === atlasKey && atlas) return;
    atlasKey = key;
    if (atlas) gl.deleteTexture(atlas.texture);
    atlas = buildAtlas(gl, s.characters, font);
    // Drawn again once the face has loaded, if it had not yet.
    document.fonts?.load?.(font, s.characters).then(
      () => {
        if (disposed || atlasKey !== key) return;
        if (atlas) gl.deleteTexture(atlas.texture);
        atlas = buildAtlas(gl, s.characters, font);
        draw();
      },
      () => {},
    );
  };

  const syncPalette = () => {
    const s = settingsRef.current;
    const key = `${s.surface}|${s.colors.join(",")}`;
    if (key === paletteKey) return;
    paletteKey = key;
    const ordered = (s.surface === "light" ? [...s.colors].reverse() : s.colors).map(read);
    ordered.forEach((rgb, i) => ramp.set(toLab(rgb), i * 3));
    // On a light surface a glyph is picked by how far the wash is from
    // white, and only the ramp's strongest tone earns the fullest glyph:
    // without this, every grey darker than a third would draw it, and an
    // ink ramp would fill in as a solid wall of the last character.
    inkGain = 1 / Math.max(0.1, 1 - luma(ordered[ordered.length - 1]));
  };

  const bindGlyphs = (program: Program, width: number, height: number) => {
    if (!atlas) return;
    const s = settingsRef.current;
    const u = program.uniforms;
    const cellH = s.cellSize * view.ratio;
    const cellW = cellH * (ATLAS_CELL_W / ATLAS_CELL_H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTarget.textures[0]);
    gl.uniform1i(u.uField, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fieldTarget.textures[1]);
    gl.uniform1i(u.uAux, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
    gl.uniform1i(u.uAtlas, 2);
    gl.uniform2f(u.uResolution, width, height);
    gl.uniform2f(u.uCell, cellW, cellH);
    gl.uniform2f(
      u.uOffset,
      (width - Math.ceil(width / cellW) * cellW) / 2,
      (height - Math.ceil(height / cellH) * cellH) / 2,
    );
    gl.uniform2f(u.uAtlasGrid, atlas.grid[0], atlas.grid[1]);
    gl.uniform1f(u.uCount, atlas.count);
    gl.uniform1f(u.uDensity, s.density);
    gl.uniform1f(u.uOpacity, s.glyphOpacity);
    gl.uniform1f(u.uFlicker, reduce ? 0 : s.flicker);
    gl.uniform1f(u.uDepth, s.depthOfField);
    gl.uniform1f(u.uGlyphTime, glyphTime);
    gl.uniform1f(u.uSeedValue, s.variation);
    gl.uniform1f(u.uLight, s.surface === "light" ? 1 : 0);
    gl.uniform1f(u.uInkGain, inkGain);
  };

  const draw = () => {
    const s = settingsRef.current;
    const aspect = view.width / view.height;
    syncAtlas();
    syncPalette();
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fieldTarget.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, fieldTarget.width, fieldTarget.height);
    gl.useProgram(field.program);
    const fu = field.uniforms;
    gl.uniform1f(fu.uAspect, aspect);
    // From CSS's top-left shares to the shader's centred, y-up space.
    gl.uniform2f(fu.uCenter, (s.center[0] - 0.5) * aspect, 0.5 - s.center[1]);
    gl.uniform1f(fu.uTime, time);
    gl.uniform1i(fu.uShape, s.shape);
    gl.uniform3fv(fu.uRamp, ramp);
    gl.uniform1i(fu.uCount, s.colors.length);
    gl.uniform1f(fu.uScale, s.scale);
    gl.uniform1f(fu.uSoftness, s.softness);
    gl.uniform1f(fu.uFlow, s.flow);
    gl.uniform2f(fu.uSeed, s.variation * 3.17, s.variation * 1.91);
    gl.uniform4fv(fu.uTrail, trailData);
    gl.uniform1f(fu.uRadius, s.scrambleRadius);
    gl.uniform4fv(fu.uClicks, clickData);
    gl.uniform1i(fu.uClickEffect, s.clickEffect);
    gl.uniform1f(fu.uIntro, introClock);
    gl.uniform1f(fu.uFrame, frameSeed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const glowing = s.glow > 0.001;
    if (glowing) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, haloA.framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, haloA.width, haloA.height);
      gl.useProgram(halo.program);
      bindGlyphs(halo, canvas.width, canvas.height);
      gl.uniform1f(halo.uniforms.uDownscale, canvas.width / haloA.width);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(blur.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(blur.uniforms.uSource, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, haloB.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, haloA.textures[0]);
      gl.uniform2f(blur.uniforms.uStep, 1 / haloA.width, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, haloA.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, haloB.textures[0]);
      gl.uniform2f(blur.uniforms.uStep, 0, 1 / haloA.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(composite.program);
    bindGlyphs(composite, canvas.width, canvas.height);
    const cu = composite.uniforms;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, haloA.textures[0]);
    gl.uniform1i(cu.uHalo, 3);
    gl.uniform1f(cu.uGlow, glowing ? s.glow : 0);
    gl.uniform1f(cu.uGradient, s.gradientOpacity);
    gl.uniform1f(cu.uGrain, s.grain);
    gl.uniform1f(cu.uFrame, frameSeed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const resize = () => {
    view.width = Math.max(1, host.clientWidth);
    view.height = Math.max(1, host.clientHeight);
    view.ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(view.width * view.ratio));
    canvas.height = Math.max(1, Math.round(view.height * view.ratio));
    sizeTarget(gl, fieldTarget, Math.max(1, Math.round(canvas.width / 2)), Math.max(1, Math.round(canvas.height / 2)));
    const haloWidth = Math.max(1, Math.round(canvas.width / 4));
    const haloHeight = Math.max(1, Math.round(canvas.height / 4));
    sizeTarget(gl, haloA, haloWidth, haloHeight);
    sizeTarget(gl, haloB, haloWidth, haloHeight);
    draw();
    wake();
  };

  const age = (marks: Mark[], dt: number, life: number) => {
    marks.forEach((mark) => {
      mark.age += dt;
    });
    while (marks.length && marks[marks.length - 1].age > life) marks.pop();
  };

  const updateInput = (dt: number) => {
    age(trail, dt, TRAIL_LIFE);
    for (let i = 0; i < MAX_TRAIL; i++) {
      const point = trail[i];
      if (!point) {
        trailData[i * 4 + 2] = 0;
        continue;
      }
      const k = 1 - point.age / TRAIL_LIFE;
      trailData.set([point.x, point.y, k * k, 0], i * 4);
    }
    age(clicks, dt, CLICK_LIFE);
    for (let i = 0; i < MAX_CLICKS; i++) {
      const click = clicks[i];
      if (!click) {
        clickData[i * 4 + 3] = 0;
        continue;
      }
      const k = click.age / CLICK_LIFE;
      const envelope = Math.min(1, click.age / 0.08) * (1 - k) * (1 - k);
      clickData.set([click.x, click.y, click.age, envelope], i * 4);
    }
  };

  const frame = (now: number) => {
    raf = 0;
    if (disposed || !visible || document.hidden) return;
    const s = settingsRef.current;
    const dt = last ? clamp((now - last) / 1000, 0.001, 0.05) : 1 / 60;
    last = now;
    if (!reduce) {
      time += dt * s.speed * 0.5;
      glyphTime += dt * Math.max(s.speed, 0.15);
    }
    if (introClock < 1) introClock = Math.min(1, introClock + dt / INTRO_SECONDS);
    grainClock += dt;
    if (!reduce && grainClock > 1 / 24) {
      grainClock = 0;
      frameSeed = (frameSeed + 1) % 97;
    }
    updateInput(dt);
    draw();
    // Under reduced motion the loop stops once nothing is changing.
    const busy = !reduce || introClock < 1 || clicks.length > 0 || trail.length > 0;
    if (busy) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  function wake() {
    if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  const locate = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = 1 - (event.clientY - rect.top) / Math.max(1, rect.height);
    const aspect = rect.width / Math.max(1, rect.height);
    pointer.inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    pointer.x = (x - 0.5) * aspect;
    pointer.y = y - 0.5;
  };

  // On the window, not the box: the box takes no pointer events, so it never
  // gets in the way of what is under or over it.
  const onPointerMove = (event: PointerEvent) => {
    locate(event);
    if (!pointer.inside || !settingsRef.current.pointerScramble || reduce) return;
    const head = trail[0];
    const gap = head ? Math.hypot(pointer.x - head.x, pointer.y - head.y) : Infinity;
    if (gap < TRAIL_STEP) return;
    // A fast stroke is filled in, so the trail stays a line and not dots.
    if (head && head.age < 0.1) {
      const steps = Math.min(6, Math.floor(gap / (TRAIL_STEP * 2)));
      for (let i = 1; i <= steps; i++) {
        const k = i / (steps + 1);
        trail.unshift({ x: head.x + (pointer.x - head.x) * k, y: head.y + (pointer.y - head.y) * k, age: 0 });
      }
    }
    trail.unshift({ x: pointer.x, y: pointer.y, age: 0 });
    trail.length = Math.min(trail.length, MAX_TRAIL);
    wake();
  };

  const onPointerDown = (event: PointerEvent) => {
    locate(event);
    if (!pointer.inside || !settingsRef.current.clickEffect || reduce) return;
    clicks.unshift({ x: pointer.x, y: pointer.y, age: 0 });
    if (clicks.length > MAX_CLICKS) clicks.pop();
    wake();
  };

  const onVisibility = () => {
    last = 0;
    wake();
  };

  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  // Only animate while on screen: a hidden rAF loop is a battery cost for
  // nothing.
  const visibility = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) {
      last = 0;
      wake();
    }
  });
  visibility.observe(host);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  resize();
  wakeRef.current = wake;

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    wakeRef.current = null;
    sizeObserver.disconnect();
    visibility.disconnect();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("visibilitychange", onVisibility);
    [fieldTarget, haloA, haloB].forEach((target) => {
      target.textures.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteFramebuffer(target.framebuffer);
    });
    if (atlas) gl.deleteTexture(atlas.texture);
    gl.deleteVertexArray(vao);
    [field, halo, blur, composite].forEach((item) => gl.deleteProgram(item.program));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
    delete host.dataset.gradientAscii;
  };
}

export type GradientAsciiProps = {
  /** Two to eight CSS colours, darkest to lightest; theme variables resolve.
   *  Defaults to the ink greys. */
  colors?: readonly string[];
  /** What it is drawn on: which end of the ramp is the core (see above). */
  surface?: AsciiSurface;
  /** Nine shapes: horizon (glow over a dark arc), pinch (squeezed band), rise
   *  (upward glow from the bottom), eclipse (halo around a disc), wave (signal
   *  trace with a harmonic and an echo), rings (concentric ripples from the
   *  centre), beam (diagonal shaft sweeping back and forth), orbit (two glows
   *  circling the centre with a breathing bridge), cloud (drifting fbm patches). */
  shape?: AsciiShape;
  /** Where the middle of the shape's frame sits, as shares of the box's width
   *  and height from its top left, the way CSS reads a position: [1, 0] rings
   *  an eclipse round the top-right corner. `riseFromTop` gives the one that
   *  pours a rise out of the top edge. */
  center?: readonly [number, number];
  /** Glyphs from faintest to fullest; brighter light uses later ones. */
  characters?: string;
  /** Height of a glyph's cell, in CSS px. */
  cellSize?: number;
  /** Share of cells that show a glyph, 0 to 1; the bright parts fill first. */
  density?: number;
  /** How strongly the glyphs stand out from the gradient, 0 to 1. */
  glyphOpacity?: number;
  /** The gradient under the glyphs, 0 to 1. At 0 only the glyphs are left. */
  gradientOpacity?: number;
  /** A soft halo round the glyphs, 0 to 2. 0 skips its two passes. */
  glow?: number;
  /** Share of glyphs drawn out of focus, 0 to 1. */
  depthOfField?: number;
  /** How often glyphs trade brightness with their neighbours, 0 to 1. */
  flicker?: number;
  /** How soft the shape's edges are, 0 to 1. */
  softness?: number;
  /** Size of the shape, 0.4 to 2.5. */
  scale?: number;
  /** How much the light wavers as it drifts, 0 to 2. */
  flow?: number;
  /** Speed of the drift. 0 holds the shape still. */
  speed?: number;
  /** Film grain, 0 to 0.4. */
  grain?: number;
  /** Picks a different drift and a different scatter of glyphs. */
  variation?: number;
  /** Scramble the glyphs under the pointer as it moves; they settle back. */
  pointerScramble?: boolean;
  /** Size of that scramble, as a share of the box's height. */
  scrambleRadius?: number;
  /** What a click inside the box does to the glyphs. */
  clickEffect?: AsciiClickEffect;
  /** Fade the light in from its source while the glyphs decode. */
  intro?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function GradientAscii({
  colors = ASCII_DEFAULTS.colors,
  surface = ASCII_DEFAULTS.surface,
  shape = ASCII_DEFAULTS.shape,
  center = ASCII_DEFAULTS.center,
  characters = ASCII_DEFAULTS.characters,
  cellSize = ASCII_DEFAULTS.cellSize,
  density = ASCII_DEFAULTS.density,
  glyphOpacity = ASCII_DEFAULTS.glyphOpacity,
  gradientOpacity = ASCII_DEFAULTS.gradientOpacity,
  glow = ASCII_DEFAULTS.glow,
  depthOfField = ASCII_DEFAULTS.depthOfField,
  flicker = ASCII_DEFAULTS.flicker,
  softness = ASCII_DEFAULTS.softness,
  scale = ASCII_DEFAULTS.scale,
  flow = ASCII_DEFAULTS.flow,
  speed = ASCII_DEFAULTS.speed,
  grain = ASCII_DEFAULTS.grain,
  variation = ASCII_DEFAULTS.variation,
  pointerScramble = ASCII_DEFAULTS.pointerScramble,
  scrambleRadius = ASCII_DEFAULTS.scrambleRadius,
  clickEffect = ASCII_DEFAULTS.clickEffect,
  intro = ASCII_DEFAULTS.intro,
  className,
  style,
}: GradientAsciiProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const palette = (colors.length ? colors : ASCII_DEFAULTS.colors).slice(0, MAX_COLORS);
  const settings: FieldSettings = {
    colors: palette.length > 1 ? palette : [palette[0], palette[0]],
    surface,
    shape: SHAPES[shape] ?? 0,
    center,
    characters: characters || ASCII_DEFAULTS.characters,
    cellSize: clamp(cellSize, 6, 64),
    density: clamp(density, 0, 1),
    glyphOpacity: clamp(glyphOpacity, 0, 1),
    gradientOpacity: clamp(gradientOpacity, 0, 1),
    glow: clamp(glow, 0, 2),
    depthOfField: clamp(depthOfField, 0, 1),
    flicker: clamp(flicker, 0, 1),
    softness: clamp(softness, 0, 1),
    scale: clamp(scale, 0.4, 2.5),
    flow: clamp(flow, 0, 2),
    speed: Math.max(0, speed),
    grain: clamp(grain, 0, 0.4),
    variation: Math.max(0, variation),
    pointerScramble,
    scrambleRadius: clamp(scrambleRadius, 0.02, 0.4),
    clickEffect: CLICK_EFFECTS[clickEffect] ?? 1,
    intro,
  };
  const settingsRef = useRef<FieldSettings>(settings);

  // Before the drawing effect below, so its first frame reads these. Every
  // render hands the loop the latest props and wakes it for one frame, which
  // is how a prop change shows up while the field is otherwise still.
  useEffect(() => {
    settingsRef.current = settings;
    wakeRef.current?.();
  });

  useEffect(() => {
    const host = hostRef.current;
    const probe = probeRef.current;
    // No WebGL2 at all (older browsers, jsdom): draw nothing.
    if (!host || !probe || !("WebGL2RenderingContext" in window)) return;
    let stop: (() => void) | null = null;
    // Nothing is built until the box first comes on screen, so a field in a
    // picture hidden at this width (a settings card's corner on a phone) never
    // costs a WebGL context, and its intro plays where it is seen.
    const arrival = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      arrival.disconnect();
      stop = mountField(host, probe, settingsRef, wakeRef);
    });
    arrival.observe(host);
    return () => {
      arrival.disconnect();
      stop?.();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn("pointer-events-none relative size-full overflow-hidden font-mono", className)}
      style={style}
    >
      <span ref={probeRef} hidden />
    </div>
  );
}

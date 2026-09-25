"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Light rays radiating from the centre of the box, all the way round, drifting
 * slowly in a circle. The ray field is React Bits' LightRays shader (two layers
 * of angular sine bands, each phase-shifted by time) turned from a cone shone
 * down from the top into a full circle: the angle is taken round the centre, so
 * the bands become rays, and every frequency is a whole number so the pattern
 * closes on itself with no seam. The two layers move in opposite directions,
 * which is what gives the shimmer, and the whole field turns slowly on top.
 *
 * Plain WebGL rather than a library: one full-screen triangle and one shader is
 * all this needs. Decorative and best effort. It draws nothing where WebGL is
 * unavailable (the caller keeps a static glow underneath for that), runs only
 * while on screen, and under reduced motion draws one still frame instead of
 * animating (styles.md §6.2).
 */

const VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColor;
uniform float uIntensity;

// LightRays' ray band, on the angle round the centre. Whole-number frequencies
// so the pattern meets itself at the back of the circle with no seam.
float rays(float angle, float a, float b, float speed) {
  return clamp(
    (0.45 + 0.15 * sin(angle * a + uTime * speed)) +
    (0.30 + 0.20 * cos(-angle * b + uTime * speed)),
    0.0, 1.0);
}

void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uResolution;
  float radius = 0.5 * min(uResolution.x, uResolution.y);
  float d = length(p) / radius;
  // The slow turn of the whole field: roughly one revolution every 2 minutes.
  float angle = atan(p.y, p.x) + uTime * 0.05;
  float r1 = rays(angle, 19.0, 11.0, 0.8);
  float r2 = rays(angle, 29.0, 7.0, 0.5);
  // Sharpened, so the bands read as rays rather than soft lobes.
  float streaks = pow(r1 * 0.55 + r2 * 0.45, 3.0);
  // Rays of uneven length, and the unevenness travels round too, so the
  // outline breathes rather than sitting as a perfect disc.
  float reach = 0.72 + 0.18 * sin(angle * 5.0 - uTime * 0.35);
  // Strongest just outside the centre, gone well before the edge of the box.
  float falloff = smoothstep(0.0, 0.2, d) * (1.0 - smoothstep(0.25, reach, d));
  float a = clamp(streaks * falloff * uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(uColor * a, a);
}`;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
    : [1, 1, 1];
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function RadialLightRays({
  color = "#4ade80",
  speed = 1,
  intensity = 1,
  className,
}: {
  /** Strict 6-digit hex. */
  color?: string;
  /** Multiplies how fast the rays shimmer and turn. */
  speed?: number;
  /** Multiplies how strongly they show. */
  intensity?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    // No WebGL at all (older browsers, jsdom): draw nothing.
    if (!host || typeof window === "undefined" || !("WebGLRenderingContext" in window)) return;

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One triangle that covers the whole viewport.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "uTime");
    const uResolution = gl.getUniformLocation(program, "uResolution");
    gl.uniform3fv(gl.getUniformLocation(program, "uColor"), hexToRgb(color));
    gl.uniform1f(gl.getUniformLocation(program, "uIntensity"), intensity);

    host.appendChild(canvas);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(host.clientWidth * dpr));
      const height = Math.max(1, Math.round(host.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uResolution, width, height);
    };

    const draw = (seconds: number) => {
      gl.uniform1f(uTime, seconds * speed);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frame = 0;
    let running = false;
    const loop = (now: number) => {
      draw(now / 1000);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || still) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    resize();
    // Reduced motion: one frame, a few seconds in so the rays are well formed.
    if (still) draw(4);

    const sizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            resize();
            if (still) draw(4);
          });
    sizeObserver?.observe(host);

    // Only animate while on screen: a list's empty state is often scrolled
    // past, and a hidden rAF loop is a battery cost for nothing.
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => (entries[0]?.isIntersecting ? start() : stop()));
    if (visibility) visibility.observe(host);
    else start();

    return () => {
      stop();
      sizeObserver?.disconnect();
      visibility?.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [color, speed, intensity]);

  return <div ref={hostRef} aria-hidden="true" className={cn("pointer-events-none", className)} />;
}

import { useEffect, useRef } from "react";
import { audio } from "./audio";
import { useApp } from "./state";
import { useSettings } from "./settings";

/* Dust in the room's light, as in the promo films: soft specks drifting up and swaying, nearer ones bigger and
   faster (and leaning a little with the pointer); while music plays they glint on the kicks. One canvas behind
   the screens, a pre-drawn sprite per speck, nothing drawn while the window is hidden or in mini mode. */

interface Mote { x: number; y: number; size: number; speed: number; sway: number; phase: number; alpha: number; depth: number }
const MAX = 140;

function sprite(): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,248,238,1)"); grad.addColorStop(.25, "rgba(255,244,230,.55)"); grad.addColorStop(1, "rgba(255,236,220,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return c;
}

export function Particles() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const on = useSettings((s) => s.particles);
  useEffect(() => {
    const cv = canvas.current;
    if (!on || !cv) return;
    const g = cv.getContext("2d")!, dot = sprite();
    let w = 0, h = 0, dpr = 1;
    const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); w = innerWidth; h = innerHeight; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); };
    resize(); addEventListener("resize", resize);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const motes: Mote[] = Array.from({ length: MAX }, () => {
      const depth = Math.pow(Math.random(), 1.6) * .85 + .15;
      return { x: Math.random(), y: Math.random(), size: rnd(1.4, 4.2) * depth, speed: rnd(.006, .022) * depth, sway: rnd(8, 26) * depth, phase: rnd(0, 6.28), alpha: rnd(.25, .8), depth };
    });
    // the pointer leans the nearer dust a little: depth without a camera
    let px = 0, py = 0, lx = 0, ly = 0;
    const move = (event: PointerEvent) => { px = event.clientX / innerWidth - .5; py = event.clientY / innerHeight - .5; };
    addEventListener("pointermove", move, { passive: true });
    // the beat: a fast envelope over a slow average of the music's level
    let avg = 0, glint = 0, fade = 0, raf = 0, last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const app = useApp.getState(), set = useSettings.getState();
      if (document.hidden || app.mini) return;
      // fade in when switched on
      fade = Math.min(1, fade + dt / .8);
      if (set.particlesReact && app.phase === "PLAYING") {
        const level = audio.readout().musicRms;
        avg += (level - avg) * Math.min(1, dt * 1.5);
        const hit = Math.max(0, level - avg * 1.25) * 9;
        glint = Math.max(glint * Math.exp(-dt / .16), Math.min(1, hit));
      } else glint *= Math.exp(-dt / .3);
      lx += (px - lx) * Math.min(1, dt * 2); ly += (py - ly) * Math.min(1, dt * 2);
      const count = Math.round(MAX * set.particleAmount);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      const t = now / 1000, scale = Math.max(w, h) / 1920;
      for (let i = 0; i < count; i++) {
        const m = motes[i];
        m.y -= m.speed * dt * (1 + glint * .6);
        if (m.y < -.05) { m.y = 1.05; m.x = Math.random(); }
        const x = m.x * w + Math.sin(t * .45 + m.phase) * m.sway * scale - lx * 40 * m.depth * scale;
        const y = m.y * h - ly * 26 * m.depth * scale;
        const s = m.size * scale * (1 + glint * .7 * m.depth) * 2.4;
        g.globalAlpha = Math.min(1, m.alpha * fade * (.32 + .55 * m.depth + glint * .9 * m.depth));
        g.drawImage(dot, x - s, y - s, s * 2, s * 2);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", move); g.clearRect(0, 0, cv.width, cv.height); };
  }, [on]);
  return on ? <canvas className="particles" ref={canvas} aria-hidden="true" /> : null;
}

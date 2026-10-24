import { useEffect, useRef } from "react";
import { useApp } from "./state";
import { useSettings } from "./settings";
import { audio } from "./audio";
import { trackAccent } from "./palette";
import type { Rgb } from "./palette";

/* The crossfade, seen. While one track hands over to the next:
   - behind the deck and the room's controls, a soft spiral of light drifts through the background: the strands of the track
     going out shrink and fade, the strands of the one coming in unwind and brighten (the back canvas);
   - the lights go down towards the middle of the handover to a spotlight on the record, and when the new track takes over they
     come back opening outward from it, with nothing on its edge (no wave); every low beat of the music
     then lights the record for a moment (the front canvas).
   Each track has its own shade of the album's colour (palette.ts). Drawn only while a crossfade runs (state.fade, set by
   the player); neither canvas takes a click. */

const TAU = Math.PI * 2;
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, a).toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
/** how dark the room gets outside the spotlight at most (0..1), the moment the lights come back (share of the crossfade) */
const DARK = .62, BURST = .52;

export function CrossfadeSpiral() {
  const fade = useApp((state) => state.fade);
  const enabled = useSettings((state) => state.crossfadeAnimation);
  const hue = useApp((state) => state.albums.find((album) => album.id === state.activeAlbumId)?.colors.hDominant ?? 260);
  const chroma = useApp((state) => state.albums.find((album) => album.id === state.activeAlbumId)?.colors.cMean ?? .1);
  // the room is light (a pale cover, App.tsx): light on light is invisible, so the animation is drawn in ink instead
  const onLight = useApp((state) => (state.albums.find((album) => album.id === state.activeAlbumId)?.colors.lMean ?? 0) > .62);
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const bk = back.current, fr = front.current;
    if (!bk || !fr || !fade) return;
    const b = bk.getContext("2d"), f = fr.getContext("2d");
    const quiet = !enabled || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!b || !f) return;
    // animation off (or reduced motion): nothing is drawn, but the bar and the clock still blend, so `fade` lives its length out
    if (quiet) {
      const id = window.setTimeout(() => { if (useApp.getState().fade === fade) useApp.setState({ fade: null }); }, fade.length * 1000 + 60);
      return () => clearTimeout(id);
    }
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0, raf = 0;
    const fit = () => {
      w = innerWidth; h = innerHeight;
      for (const [cv, ctx] of [[bk, b], [fr, f]] as const) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    };
    fit(); addEventListener("resize", fit);
    const from = trackAccent(hue, chroma, fade.from, onLight), to = trackAccent(hue, chroma, fade.to, onLight);
    const blend: GlobalCompositeOperation = onLight ? "source-over" : "lighter", ink = onLight ? 1.7 : 1;
    // a short crossfade gets a lighter touch: the lights have no time to go down that far
    const touch = Math.min(1, fade.length / 5);
    const centre = () => {
      const box = document.querySelector<HTMLElement>(".player-screen .vinyl")?.getBoundingClientRect();
      return box && box.width > 20 ? { x: box.left + box.width / 2, y: box.top + box.height / 2, r: Math.min(box.width, box.height) / 2 * .92 } : { x: w / 2, y: h * .5, r: Math.min(w, h) * .2 };
    };
    const strands = (c: { x: number; y: number }, colours: { main: Rgb; light: Rgb }, gain: number, sign: number, seconds: number) => {
      const soft = w * .16;
      b.save(); b.globalCompositeOperation = blend; b.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const amp = h * (.1 + k * .03) * (.25 + .75 * gain), freq = (2.2 + k * .55) * TAU / w, speed = seconds * (.7 + k * .18) * sign;
        for (let pass = 0; pass < 2; pass++) {
          const phase = pass * Math.PI + k * 1.3;
          let px = 0, py = 0;
          for (let x = 0; x <= w; x += 6) {
            const env = .3 + .7 * smooth(Math.abs(x - c.x) / (w * .3));
            const th = x * freq + speed + phase, y = c.y + Math.sin(th) * amp * env, depth = (Math.cos(th) + 1) / 2;
            if (x) {
              const edge = smooth(x / soft) * smooth((w - x) / soft);
              b.strokeStyle = rgba(pass ? colours.light : colours.main, (.08 + .4 * depth) * gain * (.5 + k * .15) * edge * .6 * ink);
              b.lineWidth = (1 + 2.6 * depth) * (.5 + .5 * gain) * (1 - k * .15);
              b.beginPath(); b.moveTo(px, py); b.lineTo(x, y); b.stroke();
            }
            px = x; py = y;
          }
        }
      }
      b.restore();
    };
    // the lights go down to a spotlight on the record (it narrows, and draws back a little with every low beat), and when the new
    // track takes over they come back opening outward from the record, with no glow on the edge of the opening
    const pulses: { born: number; strength: number }[] = [];
    const band = new Float32Array(2);
    let average = 0, lastBeat = 0, burstAt = 0, releasedAt = 0;
    const OPEN = 1400, PULSE_LIFE = 650, LET_GO = 900;
    const frame = () => {
      const state = useApp.getState();
      const nowMs = performance.now(), u = (nowMs - fade.start) / 1000 / fade.length;
      b.clearRect(0, 0, w, h); f.clearRect(0, 0, w, h);
      // the music was stopped (paused) or went another way (a track picked by hand): the animation does not vanish, it lets go
      // gently over the same moment the sound takes to die away, and does not come back
      if ((state.phase !== "PLAYING" || state.trackIndex !== fade.to) && !releasedAt) releasedAt = nowMs;
      const gone = releasedAt ? clamp((nowMs - releasedAt) / LET_GO) : 0;
      if (gone >= 1) { if (useApp.getState().fade === fade) useApp.setState({ fade: null }); return; }
      bk.style.opacity = String(.9 * (1 - gone)); fr.style.opacity = String(1 - gone);
      while (pulses.length && nowMs - pulses[0].born > PULSE_LIFE) pulses.shift();
      const opened = burstAt ? (nowMs - burstAt) / OPEN : 0;
      // over when the crossfade is, the opening has finished and the last glow has died
      if (u >= 1 && opened >= 1 && !pulses.length) { if (useApp.getState().fade === fade) useApp.setState({ fade: null }); return; }
      const c = centre(), seconds = nowMs / 1000, live = Math.min(1, u);

      /* the back: a soft spiral and a halo round the record, behind everything */
      const env = smooth(live / .42) * smooth((1 - live) / .42);          // it rises and falls gently: nothing pops in or out
      strands(c, from, Math.cos(live * Math.PI / 2) * env, 1, seconds);
      strands(c, to, Math.sin(live * Math.PI / 2) * env, -1, seconds);
      const tint = mix(from.main, to.main, smooth(live)), glow = b.createRadialGradient(c.x, c.y, c.r * .8, c.x, c.y, c.r * 2.4);
      glow.addColorStop(0, rgba(tint, .3 * env * ink)); glow.addColorStop(1, rgba(tint, 0));
      b.fillStyle = glow; b.beginPath(); b.arc(c.x, c.y, c.r * 2.4, 0, TAU); b.fill();

      /* the music: the low end of what is playing now */
      let energy = 0;
      if (!releasedAt) { audio.bands([55, 95], band); energy = (band[0] + band[1]) / 2; }
      if (live >= BURST && !burstAt) { burstAt = nowMs; lastBeat = nowMs; }   // the new track takes over
      // a beat is when the low end jumps over its own running average: it lights the record for a moment
      if (burstAt && !releasedAt && u < 1 && nowMs - lastBeat > 170 && energy > average * 1.35 + .04 && energy > .16) {
        pulses.push({ born: nowMs, strength: clamp((energy - average) * 2.4 + .3) * .8 }); lastBeat = nowMs;
      }
      average += (energy - average) * .05;

      /* the front: the spotlight, and the lights coming back */
      const maxR = Math.hypot(w, h) * .8, tight = c.r * 1.7, feather = c.r * 1.3, depth = DARK * touch;
      let hole: number, alpha: number;
      if (!burstAt) { hole = maxR + (tight - maxR) * smooth(live / (BURST - .08)); alpha = depth * smooth(live / .3); }
      else { hole = tight + (maxR * 1.5 - tight) * easeOut(clamp(opened)); alpha = depth * (1 - smooth((opened - .55) / .45)); }
      hole *= 1 + .05 * clamp(energy * 3);                                 // the dark draws back a little with every low beat
      if (alpha > .004) {
        const veil = f.createRadialGradient(c.x, c.y, hole, c.x, c.y, hole + feather);
        veil.addColorStop(0, "rgba(6,5,10,0)"); veil.addColorStop(1, `rgba(6,5,10,${alpha.toFixed(3)})`);
        f.fillStyle = veil; f.fillRect(0, 0, w, h);
      }
      f.save(); f.globalCompositeOperation = blend;
      for (const pulse of pulses) {
        const q = (nowMs - pulse.born) / PULSE_LIFE, a = Math.pow(1 - q, 2) * pulse.strength * .4 * touch * ink;
        const g = f.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * (1.3 + q * 1.8));
        g.addColorStop(0, rgba(to.light, a)); g.addColorStop(.45, rgba(to.main, a * .5)); g.addColorStop(1, rgba(to.main, 0));
        f.fillStyle = g; f.fillRect(0, 0, w, h);
      }
      f.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", fit); b.clearRect(0, 0, w, h); f.clearRect(0, 0, w, h); bk.style.opacity = ""; fr.style.opacity = ""; };
  }, [fade, enabled, hue, chroma, onLight]);

  return <>
    <canvas ref={back} className="xfade xfade-back" aria-hidden="true" />
    <canvas ref={front} className="xfade xfade-front" aria-hidden="true" />
  </>;
}

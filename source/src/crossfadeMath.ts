/* The arithmetic of the crossfade types (no audio in here: tests/downloads.test.mjs checks it with a million samples of noise).

   Classic: both tracks fade at once on equal-power curves.

   Frequency types split each track into three bands with Linkwitz-Riley crossovers (4th order: two Butterworth sections in
   series), at LOW_HZ and HIGH_HZ. The three bands add up to the track again with a flat magnitude (only the phase turns, as
   in any crossover), so while nothing is changing the sound is the same. Nothing is swept: the cut-offs stay where they are,
   and only the gain of each band moves, band by band, with its own window of time:

       gain going out  = cos(π/2 · w(u))        gain coming in = sin(π/2 · w(u))
       w(u) = 0 before the window, 1 after it, a smooth rise between

   cos² + sin² = 1: in every band the two tracks together keep the same power at every instant (equal-power), and a band
   changes hands inside its window only — never a hole between the tracks, never two basslines at once. */

export type CrossfadeMode = "classic" | "bass" | "spectrum";
export const CROSSFADE_MODES: CrossfadeMode[] = ["classic", "bass", "spectrum"];

/** crossover frequencies, Hz: under LOW_HZ is the bass (kick and bassline), over HIGH_HZ the air (hats, sibilance, shimmer) */
export const LOW_HZ = 160;
export const HIGH_HZ = 2800;
/** Web Audio takes the Q of a low/high-pass in decibels: a Butterworth section (Q = 1/√2) is 20·log10(1/√2) dB */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);

export interface Window { from: number; to: number; smooth: boolean }
export interface Windows { low: Window; mid: Window; high: Window }

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** The bass changes hands in one short window of 0.8 s (but at most 40 % of a short crossfade), late in it, and never closer to
    its end than 5 %: the new track's bass is fully in before the old one's last echo is gone. */
export function bassWindow(length: number): Window {
  const width = clamp(.8 / Math.max(.2, length), .05, .4);
  const from = Math.min(.6, .95 - width);
  return { from, to: from + width, smooth: true };
}

/** When each band changes hands, as shares of the crossfade (0..1). */
export function bandWindows(mode: CrossfadeMode, length: number): Windows {
  const whole: Window = { from: 0, to: 1, smooth: false };            // all through the crossfade, linear: the classic way
  if (mode === "bass") return { low: bassWindow(length), mid: whole, high: whole };
  if (mode === "spectrum") return { low: bassWindow(length), mid: { from: .12, to: .82, smooth: true }, high: { from: 0, to: .6, smooth: true } };
  return { low: whole, mid: whole, high: whole };
}

/** how far through its window a band is at crossfade progress u (0..1) */
export function progressIn(window: Window, u: number): number {
  const w = clamp((u - window.from) / Math.max(1e-9, window.to - window.from));
  return window.smooth ? w * w * (3 - 2 * w) : w;
}

/** equal-power gains of one band at progress u */
export function gainsAt(window: Window, u: number): { out: number; in: number } {
  const w = progressIn(window, u);
  return { out: Math.cos(Math.PI / 2 * w), in: Math.sin(Math.PI / 2 * w) };
}

/** the gain curves of a band as arrays for setValueCurveAtTime (the whole crossfade, `n` points) */
export function bandCurves(window: Window, n = 2048): { out: Float32Array; in: Float32Array } {
  const out = new Float32Array(n), into = new Float32Array(n);
  for (let i = 0; i < n; i++) { const g = gainsAt(window, i / (n - 1)); out[i] = g.out; into[i] = g.in; }
  return { out, in: into };
}

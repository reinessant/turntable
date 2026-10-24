/* The maths of the crossfade types, checked without a browser: `node --test tests/crossfade-math.test.mjs`
   The filters are the ones Web Audio builds (RBJ cookbook coefficients, Q given in dB), so what is proved for them here holds in the player. */
import test from "node:test";
import assert from "node:assert/strict";
import { BUTTERWORTH_Q_DB, HIGH_HZ, LOW_HZ, bandCurves, bandWindows, bassWindow, gainsAt, CROSSFADE_MODES } from "../src/crossfadeMath.ts";

const FS = 44100;
const QLIN = 10 ** (BUTTERWORTH_Q_DB / 20);

/** RBJ cookbook low/high-pass: coefficients [b0, b1, b2, a1, a2] normalised by a0 */
function coefficients(type, hz, q = QLIN, fs = FS) {
  const w0 = 2 * Math.PI * hz / fs, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b = type === "lowpass" ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: -2 * cos / a0, a2: (1 - alpha) / a0 };
}
/** complex response of a section at frequency f */
function response(c, f, fs = FS) {
  const w = 2 * Math.PI * f / fs, z1 = [Math.cos(-w), Math.sin(-w)], z2 = [Math.cos(-2 * w), Math.sin(-2 * w)];
  const num = [c.b0 + c.b1 * z1[0] + c.b2 * z2[0], c.b1 * z1[1] + c.b2 * z2[1]], den = [1 + c.a1 * z1[0] + c.a2 * z2[0], c.a1 * z1[1] + c.a2 * z2[1]];
  const d = den[0] * den[0] + den[1] * den[1];
  return [(num[0] * den[0] + num[1] * den[1]) / d, (num[1] * den[0] - num[0] * den[1]) / d];
}
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const abs = (a) => Math.hypot(a[0], a[1]);
/** Linkwitz-Riley 4th order: two sections in series */
const lr4 = (type, hz) => (f) => { const r = response(coefficients(type, hz), f); return mul(r, r); };
const freqs = Array.from({ length: 400 }, (_, i) => 15 * Math.pow(20000 / 15, i / 399));

test("Q in decibels: the Butterworth value is 1/√2 linear", () => {
  assert.ok(Math.abs(QLIN - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(BUTTERWORTH_Q_DB + 3.0103) < 1e-4);
});

test("a crossover section is −6 dB at its frequency, and its low and high add up flat", () => {
  for (const hz of [LOW_HZ, HIGH_HZ]) {
    assert.ok(Math.abs(abs(lr4("lowpass", hz)(hz)) - .5) < 1e-6, "LP at fc is 0.5");
    assert.ok(Math.abs(abs(lr4("highpass", hz)(hz)) - .5) < 1e-6, "HP at fc is 0.5");
    for (const f of freqs) assert.ok(Math.abs(abs(add(lr4("lowpass", hz)(f), lr4("highpass", hz)(f))) - 1) < 1e-9, `flat at ${f} Hz`);
  }
});

test("the three bands add up to the track: flat magnitude at every frequency (the splitter changes only the phase)", () => {
  const lowP1 = lr4("lowpass", LOW_HZ), highP1 = lr4("highpass", LOW_HZ), lowP2 = lr4("lowpass", HIGH_HZ), highP2 = lr4("highpass", HIGH_HZ);
  let worst = 0;
  for (const f of freqs) {
    const low = mul(lowP1(f), add(lowP2(f), highP2(f))), mid = mul(highP1(f), lowP2(f)), high = mul(highP1(f), highP2(f));
    worst = Math.max(worst, Math.abs(abs(add(add(low, mid), high)) - 1));
  }
  assert.ok(worst < 1e-9, "worst deviation " + worst);
});

test("equal power in every band, at every instant, for every mode and length", () => {
  for (const mode of CROSSFADE_MODES) for (const length of [.5, 1, 2, 3, 4, 6, 8, 12]) {
    const windows = bandWindows(mode, length);
    for (const name of ["low", "mid", "high"]) {
      const w = windows[name];
      assert.ok(w.from >= 0 && w.to <= 1 && w.from < w.to, `${mode} ${name} ${length}`);
      let previousOut = 1, previousIn = 0;
      for (let i = 0; i <= 1000; i++) {
        const g = gainsAt(w, i / 1000);
        assert.ok(Math.abs(g.out * g.out + g.in * g.in - 1) < 1e-12);
        assert.ok(g.out <= previousOut + 1e-12 && g.in >= previousIn - 1e-12, "monotone");
        previousOut = g.out; previousIn = g.in;
      }
      assert.equal(gainsAt(w, 0).out, 1); assert.equal(gainsAt(w, 0).in, 0);
      assert.ok(Math.abs(gainsAt(w, 1).out) < 1e-12); assert.ok(Math.abs(gainsAt(w, 1).in - 1) < 1e-12);
    }
  }
});

test("classic is the plain cos / sin crossfade, in every band", () => {
  const w = bandWindows("classic", 6);
  for (const name of ["low", "mid", "high"]) for (const u of [0, .1, .37, .5, .9, 1]) {
    assert.ok(Math.abs(gainsAt(w[name], u).out - Math.cos(Math.PI / 2 * u)) < 1e-12);
    assert.ok(Math.abs(gainsAt(w[name], u).in - Math.sin(Math.PI / 2 * u)) < 1e-12);
  }
});

test("by frequency: the highs go first, then the middle, the bass last, and the bass swap is short", () => {
  const mid = (w) => (w.from + w.to) / 2;
  for (const length of [2, 3, 4, 6, 8, 12]) {
    const w = bandWindows("spectrum", length);
    assert.ok(mid(w.high) < mid(w.mid) && mid(w.mid) < mid(w.low), `order at ${length}s`);
    const seconds = (w.low.to - w.low.from) * length;
    assert.ok(Math.abs(seconds - Math.min(.8, .4 * length)) < 1e-9, `bass swap ${seconds}s at ${length}s`);
    assert.ok(w.low.to <= .95 + 1e-12, "the new bass is in before the end");
    // while the bass changes hands, both basses are within 10 dB of each other for only a part of the swap
    let both = 0; const N = 20000;
    for (let i = 0; i < N; i++) { const g = gainsAt(w.low, i / N); if (Math.min(g.out, g.in) >= .316) both += length / N; }
    assert.ok(both <= .45 * seconds, `both basses audible for ${both.toFixed(2)} s of a ${seconds.toFixed(2)} s swap at ${length}s`);
  }
  assert.deepEqual(bassWindow(8), bandWindows("bass", 8).low);
  assert.equal(bandWindows("bass", 8).mid.smooth, false);
});

test("the gain curves handed to Web Audio follow the formula (it joins the points with straight lines)", () => {
  for (const [mode, length] of [["spectrum", 2], ["spectrum", 12], ["bass", 3]]) {
    const windows = bandWindows(mode, length);
    for (const name of ["low", "mid", "high"]) {
      const { out, in: into } = bandCurves(windows[name]);
      let worst = 0;
      for (let k = 0; k < 4000; k++) {
        const u = k / 3999, p = u * (out.length - 1), i = Math.min(out.length - 2, Math.floor(p)), t = p - i;
        const g = gainsAt(windows[name], u);
        worst = Math.max(worst, Math.abs(out[i] + (out[i + 1] - out[i]) * t - g.out), Math.abs(into[i] + (into[i + 1] - into[i]) * t - g.in));
      }
      assert.ok(worst < 1e-4, `${mode} ${name} ${length}s: ${worst}`);
    }
  }
});

/* ---------------------------------------------------------------- the whole chain on noise */
class Section {
  constructor(type, hz) { const c = coefficients(type, hz); Object.assign(this, c); this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  run(input) {
    const out = new Float64Array(input.length);
    for (let n = 0; n < input.length; n++) {
      const x = input[n], y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; out[n] = y;
    }
    return out;
  }
}
const lr4run = (type, hz, x) => new Section(type, hz).run(new Section(type, hz).run(x));
function bands(x) {
  const under = lr4run("lowpass", LOW_HZ, x), rest = lr4run("highpass", LOW_HZ, x);
  const lowLP = lr4run("lowpass", HIGH_HZ, under), lowHP = lr4run("highpass", HIGH_HZ, under);
  return { low: lowLP.map((v, i) => v + lowHP[i]), mid: lr4run("lowpass", HIGH_HZ, rest), high: lr4run("highpass", HIGH_HZ, rest) };
}
/** white noise from a seeded generator: steady, so a dip or a bump in the level can only come from the crossfade */
function white(length, seed) {
  let s = seed >>> 0; const out = new Float64Array(length);
  for (let i = 0; i < length; i++) { s = (s * 1664525 + 1013904223) >>> 0; out[i] = s / 4294967296 * 2 - 1; }
  return out;
}
/** pink-ish noise (Kellet's filter) from a seeded generator: music has most of its energy low, white noise does not */
function pink(length, seed) {
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const out = new Float64Array(length); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = rnd();
    b0 = .99886 * b0 + white * .0555179; b1 = .99332 * b1 + white * .0750759; b2 = .969 * b2 + white * .153852; b3 = .8665 * b3 + white * .3104856;
    b4 = .55 * b4 + white * .5329522; b5 = -.7616 * b5 - white * .016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * .5362) * .11; b6 = white * .115926;
  }
  return out;
}
const rmsOf = (x, a, b) => { let sum = 0; for (let i = a; i < b; i++) sum += x[i] * x[i]; return Math.sqrt(sum / (b - a)); };
const db = (ratio) => 20 * Math.log10(ratio);

function crossfade(mode, seconds, a, b) {
  const n = Math.round(seconds * FS), A = bands(a.slice(0, n)), B = bands(b.slice(0, n)), w = bandWindows(mode, seconds), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    for (const name of ["low", "mid", "high"]) { const g = gainsAt(w[name], u); y[i] += g.out * A[name][i] + g.in * B[name][i]; }
  }
  return y;
}

test("on noise: with every gain at 1 the splitter changes nothing audible (level within 0.01 dB)", () => {
  const x = pink(FS * 4, 1), b = bands(x);
  const y = x.map((_, i) => b.low[i] + b.mid[i] + b.high[i]);
  assert.ok(Math.abs(db(rmsOf(y, FS, 4 * FS) / rmsOf(x, FS, 4 * FS))) < .01);
});

test("on noise: two different songs cross-fade at a steady level in every mode (no dip, no bump)", () => {
  const seconds = 8, n = seconds * FS, a = white(n, 11), b = white(n, 977);
  const single = (rmsOf(a, 0, n) + rmsOf(b, 0, n)) / 2;
  const tolerance = { classic: .15, bass: .25, spectrum: .4 };
  for (const mode of CROSSFADE_MODES) {
    const y = crossfade(mode, seconds, a, b);
    let worst = 0;
    const step = Math.round(FS * .25);
    for (let at = Math.round(FS * .2); at + step <= n - Math.round(FS * .2); at += step) worst = Math.max(worst, Math.abs(db(rmsOf(y, at, at + step) / single)));
    assert.ok(worst < tolerance[mode], `${mode}: level strays by ${worst.toFixed(2)} dB (allowed ${tolerance[mode]})`);
    console.log(`  ${mode}: the level stays within ±${worst.toFixed(2)} dB of a single track over the whole crossfade`);
  }
});

test("on noise: in the bass swap the outgoing bass is gone before the new one is fully in, and never both at full", () => {
  const seconds = 8, n = seconds * FS, a = white(n, 5), b = white(n, 6), A = bands(a), B = bands(b), w = bandWindows("spectrum", seconds);
  // the bass left in the mix at each moment: the share of the outgoing bass and of the incoming bass
  for (const u of [.1, .5, .62, .66, .7, .8, .95]) {
    const g = gainsAt(w.low, u), i = Math.round(u * (n - 1)), at = Math.max(0, i - 2000);
    const outShare = g.out * rmsOf(A.low, at, i + 1), inShare = g.in * rmsOf(B.low, at, i + 1);
    assert.ok(Math.hypot(outShare, inShare) <= Math.max(rmsOf(A.low, at, i + 1), rmsOf(B.low, at, i + 1)) * 1.45, "the bass power of the mix stays in bounds");
  }
  assert.equal(gainsAt(w.low, .3).out, 1); assert.equal(gainsAt(w.low, .3).in, 0);                    // before the swap only the old bass
  assert.ok(gainsAt(w.low, .97).out < 1e-12 && Math.abs(gainsAt(w.low, .97).in - 1) < 1e-12);     // after it only the new bass
});

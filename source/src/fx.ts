/* The plugin rack: six units modelled on real studio hardware, between the record and the volume.
   source → GE-10 (graphic EQ) → PE-1A (Pultec EQP-1A) → LV-2A (Teletronix LA-2A) → TV-1 (Culture Vulture) → SP-12 (E-mu SP-1200)
          → LF-101 (Moogerfooger MF-101) → TE-3 (Echoplex) → music gain

   Every unit is   input ─┬─ dry ────────────────┬─ output
                          └─ wet: processing ─────┘
   so IN/OUT (and mix) is a short crossfade, never a click. Settings persist in localStorage. */

export type Curve = "lin" | "log";
export interface Option { value: number; label: string }
export interface ParamDef {
  id: string; label: string; min: number; max: number; default: number;
  curve?: Curve; bipolar?: boolean; format: (value: number) => string;
  /** discrete positions (selector knob / toggle) */
  options?: Option[];
}
export interface PluginDef { id: string; model: string; name: string; after: string; params: ParamDef[] }

const dial = (v: number) => v.toFixed(1);
const pct = (v: number) => Math.round(v) + "%";
const hz = (v: number) => v >= 1000 ? (v / 1000).toFixed(v >= 10000 || v % 1000 === 0 ? 0 : 1) + " kHz" : Math.round(v) + " Hz";
const pick = (options: Option[]) => (v: number) => options.reduce((a, b) => Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a).label;
const LOW_FREQ: Option[] = [{ value: 20, label: "20" }, { value: 30, label: "30" }, { value: 60, label: "60" }, { value: 100, label: "100" }];
const HIGH_FREQ: Option[] = [3, 4, 5, 8, 10, 12, 16].map((k) => ({ value: k * 1000, label: String(k) }));
const ATTEN_SEL: Option[] = [5, 10, 20].map((k) => ({ value: k * 1000, label: String(k) }));
const LA_MODE: Option[] = [{ value: 0, label: "Compress" }, { value: 1, label: "Limit" }];
const TUBE: Option[] = [{ value: 0, label: "Triode" }, { value: 1, label: "Pentode" }];
const POLES: Option[] = [{ value: 2, label: "2 pole" }, { value: 4, label: "4 pole" }];

const GEQ_BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const GEQ_FREQS = GEQ_BANDS;
const bandLabel = (f: number) => f >= 1000 ? f / 1000 + "k" : String(f);
const signedDb = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " dB";

export const PLUGINS: PluginDef[] = [
  { id: "geq", model: "GE-10", name: "Graphic Equalizer", after: "after the Technics SH-8065 and Klark Teknik DN27", params: [
    ...GEQ_BANDS.map((f) => ({ id: "b" + f, label: bandLabel(f), min: -12, max: 12, default: 0, bipolar: true, format: signedDb })),
    { id: "level", label: "Level", min: -12, max: 12, default: 0, bipolar: true, format: signedDb }
  ] },
  { id: "eq", model: "PE-1A", name: "Program Equalizer", after: "after the Pultec EQP-1A", params: [
    { id: "lowFreq", label: "Low frequency", min: 20, max: 100, default: 60, options: LOW_FREQ, format: (v) => pick(LOW_FREQ)(v) + " cps" },
    { id: "lowBoost", label: "Boost", min: 0, max: 10, default: 0, format: dial },
    { id: "lowAtten", label: "Atten", min: 0, max: 10, default: 0, format: dial },
    { id: "highFreq", label: "High frequency", min: 3000, max: 16000, default: 8000, options: HIGH_FREQ, format: (v) => pick(HIGH_FREQ)(v) + " kcs" },
    { id: "highBoost", label: "Boost", min: 0, max: 10, default: 0, format: dial },
    { id: "bandwidth", label: "Bandwidth", min: 0, max: 10, default: 5, format: (v) => v < 2 ? "Sharp" : v > 8 ? "Broad" : dial(v) },
    { id: "attenSel", label: "Atten sel", min: 5000, max: 20000, default: 10000, options: ATTEN_SEL, format: (v) => pick(ATTEN_SEL)(v) + " kcs" },
    { id: "highAtten", label: "Atten", min: 0, max: 10, default: 0, format: dial }
  ] },
  { id: "comp", model: "LV-2A", name: "Leveling Amplifier", after: "after the Teletronix LA-2A", params: [
    { id: "gain", label: "Gain", min: 0, max: 100, default: 40, format: (v) => (v * .3 - 12 >= 0 ? "+" : "") + (v * .3 - 12).toFixed(1) + " dB" },
    { id: "peak", label: "Peak reduction", min: 0, max: 100, default: 40, format: (v) => Math.round(v) + "" },
    { id: "mode", label: "Mode", min: 0, max: 1, default: 0, options: LA_MODE, format: pick(LA_MODE) }
  ] },
  { id: "tube", model: "TV-1", name: "Valve Clipper", after: "after the Thermionic Culture Vulture", params: [
    { id: "drive", label: "Drive", min: 0, max: 10, default: 4, format: dial },
    { id: "bias", label: "Bias", min: 0, max: 10, default: 3, format: dial },
    { id: "mix", label: "Mix", min: 0, max: 100, default: 100, format: pct },
    { id: "output", label: "Output", min: -12, max: 6, default: 0, format: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + " dB" },
    { id: "type", label: "Valve", min: 0, max: 1, default: 0, options: TUBE, format: pick(TUBE) }
  ] },
  { id: "crush", model: "SP-12", name: "Sampling Crusher", after: "after the E-mu SP-1200", params: [
    { id: "bits", label: "Bits", min: 3, max: 16, default: 12, format: (v) => Math.round(v) + " bit" },
    { id: "rate", label: "Rate", min: 4000, max: 44100, default: 26040, curve: "log", format: (v) => (v / 1000).toFixed(1) + " kHz" },
    { id: "tone", label: "Tone", min: 0, max: 10, default: 6, format: dial },
    { id: "mix", label: "Mix", min: 0, max: 100, default: 100, format: pct }
  ] },
  { id: "filter", model: "LF-101", name: "Lowpass Filter", after: "after the Moogerfooger MF-101", params: [
    { id: "drive", label: "Drive", min: 0, max: 10, default: 2, format: dial },
    { id: "cutoff", label: "Cutoff", min: 0, max: 10, default: 10, format: (v) => hz(filterFrequency(v)) },
    { id: "res", label: "Resonance", min: 0, max: 10, default: 2, format: dial },
    { id: "mix", label: "Mix", min: 0, max: 10, default: 10, format: dial },
    { id: "poles", label: "Slope", min: 2, max: 4, default: 4, options: POLES, format: pick(POLES) }
  ] },
  { id: "echo", model: "TE-3", name: "Tape Echo", after: "after the Echoplex EP-3", params: [
    { id: "delay", label: "Echo delay", min: 60, max: 650, default: 280, format: (v) => Math.round(v) + " ms" },
    { id: "repeats", label: "Repeats", min: 0, max: 10, default: 3, format: dial },
    { id: "volume", label: "Echo volume", min: 0, max: 10, default: 4, format: dial },
    { id: "wear", label: "Wear", min: 0, max: 10, default: 3, format: dial }
  ] }
];

/** LF-101 cutoff dial 0..10 → 40 Hz … 20 kHz (log). */
export function filterFrequency(dialValue: number): number { return 40 * Math.pow(20000 / 40, Math.min(10, Math.max(0, dialValue)) / 10); }
/** Knob position (0..1) ↔ value, honouring log curves and discrete options. */
export function toValue(def: ParamDef, position: number): number {
  const p = Math.min(1, Math.max(0, position));
  if (def.options) return def.options[Math.round(p * (def.options.length - 1))].value;
  return def.curve === "log" ? def.min * Math.pow(def.max / def.min, p) : def.min + (def.max - def.min) * p;
}
export function toPosition(def: ParamDef, value: number): number {
  if (def.options) {
    const index = def.options.findIndex((o) => o.value === value);
    return def.options.length > 1 ? Math.max(0, index) / (def.options.length - 1) : 0;
  }
  return def.curve === "log" ? Math.log(value / def.min) / Math.log(def.max / def.min) : (value - def.min) / (def.max - def.min);
}

export interface UnitState { on: boolean; values: Record<string, number> }
export type RackState = Record<string, UnitState>;
const STORE_KEY = "turntable.rack.v2";
function defaults(): RackState {
  return Object.fromEntries(PLUGINS.map((p) => [p.id, { on: false, values: Object.fromEntries(p.params.map((q) => [q.id, q.default])) }]));
}
function clampToDef(def: ParamDef, value: number): number {
  if (def.options) return def.options.reduce((a, b) => Math.abs(b.value - value) < Math.abs(a.value - value) ? b : a).value;
  return Math.min(def.max, Math.max(def.min, value));
}
function load(): RackState {
  const state = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as RackState;
    for (const plugin of PLUGINS) {
      const unit = saved[plugin.id];
      if (!unit) continue;
      state[plugin.id].on = !!unit.on;
      for (const param of plugin.params) {
        const value = unit.values?.[param.id];
        if (typeof value === "number" && Number.isFinite(value)) state[plugin.id].values[param.id] = clampToDef(param, value);
      }
    }
  } catch { /* no storage: defaults */ }
  return state;
}

interface Unit { input: GainNode; output: GainNode; apply(values: Record<string, number>, on: boolean): void; meter?: () => number }
const SMOOTH = .02;
function shell(ctx: AudioContext) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry).connect(output);
  wet.connect(output);
  dry.gain.value = 1; wet.gain.value = 0;
  /** in: dry/wet levels; out: dry only */
  const mixTo = (on: boolean, wetLevel: number, dryLevel = 1 - wetLevel) => {
    const now = ctx.currentTime;
    dry.gain.setTargetAtTime(on ? dryLevel : 1, now, SMOOTH);
    wet.gain.setTargetAtTime(on ? wetLevel : 0, now, SMOOTH);
  };
  return { input, output, wet, mixTo };
}
const set = (param: AudioParam, value: number, ctx: AudioContext) => param.setTargetAtTime(value, ctx.currentTime, SMOOTH);
const dbToGain = (db: number) => Math.pow(10, db / 20);

/* GE-10: ten octave-band peaking filters (Q ≈ 1.4) and an output level — a classic graphic EQ. */
function geqUnit(ctx: AudioContext): Unit {
  const s = shell(ctx);
  const bands = GEQ_BANDS.map((f, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = i === 0 ? "lowshelf" : i === GEQ_BANDS.length - 1 ? "highshelf" : "peaking";
    filter.frequency.value = i === 0 ? 44 : i === GEQ_BANDS.length - 1 ? 11300 : f;
    filter.Q.value = 1.41;
    return filter;
  });
  const level = ctx.createGain();
  bands.reduce<AudioNode>((tail, filter) => tail.connect(filter), s.input).connect(level).connect(s.wet);
  return { input: s.input, output: s.output, apply(v, on) {
    GEQ_BANDS.forEach((f, i) => set(bands[i].gain, v["b" + f], ctx));
    set(level.gain, dbToGain(v.level), ctx);
    s.mixTo(on, 1);
  } };
}

/* PE-1A: Pultec passive EQ. Boost and attenuation on the low end are separate filters at (nearly) the same
   corner — boosting and cutting together gives the famous tight-low-end "Pultec trick". */
function eqUnit(ctx: AudioContext): Unit {
  const s = shell(ctx);
  const lowBoost = ctx.createBiquadFilter(), lowAtten = ctx.createBiquadFilter(), highBoost = ctx.createBiquadFilter(), highAtten = ctx.createBiquadFilter();
  lowBoost.type = "lowshelf"; lowAtten.type = "lowshelf"; highBoost.type = "peaking"; highAtten.type = "highshelf";
  s.input.connect(lowBoost).connect(lowAtten).connect(highBoost).connect(highAtten).connect(s.wet);
  return { input: s.input, output: s.output, apply(v, on) {
    set(lowBoost.frequency, v.lowFreq * 1.6, ctx); set(lowBoost.gain, v.lowBoost * 1.35, ctx);
    set(lowAtten.frequency, v.lowFreq * 2.4, ctx); set(lowAtten.gain, -v.lowAtten * 1.75, ctx);
    set(highBoost.frequency, v.highFreq, ctx); set(highBoost.gain, v.highBoost * 1.8, ctx); set(highBoost.Q, 2.4 * Math.pow(.14, v.bandwidth / 10), ctx);
    set(highAtten.frequency, v.attenSel, ctx); set(highAtten.gain, -v.highAtten * 1.6, ctx);
    s.mixTo(on, 1);
  } };
}

/* LV-2A: optical leveling amp — slow-ish attack, long release, soft knee. Peak reduction lowers the threshold. */
function compUnit(ctx: AudioContext): Unit {
  const s = shell(ctx);
  const comp = ctx.createDynamicsCompressor(), makeup = ctx.createGain();
  comp.attack.value = .01; comp.release.value = .55; comp.knee.value = 8;
  s.input.connect(comp).connect(makeup).connect(s.wet);
  let on = false;
  return { input: s.input, output: s.output, meter: () => on ? comp.reduction : 0, apply(v, isOn) {
    on = isOn;
    set(comp.threshold, -v.peak * .42, ctx);
    set(comp.ratio, v.mode ? 20 : 4, ctx);
    set(makeup.gain, dbToGain(v.gain * .3 - 12), ctx);
    s.mixTo(isOn, 1);
  } };
}

/* TV-1: valve clipper. Bias shifts the operating point (asymmetry → even harmonics); pentode clips harder
   than triode. The shaper's input domain ±1 stands for ±4 of signal. */
/** small-signal slope of valveCurve per unit of shaper input */
export function valveSlope(bias: number, pentode: boolean): number {
  const b = bias / 10 * .6, hard = pentode ? 2.6 : 1.2;
  const shape = (a: number) => Math.tanh(hard * (a + b)) - Math.tanh(hard * b);
  const norm = Math.max(Math.abs(shape(4)), Math.abs(shape(-4)));
  return 4 * hard * (1 - Math.tanh(hard * b) ** 2) / norm;
}
export function valveCurve(bias: number, pentode: boolean, samples = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples), b = bias / 10 * .6, hard = pentode ? 2.6 : 1.2;
  const shape = (a: number) => Math.tanh(hard * (a + b)) - Math.tanh(hard * b);
  const norm = Math.max(Math.abs(shape(4)), Math.abs(shape(-4)));
  for (let i = 0; i < samples; i++) curve[i] = shape((i / (samples - 1) * 2 - 1) * 4) / norm;
  return curve;
}
function tubeUnit(ctx: AudioContext): Unit {
  const s = shell(ctx);
  const pre = ctx.createGain(), shaper = ctx.createWaveShaper(), dc = ctx.createBiquadFilter(), post = ctx.createGain();
  shaper.oversample = "4x"; dc.type = "highpass"; dc.frequency.value = 18;
  s.input.connect(pre).connect(shaper).connect(dc).connect(post).connect(s.wet);
  let last = "";
  return { input: s.input, output: s.output, apply(v, on) {
    const g = dbToGain(v.drive * 2.4);
    set(pre.gain, g / 4, ctx);
    // undo most of the small-signal gain so IN/OUT is roughly level; clipping still sounds louder/denser
    set(post.gain, dbToGain(v.output) / Math.pow(Math.max(1, valveSlope(v.bias, v.type === 1) * g / 4), .85), ctx);
    const key = v.bias.toFixed(2) + v.type;
    if (key !== last) { shaper.curve = valveCurve(v.bias, v.type === 1); last = key; }
    s.mixTo(on, v.mix / 100);
  } };
}

/* SP-12: sample-and-hold to the chosen rate, quantise to n bits (AudioWorklet), then a tone low-pass. */
function crushUnit(ctx: AudioContext): Unit {
  const s = shell(ctx);
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass"; tone.Q.value = .5;
  tone.connect(s.wet);
  let node: AudioWorkletNode | null = null, last: { v: Record<string, number>; on: boolean } | null = null;
  const apply = (v: Record<string, number>, on: boolean) => {
    last = { v, on };
    if (node) {
      set(node.parameters.get("bits")!, v.bits, ctx);
      set(node.parameters.get("rate")!, ctx.sampleRate / v.rate, ctx);
    }
    set(tone.frequency, 2500 * Math.pow(20000 / 2500, v.tone / 10), ctx);
    s.mixTo(on && !!node, v.mix / 100);
  };
  ctx.audioWorklet.addModule("/worklets/bitcrusher.js").then(() => {
    node = new AudioWorkletNode(ctx, "bitcrusher", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    s.input.connect(node).connect(tone);
    if (last) apply(last.v, last.on);
  }).catch((error) => console.warn("SP-12 unavailable", error));
  return { input: s.input, output: s.output, apply };
}

/* LF-101: drive into a 2- or 4-pole low-pass with resonance. */
function filterUnit(ctx: AudioContext): Unit {
  const s = shell(ctx);
  const drive = ctx.createGain(), shaper = ctx.createWaveShaper(), a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(), trim = ctx.createGain();
  shaper.curve = valveCurve(0, false); shaper.oversample = "2x";
  a.type = "lowpass"; b.type = "lowpass";
  s.input.connect(drive).connect(shaper).connect(a).connect(b).connect(trim).connect(s.wet);
  return { input: s.input, output: s.output, apply(v, on) {
    const f = filterFrequency(v.cutoff), q = .707 + v.res * 1.3, pre = dbToGain(v.drive * 1.8) / 4;
    set(drive.gain, pre, ctx);
    set(trim.gain, 1 / Math.pow(valveSlope(0, false) * pre, .85), ctx);
    set(a.frequency, f, ctx); set(a.Q, v.poles === 4 ? Math.sqrt(q) : q, ctx);
    set(b.frequency, v.poles === 4 ? f : 22000, ctx); set(b.Q, v.poles === 4 ? Math.sqrt(q) : .5, ctx);
    s.mixTo(on, v.mix / 10);
  } };
}

/* TE-3: tape echo — a delay line with feedback through a darkening, wobbling tape path. The dry signal
   always passes; Echo volume adds the repeats. */
function echoUnit(ctx: AudioContext): Unit {
  const s = shell(ctx);
  const delay = ctx.createDelay(1.2), feedback = ctx.createGain(), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), sat = ctx.createWaveShaper();
  lp.type = "lowpass"; hp.type = "highpass"; hp.frequency.value = 120;
  sat.curve = valveCurve(1, false);                       // gentle tape saturation
  const tapeIn = ctx.createGain(); tapeIn.gain.value = 1 / valveSlope(1, false);   // unity at low level
  const wow = ctx.createOscillator(), wowDepth = ctx.createGain(), flutter = ctx.createOscillator(), flutterDepth = ctx.createGain();
  wow.frequency.value = .6; flutter.frequency.value = 6.8;
  wow.connect(wowDepth).connect(delay.delayTime); flutter.connect(flutterDepth).connect(delay.delayTime);
  wow.start(); flutter.start();
  s.input.connect(delay);
  delay.connect(lp).connect(hp).connect(tapeIn).connect(sat);
  sat.connect(feedback).connect(delay);
  sat.connect(s.wet);
  return { input: s.input, output: s.output, apply(v, on) {
    set(delay.delayTime, v.delay / 1000, ctx);
    set(feedback.gain, Math.min(.92, v.repeats * .095), ctx);
    set(lp.frequency, 7000 * Math.pow(1800 / 7000, v.wear / 10), ctx);
    set(wowDepth.gain, .0006 + v.wear * .0006, ctx); set(flutterDepth.gain, v.wear * .00007, ctx);
    s.mixTo(on, v.volume / 10 * .9, 1);
  } };
}

const BUILDERS: Record<string, (ctx: AudioContext) => Unit> = { geq: geqUnit, eq: eqUnit, comp: compUnit, tube: tubeUnit, crush: crushUnit, filter: filterUnit, echo: echoUnit };

export class Rack {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly units: Record<string, Unit> = {};
  private state: RackState = load();
  private readonly listeners = new Set<() => void>();
  private saveTimer = 0;
  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    let tail: AudioNode = this.input;
    for (const plugin of PLUGINS) {
      const unit = BUILDERS[plugin.id](ctx);
      this.units[plugin.id] = unit;
      tail.connect(unit.input);
      tail = unit.output;
      unit.apply(this.state[plugin.id].values, this.state[plugin.id].on);
    }
    tail.connect(this.output);
  }
  get snapshot(): RackState { return this.state; }
  /** a unit's meter reading (LV-2A: gain reduction in dB, ≤ 0) */
  meter(id: string): number { return this.units[id]?.meter?.() ?? 0; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  setValue(id: string, param: string, value: number): void {
    const def = PLUGINS.find((p) => p.id === id)?.params.find((q) => q.id === param);
    if (!def) return;
    this.update(id, { ...this.state[id], values: { ...this.state[id].values, [param]: clampToDef(def, value) } });
  }
  setOn(id: string, on: boolean): void { this.update(id, { ...this.state[id], on }); }
  reset(): void { const fresh = defaults(); for (const plugin of PLUGINS) this.update(plugin.id, fresh[plugin.id]); }
  private update(id: string, unit: UnitState): void {
    this.state = { ...this.state, [id]: unit };
    this.units[id].apply(unit.values, unit.on);
    for (const listener of this.listeners) listener();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch { /* storage off */ } }, 250);
  }
}

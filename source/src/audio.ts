import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { readBlob } from "./library";
import { Rack } from "./fx";
import { useApp } from "./state";
import { useSettings } from "./settings";
import type { Album } from "./types";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
interface PreviewVoice {
  element: HTMLAudioElement;
  gain: GainNode;
  filter: BiquadFilterNode;
  url: string;
  stopped: boolean;
}
/** A decode that came out as pure silence is a failed decode (some m4a do that), not a very quiet song. */
function silent(buffer: AudioBuffer): boolean {
  if (buffer.duration < 1) return false;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 7) if (data[i] > 1e-5 || data[i] < -1e-5) return false;
  }
  return true;
}
function waitForMetadata(element: HTMLAudioElement): Promise<void> {
  if (element.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      element.removeEventListener("loadedmetadata", loaded);
      element.removeEventListener("error", failed);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error("Could not load audio file"));
    const timer = window.setTimeout(() => finish(new Error("Audio loading timed out")), 10000);
    element.addEventListener("loadedmetadata", loaded);
    element.addEventListener("error", failed);
  });
}
function demoWav(frequency: number): Blob {
  const sampleRate = 22050, frames = sampleRate * 30;
  const buffer = new ArrayBuffer(44 + frames * 2), view = new DataView(buffer);
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  word(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); word(8, "WAVE"); word(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, "data"); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const envelope = Math.min(1, i / 1000, (frames - i) / 3000);
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * frequency * i / sampleRate) * 6000 * envelope), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
class AudioEngine {
  readonly context = new AudioContext();
  private readonly musicGain = this.context.createGain();
  /** the plugin rack sits between the record and the volume */
  readonly rack = new Rack(this.context);
  private readonly surfaceGain = this.context.createGain();
  private readonly musicAnalyser = this.context.createAnalyser();
  private readonly previewAnalyser = this.context.createAnalyser();
  private readonly previewBus = this.context.createGain();
  private readonly musicSamples = new Float32Array(2048);
  private readonly previewSamples = new Float32Array(2048);
  private readonly previewVoices: PreviewVoice[] = [];
  private readonly previewHistory = new Map<string, number>();
  private readonly noise: AudioBufferSourceNode;
  private buffer: AudioBuffer | null = null;
  private bufferPath = "";
  private preloaded: { path: string; buffer: AudioBuffer } | null = null;
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;
  private previewGeneration = 0;
  private position = 0;
  private lastClock = 0;
  private ramp: { kind: "start" | "stop"; start: number; duration: number; from: number; to: number } | null = null;
  private stopTimer = 0;
  private cueTimer = 0;
  private wobble = 0;
  private musicActive = false;
  private wasPaused = false;
  private wasHandOn = false;
  private handReversed = false;
  /** how loud the needle noise wants to be (before the volume and the setting scale it) */
  private surfaceLevel = 0;
  private surfaceSetAt = 0;
  private lastTickAt = 0;
  private unlocked = false;
  private idleSince = 0;
  speed = 0;
  targetSpeed = 0;
  handOn = false;
  handRate: number | null = null;
  onEnded: (() => void) | null = null;
  constructor() {
    this.musicAnalyser.fftSize = 2048;
    this.previewAnalyser.fftSize = 2048;
    this.rack.output.connect(this.musicGain);
    this.musicGain.connect(this.musicAnalyser).connect(this.context.destination);
    this.previewBus.connect(this.previewAnalyser).connect(this.context.destination);
    const length = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 9176;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff * 2 - 1) * .65;
    }
    this.noise = this.context.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    const high = this.context.createBiquadFilter();
    high.type = "highpass"; high.frequency.value = 650;
    const low = this.context.createBiquadFilter();
    low.type = "lowpass"; low.frequency.value = 5200;
    this.noise.connect(high).connect(low).connect(this.surfaceGain).connect(this.context.destination);
    this.surfaceGain.gain.value = 0;
    this.noise.start();
    this.musicGain.gain.value = useApp.getState().volume;
    // the switch in the settings takes effect at once
    // a timer, not the frame loop: a minimised or tray-hidden window gets no animation frames, and that is exactly
    // when the output has to be let go
    window.setInterval(() => this.idleCheck(), 1000);
    // the frame loop calls tick() — but a minimised or tray-hidden window gets no frames, and then the position,
    // the end-of-track logic and the listening stats would stand still while the music plays: a timer covers for it
    window.setInterval(() => { if (performance.now() - this.lastTickAt > 700) this.tick(.5); }, 500);
    let hiss = useSettings.getState().surfaceNoise;
    useSettings.subscribe((state) => { if (state.surfaceNoise !== hiss) { hiss = state.surfaceNoise; this.applySurface(); } });
  }
  async unlock(): Promise<void> {
    if (this.context.state !== "running") await this.context.resume();
    this.unlocked = this.context.state === "running";
    this.idleSince = 0;
    this.lastClock = this.context.currentTime;
  }
  /** A running AudioContext keeps the sound card's output stream open even when nothing plays, and some cards hiss
      on an open stream. So after a few quiet seconds the context is suspended; play, preview and the cue sounds
      wake it again. */
  private idleCheck(): void {
    // safety net: needle noise with no record turning under it (a seek that cancelled the pause's own timer, a track
    // that never loaded…) must not stay on
    if (!this.source && !this.musicActive && this.surfaceLevel > 0 && performance.now() - this.surfaceSetAt > 4000) this.surface(0);
    const quiet = !this.musicActive && !this.source && !this.previewVoices.length && !this.handOn && this.surfaceLevel === 0;
    if (!quiet) { this.idleSince = 0; return; }
    const now = performance.now();
    if (!this.idleSince) this.idleSince = now;
    else if (now - this.idleSince > 3000 && this.unlocked && this.context.state === "running") void this.context.suspend().catch(() => {});
  }
  private readonly spectrumBins = new Uint8Array(1024);
  /** Music level per band (0..1), for the rack displays: the average of the FFT bins within ±half an octave. */
  bands(frequencies: number[], out: Float32Array): void {
    this.musicAnalyser.getByteFrequencyData(this.spectrumBins);
    const binHz = this.context.sampleRate / this.musicAnalyser.fftSize;
    frequencies.forEach((f, i) => {
      const lo = Math.max(1, Math.floor(f / Math.SQRT2 / binHz)), hi = Math.max(lo + 1, Math.ceil(f * Math.SQRT2 / binHz));
      let sum = 0;
      for (let b = lo; b < hi && b < this.spectrumBins.length; b++) sum += this.spectrumBins[b];
      out[i] = sum / (hi - lo) / 255;
    });
  }
  readout(): { state: AudioContextState; musicRms: number; previewRms: number } {
    const rms = (analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>) => {
      analyser.getFloatTimeDomainData(samples);
      let power = 0;
      for (const sample of samples) power += sample * sample;
      return Math.sqrt(power / samples.length);
    };
    return {
      state: this.context.state,
      musicRms: rms(this.musicAnalyser, this.musicSamples),
      previewRms: rms(this.previewAnalyser, this.previewSamples)
    };
  }
  setVolume(value: number): void {
    const volume = clamp(value);
    this.musicGain.gain.setTargetAtTime(volume, this.context.currentTime, .025);
    useApp.setState({ volume });
    this.applySurface();
  }
  /** The needle's surface noise. It sits on the same fader as the music: turned down, a quiet record gets no
      hiss of its own on top (it used to ignore the volume, so a quiet track was mostly noise). */
  surface(level: number, seconds = .15): void {
    this.surfaceLevel = Math.min(.021, Math.max(0, level));
    this.surfaceSetAt = performance.now();
    this.applySurface(seconds);
  }
  private applySurface(seconds = .15): void {
    const now = this.context.currentTime;
    const follow = clamp(useApp.getState().volume / .78) ** 1.5;
    const level = useSettings.getState().surfaceNoise ? this.surfaceLevel * follow : 0;
    // while a record plays the hiss is half as loud, and a lot quieter than it was
    const target = this.musicActive ? level * .35 : level;
    this.surfaceGain.gain.cancelScheduledValues(now);
    this.surfaceGain.gain.setTargetAtTime(target, now, Math.max(.01, seconds / 3));
  }
  private async decode(path: string): Promise<AudioBuffer> {
    if (path.startsWith("demo-tone:") && import.meta.env.DEV) {
      const frequency = Number(path.slice(10)) || 220;
      const sampleRate = this.context.sampleRate;
      const buffer = this.context.createBuffer(1, sampleRate * 16, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const attack = Math.min(1, i / (sampleRate * .04));
        const release = Math.min(1, (data.length - i) / (sampleRate * .5));
        data[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * .12 * attack * release;
      }
      return buffer;
    }
    await invoke("allow_import_path", { path });
    // the webview's decoder first; Turntable's own when it fails, hands back silence, or the settings say so
    if (!useSettings.getState().nativeDecoder) {
      try {
        const bytes = await readFile(path);
        const decoded = await this.context.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
        if (!silent(decoded)) return decoded;
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Webview could not decode", path, error);
      }
    }
    return this.decodeNative(path);
  }
  /** Rust decodes the file (Symphonia) and sends the samples: 12 bytes of header, then 16-bit interleaved. */
  private async decodeNative(path: string): Promise<AudioBuffer> {
    let raw: ArrayBuffer;
    try { raw = await invoke<ArrayBuffer>("decode_audio", { path }); }
    catch (error) { throw new Error("Could not play " + (path.split(/[\\/]/).pop() || path) + ": " + String(error)); }
    const header = new DataView(raw);
    const rate = header.getUint32(0, true), channels = header.getUint32(4, true), frames = header.getUint32(8, true);
    const samples = new Int16Array(raw, 12, frames * channels);
    const buffer = this.context.createBuffer(channels, frames, rate);
    for (let channel = 0; channel < channels; channel++) {
      const out = buffer.getChannelData(channel);
      for (let i = 0, at = channel; i < frames; i++, at += channels) out[i] = samples[at] / 32768;
    }
    return buffer;
  }
  async preload(path: string): Promise<void> {
    if (!path || path === this.bufferPath || path === this.preloaded?.path) return;
    try { this.preloaded = { path, buffer: await this.decode(path) }; }
    catch { this.preloaded = null; }
  }
  private stopSource(): void {
    clearTimeout(this.stopTimer);
    if (!this.source) return;
    this.source.onended = null;
    try { this.source.stop(); } catch { /* already ended */ }
    this.source.disconnect();
    this.source = null;
  }
  async load(path: string, position = 0): Promise<void> {
    const request = ++this.generation;
    this.stopSource();
    this.musicActive = false;
    this.wasPaused = false;      // a freshly loaded track starts clean — not as a "resume" of the paused one
    this.ramp = null;
    let decoded: AudioBuffer;
    if (this.preloaded?.path === path) {
      decoded = this.preloaded.buffer;
      this.preloaded = null;
    } else if (this.bufferPath === path && this.buffer) decoded = this.buffer;
    else decoded = await this.decode(path);
    if (request !== this.generation) return;
    this.buffer = decoded;
    this.bufferPath = path;
    this.position = clamp(position, 0, Math.max(0, decoded.duration - .01));
    useApp.setState({ position: this.position, duration: decoded.duration });
  }
  private startSource(rate: number): void {
    clearTimeout(this.cueTimer);
    if (!this.buffer) throw new Error("No decoded track loaded");
    this.stopSource();
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.setValueAtTime(rate, this.context.currentTime);
    source.connect(this.rack.input);
    source.onended = () => {
      if (this.source !== source || !this.musicActive) return;
      this.source = null;
      this.musicActive = false;
      this.onEnded?.();
    };
    this.source = source;
    source.start(0, this.position);
    this.lastClock = this.context.currentTime;
  }
  fadeMusic(target: number, seconds: number): void {
    const now = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(clamp(target), now + seconds);
  }
  /** fadeIn: seconds to ramp the music up from silence (default: a short 120 ms ramp from the current gain). */
  async play(fullSpeed = false, fadeIn?: number): Promise<void> {
    await this.unlock();
    if (!this.buffer) throw new Error("No decoded track loaded");
    const now = this.context.currentTime;
    const resume = this.wasPaused;
    if (!this.source || !resume) this.startSource(resume ? .001 : fullSpeed ? 1 : .55);
    this.wasPaused = false;
    const current = this.source!;
    clearTimeout(this.stopTimer);
    current.playbackRate.cancelScheduledValues(now);
    const from = resume ? Math.max(.001, this.speed) : fullSpeed ? 1 : .55;
    const duration = resume ? .35 : fullSpeed ? 0 : .28;
    current.playbackRate.setValueAtTime(from, now);
    if (duration) current.playbackRate.linearRampToValueAtTime(1, now + duration);
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(fadeIn ? 0 : this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(useApp.getState().volume, now + (fadeIn || .12));
    this.ramp = duration ? { kind: "start", start: now, duration, from, to: 1 } : null;
    this.speed = from;
    this.targetSpeed = 1;
    this.musicActive = true;
    this.surface(.006);
  }
  liftCue(): void {
    if (!this.source || !this.musicActive) return;
    this.fadeMusic(0, .12);
    this.musicActive = false;
    this.wasPaused = true;
    this.ramp = null;
    this.speed = 1;
    this.targetSpeed = 1;
    this.cueTimer = window.setTimeout(() => this.stopSource(), 130);
    this.surface(0);                // the needle is up: no surface noise either
    this.sound("cue");
  }
  async lowerCue(): Promise<void> {
    await this.unlock();
    if (!this.buffer) throw new Error("No decoded track loaded");
    clearTimeout(this.cueTimer);
    this.startSource(1);
    this.musicActive = true;
    this.wasPaused = false;
    this.speed = 1;
    this.targetSpeed = 1;
    this.fadeMusic(useApp.getState().volume, .16);
    this.surface(.006);
    this.sound("cue");
  }
  pause(): void {
    if (!this.source || !this.musicActive) return;
    const now = this.context.currentTime;
    this.source.playbackRate.cancelScheduledValues(now);
    this.source.playbackRate.setValueAtTime(Math.max(.001, this.speed), now);
    this.source.playbackRate.setTargetAtTime(.001, now, .18);
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(useApp.getState().volume, now);
    this.musicGain.gain.setValueAtTime(useApp.getState().volume, now + .55);
    this.musicGain.gain.linearRampToValueAtTime(0, now + .7);
    this.ramp = { kind: "stop", start: now, duration: .7, from: this.speed, to: 0 };
    this.targetSpeed = 0;
    this.wasPaused = true;
    this.stopTimer = window.setTimeout(() => {
      this.stopSource();
      this.musicActive = false;
      this.speed = 0;
      this.surface(0);
    }, 710);
  }
  stopMusic(): void {
    clearTimeout(this.cueTimer);
    ++this.generation;
    this.stopSource();
    this.buffer = null;
    this.bufferPath = "";
    this.preloaded = null;
    this.ramp = null;
    this.musicActive = false;
    this.wasPaused = false;
    this.speed = 0;
    this.targetSpeed = 0;
    this.surface(0);
  }
  /** Hold a loaded track paused without ever starting it (pause pressed while the arm was travelling). */
  holdPaused(): void {
    this.stopSource();
    this.musicActive = false;
    this.wasPaused = true;
    this.ramp = null;
    this.speed = 0;
    this.targetSpeed = 0;
    this.surface(0);
  }
  seek(seconds: number): void {
    if (!this.buffer) return;
    this.position = clamp(seconds, 0, Math.max(0, this.buffer.duration - .01));
    if (this.wasPaused) {
      // paused (or still spinning down): stay paused — the next play() resumes from the new position
      this.stopSource();              // (this also cancels pause()'s own timer, so the needle noise is cut here)
      this.musicActive = false;
      this.speed = 0;
      this.surface(0);
      useApp.setState({ position: this.position });
      return;
    }
    const shouldPlay = this.musicActive;
    if (shouldPlay) {
      this.startSource(Math.max(.001, this.speed));
      this.source!.playbackRate.setTargetAtTime(this.targetSpeed || 1, this.context.currentTime, .03);
    }
    useApp.setState({ position: this.position });
  }
  tick(delta: number): void {
    this.lastTickAt = performance.now();
    const now = this.context.currentTime;
    const clockDelta = this.lastClock ? Math.max(0, now - this.lastClock) : delta;
    this.lastClock = now;
    if (this.handOn) {
      this.wasHandOn = true;
      const target = clamp(this.handRate ?? 0, -2, 2);
      if (target < 0) this.handReversed = true;
      this.speed += (target - this.speed) * (1 - Math.exp(-clockDelta / .03));
      if (this.source) {
        this.source.playbackRate.setTargetAtTime(Math.max(.001, target), now, .03);
        this.musicGain.gain.setTargetAtTime(target < 0 ? 0 : useApp.getState().volume, now, .02);
      }
    } else if (this.wasHandOn) {
      this.wasHandOn = false;
      if (this.source) {
        if (this.handReversed) this.startSource(Math.max(.001, Math.abs(this.speed)));
        this.source!.playbackRate.setTargetAtTime(1, now, .13);
        this.musicGain.gain.setTargetAtTime(useApp.getState().volume, now, .06);
      }
      this.handReversed = false;
      this.ramp = { kind: "start", start: now, duration: .4, from: Math.max(0, this.speed), to: 1 };
      this.targetSpeed = 1;
    } else if (this.ramp) {
      const t = Math.min(1, Math.max(0, (now - this.ramp.start) / this.ramp.duration));
      this.speed = this.ramp.kind === "stop" ? this.ramp.from * Math.exp(-t * this.ramp.duration / .18) : this.ramp.from + (this.ramp.to - this.ramp.from) * t;
      if (t >= 1) { this.speed = this.ramp.to; this.ramp = null; }
    } else if (!this.source) {
      const alpha = 1 - Math.exp(-clockDelta / .22);
      this.speed += (this.targetSpeed - this.speed) * alpha;
      if (this.targetSpeed === 0 && this.speed < .003) this.speed = 0;
    }
    if (this.musicActive && this.buffer) {
      this.position = clamp(this.position + this.speed * clockDelta, 0, this.buffer.duration);
      useApp.setState({ position: this.position });
    }
    this.wobble += delta;
    for (const voice of this.previewVoices) voice.filter.frequency.setTargetAtTime(
      520 + Math.sin(this.wobble * Math.PI * .36) * 70, now, .08);
  }
  sound(kind: "motor" | "cue" | "needle" | "felt" | "flap" | "drop"): void {
    if (this.context.state !== "running") {
      // asleep (see idleCheck): wake it, then make the sound — but never before the first click has unlocked audio
      if (this.unlocked) void this.context.resume().then(() => { if (this.context.state === "running") this.sound(kind); }, () => {});
      return;
    }
    const now = this.context.currentTime;
    if (kind === "drop") {
      // the record landing on the platter: a short, deep thump
      const body = this.context.createOscillator(), gain = this.context.createGain();
      body.type = "sine";
      body.frequency.setValueAtTime(92, now);
      body.frequency.exponentialRampToValueAtTime(38, now + .22);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.16 * Math.max(.25, useApp.getState().volume), now + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .42);
      body.connect(gain).connect(this.context.destination);
      body.start(now); body.stop(now + .45);
      return;
    }
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = kind === "flap" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(kind === "motor" ? 55 : kind === "flap" ? 140 : 175, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === "motor" ? 195 : 80, now + (kind === "motor" ? .5 : .05));
    gain.gain.setValueAtTime(kind === "motor" ? .022 : kind === "flap" ? .009 : .035, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === "motor" ? .55 : .12));
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + (kind === "motor" ? .55 : .12));
  }
  private impulse(): AudioBuffer {
    const size = Math.floor(this.context.sampleRate * .6);
    const buffer = this.context.createBuffer(2, size, this.context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (size * .16));
    }
    return buffer;
  }
  private disposePreview(voice: PreviewVoice): void {
    voice.element.pause();
    voice.element.removeAttribute("src");
    voice.element.load();
    voice.gain.disconnect();
    URL.revokeObjectURL(voice.url);
    const index = this.previewVoices.indexOf(voice);
    if (index >= 0) this.previewVoices.splice(index, 1);
  }
  async preview(album: Album): Promise<void> {
    if (!album.tracks.length || !useApp.getState().previewsEnabled) return;
    this.stopPreview(false);
    const request = this.previewGeneration;
    await this.unlock();
    if (request !== this.previewGeneration) return;
    const previous = this.previewHistory.get(album.id);
    const options = album.tracks.map((_, i) => i).filter((i) => i !== previous);
    const choice = options[Math.floor(Math.random() * options.length)] ?? 0;
    this.previewHistory.set(album.id, choice);
    const track = album.tracks[choice];
    let blob: Blob;
    try {
      blob = track.filePath.startsWith("demo-tone:") && import.meta.env.DEV ? demoWav(Number(track.filePath.slice(10)) || 220)
        : await readBlob(track.filePath);
    }
    catch (error) {
      if (import.meta.env.DEV) console.warn("Preview loading failed", error);
      return;
    }
    if (request !== this.previewGeneration) return;
    const url = URL.createObjectURL(blob);
    const element = new Audio(url);
    element.preload = "metadata";
    const source = this.context.createMediaElementSource(element);
    const first = this.context.createBiquadFilter();
    first.type = "lowpass"; first.frequency.value = 520; first.Q.value = .9;
    const second = this.context.createBiquadFilter();
    second.type = "lowpass"; second.frequency.value = 900; second.Q.value = .5;
    const shelf = this.context.createBiquadFilter();
    shelf.type = "lowshelf"; shelf.frequency.value = 180; shelf.gain.value = 3;
    const peak = this.context.createBiquadFilter();
    peak.type = "peaking"; peak.frequency.value = 280; peak.Q.value = 1.2; peak.gain.value = 2;
    const dry = this.context.createGain(); dry.gain.value = .65;
    const wet = this.context.createGain(); wet.gain.value = .35;
    const convolver = this.context.createConvolver(); convolver.buffer = this.impulse();
    const gain = this.context.createGain(); gain.gain.value = 0;
    source.connect(first).connect(second).connect(shelf).connect(peak);
    peak.connect(dry).connect(gain);
    peak.connect(convolver).connect(wet).connect(gain);
    gain.connect(this.previewBus);
    const voice: PreviewVoice = { element, gain, filter: first, url, stopped: false };
    this.previewVoices.push(voice);
    while (this.previewVoices.length > 2) this.disposePreview(this.previewVoices[0]);
    try { await waitForMetadata(element); }
    catch { this.disposePreview(voice); return; }
    if (request !== this.previewGeneration || voice.stopped) { this.disposePreview(voice); return; }
    const duration = Number.isFinite(element.duration) ? element.duration : track.duration;
    element.currentTime = duration * (.25 + Math.random() * .35);
    try { await element.play(); }
    catch { this.disposePreview(voice); return; }
    gain.gain.linearRampToValueAtTime(.10 * useApp.getState().volume, this.context.currentTime + 1.4);
    useApp.setState({ previewTrack: { albumId: album.id, title: track.title } });
  }
  stopPreview(select: boolean): void {
    ++this.previewGeneration;
    useApp.setState({ previewTrack: null });
    for (const voice of this.previewVoices) {
      if (voice.stopped) continue;
      voice.stopped = true;
      const now = this.context.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + (select ? .9 : .42));
      if (select) voice.filter.frequency.linearRampToValueAtTime(2800, now + .9);
      window.setTimeout(() => this.disposePreview(voice), select ? 920 : 440);
    }
  }
}
export const audio = new AudioEngine();


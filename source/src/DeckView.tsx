import { t } from "./lang";
import { useEffect, useRef, useState } from "react";
import { audio } from "./audio";
import { deckMotion } from "./deckMotion";
import { repaintOnResize } from "./labelArt";

/** The label art is printed edge to edge on the 100 mm label. */
const LABEL_ART_MM = 100;
import { pauseOrResume, seekAlbumProgress, toggleCue } from "./player";
import { useApp } from "./state";
import { useSettings, vinylOf } from "./settings";
import type { Album } from "./types";

declare global {
  interface Window {
    buildDeck: (host: HTMLElement, options: {
      widthPx: number; cover: string; finish?: string; vinyl?: { base: string; edge: string; light?: boolean }; trackFractions: number[]; layout?: DeckForm;
      playing: boolean; stylusRadiusMm: number | null;
    }) => { setArm: (radius: number | null) => void };
  }
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clock = (seconds: number) => Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
/** While the arm is dragged: which track and moment the needle would land on. */
function ArmSeekLabel({ album, progress, x, y }: { album: Album; progress: number; x: number; y: number }) {
  const durations = album.tracks.map((track) => Math.max(track.duration, 1));
  let remaining = clamp(progress, 0, 1) * durations.reduce((sum, value) => sum + value, 0), index = 0;
  while (index < durations.length - 1 && remaining >= durations[index]) remaining -= durations[index++];
  const track = album.tracks[index];
  if (!track) return null;
  return <div className="arm-seek" style={{ left: x, top: y }}>
    <span className="mono">{String(index + 1).padStart(2, "0")}</span><span>{track.title}</span><span className="mono">{clock(remaining)}</span>
  </div>;
}
/** Plinth geometry in mm, mirroring LAYOUT in public/design/deck.js. */
export type DeckForm = "landscape" | "wide" | "portrait";
export const DECK_GEOMETRY = {
  landscape: { w: 590, h: 372, sx: 196, sy: 186, px: 478, py: 82 },
  wide: { w: 684, h: 372, sx: 342, sy: 186, px: 624, py: 82 },
  portrait: { w: 372, h: 590, sx: 186, sy: 196, px: 290, py: 478 }
} as const;
function stylusAt(radius: number, g: (typeof DECK_GEOMETRY)[DeckForm]) {
  const { px, py, sx, sy } = g, length = 238;
  const dx = sx - px, dy = sy - py, distance = Math.hypot(dx, dy);
  const a = (length * length - radius * radius + distance * distance) / (2 * distance);
  const h = Math.sqrt(Math.max(0, length * length - a * a));
  const mx = px + a * dx / distance, my = py + a * dy / distance;
  return { x: mx + h * dy / distance, y: my - h * dx / distance };
}
/** `width`: plinth width in artboard px. */
export function DeckView({ album, cover, visualDemo = false, form = "landscape", width = 680, rotate = 0 }: { album: Album; cover: string; visualDemo?: boolean; form?: DeckForm; width?: number; rotate?: number }) {
  const g = DECK_GEOMETRY[form];
  const host = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const deck = useRef<{ setArm: (radius: number | null) => void } | null>(null);
  const platterGesture = useRef<{ angle: number; time: number; x: number; y: number; grabbed: boolean } | null>(null);
  const release = () => {
    const grabbed = platterGesture.current?.grabbed;
    platterGesture.current = null;
    if (grabbed) { audio.handOn = false; audio.handRate = null; }
  };
  const [dragRadius, setDragRadius] = useState<number | null>(null);
  const trackIndex = useApp((state) => state.trackIndex);
  const position = useApp((state) => state.position);
  const phase = useApp((state) => state.phase);
  const volume = useApp((state) => state.volume);
  const cueLifted = useApp((state) => state.cueLifted);
  const finish = useSettings((state) => state.finish);
  const vinyl = useSettings((state) => state.vinyl);
  const playing = phase === "PLAYING";
  const total = album.tracks.reduce((sum, track) => sum + Math.max(track.duration, 1), 0);
  const before = album.tracks.slice(0, trackIndex).reduce((sum, track) => sum + Math.max(track.duration, 1), 0);
  const radius = 146 - Math.min(1, (before + position) / total) * 84;
  const armPosition = stylusAt(dragRadius ?? radius, g);
  const deckScale = width / g.w;
  // the deck may be turned a little around its spindle; the record's on-screen angle includes that turn
  useEffect(() => { deckMotion.offset = rotate * Math.PI / 180; return () => { deckMotion.offset = 0; }; }, [rotate]);
  useEffect(() => {
    if (!host.current || !window.buildDeck) return;
    let sum = 0;
    const fractions = album.tracks.slice(0, -1).map((track) => {
      sum += Math.max(track.duration, 1);
      return sum / total;
    });
    deck.current = window.buildDeck(host.current, {
      finish, vinyl: vinylOf(vinyl), widthPx: width, cover, trackFractions: fractions, layout: form,
      playing: false, stylusRadiusMm: radius
    });
    // crisp label: pre-scaled canvas instead of the 1000 px cover shrunk by the GPU while it spins
    const image = host.current.querySelector<HTMLImageElement>(".label img");
    let stopLabel = () => {};
    if (image) {
      const canvas = document.createElement("canvas");
      canvas.className = "label-art";
      image.replaceWith(canvas);
      stopLabel = repaintOnResize(canvas, cover, LABEL_ART_MM * deckScale);
    }
    // level scale around the volume knob (the knob itself no longer rotates — only its index mark)
    const knob = host.current.querySelector<HTMLElement>("[data-act=volume]");
    if (knob) {
      const pad = 4 * deckScale, size = parseFloat(knob.style.width);
      const ring = document.createElement("div");
      ring.className = "vol-ring";
      Object.assign(ring.style, { left: parseFloat(knob.style.left) - pad + "px", top: parseFloat(knob.style.top) - pad + "px", width: size + pad * 2 + "px", height: size + pad * 2 + "px" });
      ring.style.setProperty("--vol", String(useApp.getState().volume));
      knob.before(ring);
      knob.style.setProperty("--volume-angle", `${(useApp.getState().volume - .5) * 260}deg`);
    }
    // the engraving by the knobs reads the level the knob is set to (there is no speed switch to label)
    const engrave = host.current.querySelector<HTMLElement>(".engrave");
    if (engrave) engrave.textContent = Math.round(useApp.getState().volume * 100) + "%";
    return () => { stopLabel(); if (host.current) host.current.innerHTML = ""; };
  }, [album.id, cover, width, form, finish, vinyl]);
  useEffect(() => {
    // the arm leaves the record as soon as the album is being stopped (CUEING_OUT), not after the spin-down
    deck.current?.setArm(dragRadius ?? (phase === "STOPPED" || phase === "CUEING_OUT" ? null : radius));
    host.current?.classList.toggle("needle-down", dragRadius === null && !cueLifted && phase !== "STOPPED");
    host.current?.querySelector(".led")?.classList.toggle("on", playing || visualDemo);
  }, [radius, dragRadius, phase, playing, visualDemo, cueLifted, finish, vinyl]);
  // the hover tips of the deck's own controls (the deck markup carries English ones; a new deck brings them back)
  useEffect(() => {
    const tip = (act: string, text: string) => host.current?.querySelector<HTMLElement>(`[data-act=${act}]`)?.setAttribute("data-tip", text);
    tip("play", playing ? t("Pause") : t("Play"));
    tip("cue", cueLifted ? t("Lower arm") : t("Lift arm"));
    tip("volume", `${t("Volume")} ${Math.round(volume * 100)}%`);
  }, [album.id, cover, width, form, finish, vinyl, playing, cueLifted, volume]);
  useEffect(() => {
    host.current?.querySelector<HTMLElement>("[data-act=volume]")?.style.setProperty("--volume-angle", `${(volume - .5) * 260}deg`);
    host.current?.querySelector<HTMLElement>(".vol-ring")?.style.setProperty("--vol", String(volume));
    const engrave = host.current?.querySelector<HTMLElement>(".engrave");
    if (engrave) engrave.textContent = Math.round(volume * 100) + "%";
  }, [volume]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const click = (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLElement>("[data-act]");
      if (!target || target.dataset.act === "volume") return;
      if (target.dataset.act === "play") { audio.sound("cue"); pauseOrResume(); }
      if (target.dataset.act === "cue") toggleCue();
    };
    let startY = 0, startVolume = 0, dragging = false;
    const move = (event: PointerEvent) => { if (dragging) audio.setVolume(clamp(startVolume + (startY - event.clientY) / 130, 0, 1)); };
    const up = () => { dragging = false; removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    const down = (event: PointerEvent) => {
      const target = (event.target as Element).closest<HTMLElement>("[data-act=volume]");
      if (!target) return;
      event.preventDefault(); startY = event.clientY; startVolume = useApp.getState().volume; dragging = true;
      audio.sound("cue"); addEventListener("pointermove", move); addEventListener("pointerup", up, { once: true });
    };
    const wheel = (event: WheelEvent) => {
      if (!(event.target as Element).closest("[data-act=volume]")) return;
      event.preventDefault();
      audio.setVolume(clamp(useApp.getState().volume - Math.sign(event.deltaY) * .05, 0, 1));
    };
    element.addEventListener("click", click); element.addEventListener("pointerdown", down);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { up(); element.removeEventListener("click", click); element.removeEventListener("pointerdown", down); element.removeEventListener("wheel", wheel); };
  }, []);
  useEffect(() => {
    let request = 0, last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(.05, (now - last) / 1000); last = now;
      const speed = visualDemo ? 1 : (deckMotion.drive ?? audio.speed) * deckMotion.boost + deckMotion.idle;
      deckMotion.angle += delta * speed * Math.PI * 2 / 1.8;
      const degrees = deckMotion.angle * 180 / Math.PI;
      const platter = host.current?.querySelector<HTMLElement>(".platter");
      const spin = host.current?.querySelector<HTMLElement>(".spin");
      if (platter) platter.style.transform = "rotate(" + degrees + "deg)";
      if (spin) spin.style.transform = "rotate(" + degrees + "deg)";
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [visualDemo]);
  /** pointer → millimetres from the spindle, in the deck's own (unrotated) frame */
  const fromSpindle = (event: React.PointerEvent) => {
    const spindle = host.current!.querySelector(".record-shadow")!.getBoundingClientRect();   // centred on the spindle, which the rotation keeps fixed
    const fit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fit")) || 1;
    const perMm = deckScale * fit, t = -rotate * Math.PI / 180;
    const dx = (event.clientX - (spindle.left + spindle.width / 2)) / perMm, dy = (event.clientY - (spindle.top + spindle.height / 2)) / perMm;
    return { x: dx * Math.cos(t) - dy * Math.sin(t), y: dx * Math.sin(t) + dy * Math.cos(t) };
  };
  const radiusFromPointer = (event: React.PointerEvent) => { const p = fromSpindle(event); return clamp(Math.hypot(p.x, p.y), 62, 146); };
  const platterAngle = (event: React.PointerEvent) => { const p = fromSpindle(event); return Math.atan2(p.y, p.x); };
  return <div className="deck-container" ref={wrapper} style={{ width, height: width * g.h / g.w, ...(rotate ? {
    transform: `rotate(${rotate}deg)`, transformOrigin: `${(g.sx * deckScale).toFixed(1)}px ${(g.sy * deckScale).toFixed(1)}px`,
    "--deck-rot": rotate + "deg" } as React.CSSProperties : {}) }}>
    <div ref={host} id="deck" aria-label={t("Turntable")} />
    <button className="platter-hit" style={{ left: (g.sx - 151) * deckScale, top: (g.sy - 151) * deckScale, width: 302 * deckScale, height: 302 * deckScale }} aria-label={t("Touch platter")} onPointerDown={(event) => {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      // the hand only grabs the record once it actually moves: a plain click must not stutter the music
      platterGesture.current = { angle: platterAngle(event), time: performance.now(), x: event.clientX, y: event.clientY, grabbed: false };
    }} onPointerMove={(event) => {
      const previous = platterGesture.current;
      if (!previous) return;
      if (!previous.grabbed) {
        if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 6) return;
        previous.grabbed = true; previous.angle = platterAngle(event); previous.time = performance.now();
        audio.handOn = true; audio.handRate = 0;
        return;
      }
      const now = performance.now(), next = platterAngle(event);
      let difference = next - previous.angle;
      if (difference > Math.PI) difference -= Math.PI * 2;
      if (difference < -Math.PI) difference += Math.PI * 2;
      const seconds = Math.max(.008, (now - previous.time) / 1000);
      audio.handRate = clamp(difference / seconds / (Math.PI * 2 / 1.8), -2, 2);
      platterGesture.current = { ...previous, angle: next, time: now };
    }} onPointerUp={release} onPointerCancel={release} />
    <button className="arm-hit" aria-label={t("Drag tonearm to seek")} style={{ left: armPosition.x * deckScale - 22, top: armPosition.y * deckScale - 22 }}
      onPointerDown={(event) => {
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        host.current?.classList.add("arm-dragging");
        audio.fadeMusic(0, .12);
        audio.sound("cue");
        setDragRadius(radiusFromPointer(event));
      }}
      onPointerMove={(event) => { if (dragRadius !== null) setDragRadius(radiusFromPointer(event)); }}
      onPointerUp={(event) => {
        if (dragRadius === null) return;
        const progress = (146 - radiusFromPointer(event)) / 84;
        host.current?.classList.remove("arm-dragging");
        setDragRadius(null);
        void seekAlbumProgress(progress);
      }}
      onPointerCancel={() => { host.current?.classList.remove("arm-dragging"); setDragRadius(null); audio.fadeMusic(useApp.getState().volume, .12); }} />
    {dragRadius !== null && <ArmSeekLabel album={album} progress={(146 - dragRadius) / 84} x={armPosition.x * deckScale} y={armPosition.y * deckScale} />}
  </div>;
}


import { useEffect, useRef, useSyncExternalStore } from "react";
import { audio } from "./audio";
import { GEQ_FREQS, PLUGINS } from "./fx";
import type { ParamDef, PluginDef, UnitState } from "./fx";
import { pauseOrResume } from "./player";
import { activeAlbum, useApp } from "./state";
import { t } from "./lang";
import { Icon, coverSrc, splitTitle } from "./PlayerScreen";
import { Ear, Fader, HSlider, Jewel, Knob, PatchCable, Reels, SevenSeg, VUMeter, Valves, vuAngle } from "./RackParts";
import type { KnobLook } from "./RackParts";

/* The plugin rack, browsed like the crate: one unit up front, the rest stacked behind it.
   Wheel / arrows flip through them; the front unit's controls are live. */

const rack = audio.rack;
const useRack = () => useSyncExternalStore((listener) => rack.subscribe(listener), () => rack.snapshot);

type Ctl = { plugin: PluginDef; unit: UnitState };
const param = (plugin: PluginDef, id: string): ParamDef => plugin.params.find((p) => p.id === id)!;
function K({ plugin, unit, id, look, size }: Ctl & { id: string; look: KnobLook; size?: number }) {
  return <Knob def={param(plugin, id)} value={unit.values[id]} look={look} size={size} onChange={(v) => rack.setValue(plugin.id, id, v)} />;
}
/** a two-position parameter as a bat toggle with its two labels (top = second option) */
function Switch({ plugin, unit, id }: Ctl & { id: string }) {
  const def = param(plugin, id), [a, b] = def.options!;
  const up = unit.values[id] === b.value;
  return <div className="rk-switch">
    <span className="rk-toggle-mark">{b.label}</span>
    <button className={"rk-bat" + (up ? " on" : "")} role="switch" aria-checked={up} aria-label={def.label}
      onClick={() => rack.setValue(plugin.id, id, up ? a.value : b.value)}>
      <svg viewBox="0 0 40 56" aria-hidden="true">
        <polygon points="20,15 31.3,21.5 31.3,34.5 20,41 8.7,34.5 8.7,21.5" fill="url(#nut)" stroke="rgba(0,0,0,.35)" strokeWidth=".6" />
        <circle cx="20" cy="28" r="6.5" fill="#cfcdc8" stroke="rgba(0,0,0,.4)" strokeWidth=".6" />
        <g className="lever"><path d="M17.6 28 L16.2 6 Q20 2 23.8 6 L22.4 28 Z" fill="url(#bat)" stroke="rgba(0,0,0,.35)" strokeWidth=".5" /></g>
      </svg>
    </button>
    <span className="rk-toggle-mark">{a.label}</span>
  </div>;
}
/** the unit is switched by its patch cable now; the panel keeps just its pilot lamp */
function Power(_: Ctl) { return null; }

/* ---------------------------------------------------------------- faceplates (after the originals) */
/** GE-10 — Technics SH-8065 / Klark Teknik DN27: brushed silver, a cyan fluorescent spectrum window,
    ten long faders with a centre detent, and a level fader. */
function GraphicFace(c: Ctl) {
  const v = c.unit.values;
  const fader = (id: string) => <Fader key={id} def={param(c.plugin, id)} value={v[id]} height={136} onChange={(x) => rack.setValue(c.plugin.id, id, x)} />;
  return <>
    <div className="ge-brand"><b>GRAPHIC EQUALIZER</b><span>{c.plugin.model}</span></div>
    <div className="ge-window">
      <canvas className="ge-vfd" width={760} height={88} />
      <div className="ge-freqs">{GEQ_FREQS.map((f) => <span key={f}>{f >= 1000 ? f / 1000 + "k" : f}</span>)}</div>
    </div>
    <div className="ge-bank">
      <div className="ge-scale"><span>+12</span><span>0</span><span>−12</span></div>
      {GEQ_FREQS.map((f) => fader("b" + f))}
      <i className="ge-divider" />
      {fader("level")}
    </div>
    <div className="ge-power"><Power {...c} /><Jewel on={c.unit.on} /></div>
  </>;
}
function PultecFace(c: Ctl) {
  return <>
    <div className="np pultec-plate"><b>PROGRAM EQUALIZER</b><span>MODEL {c.plugin.model}</span></div>
    <div className="pultec-side is-left"><Power {...c} /><div className="cap-label">EQUALIZER</div></div>
    <div className="pultec-grid">
      <div className="sec low">LOW FREQUENCY</div><div className="sec high">HIGH FREQUENCY</div>
      <K {...c} id="lowFreq" look="bakelite" size={66} /><K {...c} id="lowBoost" look="bakelite" size={66} />
      <K {...c} id="bandwidth" look="bakelite" size={66} /><K {...c} id="highFreq" look="bakelite" size={66} />
      <K {...c} id="lowAtten" look="bakelite" size={66} /><K {...c} id="highBoost" look="bakelite" size={66} />
      <K {...c} id="attenSel" look="bakelite" size={66} /><K {...c} id="highAtten" look="bakelite" size={66} />
    </div>
    <div className="pultec-side is-right"><Jewel on={c.unit.on} /><div className="cap-label">PILOT</div></div>
  </>;
}
function LA2AFace(c: Ctl) {
  return <>
    <div className="la-brand"><b>LEVELING AMPLIFIER</b><span>{c.plugin.model}</span></div>
    <div className="la-main">
      <K {...c} id="gain" look="bakelite" size={92} />
      <div className="la-meter"><VUMeter label="VU" /><div className="cap-label">GAIN REDUCTION</div></div>
      <K {...c} id="peak" look="bakelite" size={92} />
    </div>
    <div className="la-bottom"><Switch {...c} id="mode" /><div className="la-power"><Power {...c} /><Jewel on={c.unit.on} /></div></div>
  </>;
}
function VultureFace(c: Ctl) {
  return <>
    <div className="cv-brand"><b>{c.plugin.model}</b><span>VALVE CLIPPER</span></div>
    <div className="cv-row">
      <K {...c} id="drive" look="chicken" size={70} /><K {...c} id="bias" look="chicken" size={70} />
      <div className="cv-window"><Valves /><Switch {...c} id="type" /></div>
      <K {...c} id="mix" look="chicken" size={70} /><K {...c} id="output" look="chicken" size={70} />
    </div>
    <div className="cv-power"><Power {...c} /><Jewel on={c.unit.on} /></div>
  </>;
}
function SPFace(c: Ctl) {
  const v = c.unit.values;
  return <>
    <div className="sp-top">
      <div className="sp-brand"><b>{c.plugin.model}</b><span>SAMPLING CRUSHER</span></div>
      <div className="sp-displays">
        <div className="sp-led"><SevenSeg text={String(Math.round(v.bits)).padStart(2, " ")} /><span>BITS</span></div>
        <div className="sp-led"><SevenSeg text={(v.rate / 1000).toFixed(0).padStart(2, " ")} /><span>kHz</span></div>
      </div>
      <div className="sp-power"><Power {...c} /><Jewel on={c.unit.on} /></div>
    </div>
    <div className="sp-faders">
      {["bits", "rate", "tone", "mix"].map((id) => <Fader key={id} def={param(c.plugin, id)} value={v[id]} onChange={(x) => rack.setValue(c.plugin.id, id, x)} height={150} />)}
    </div>
  </>;
}
function MoogFace(c: Ctl) {
  return <>
    <i className="wood is-left" /><i className="wood is-right" />
    <div className="mf-brand"><b>{c.plugin.model}</b><span>LOWPASS FILTER</span></div>
    <div className="mf-row">
      <K {...c} id="drive" look="alu" size={70} /><K {...c} id="cutoff" look="alu" size={96} />
      <K {...c} id="res" look="alu" size={70} /><K {...c} id="mix" look="alu" size={70} />
      <Switch {...c} id="poles" />
    </div>
    <div className="mf-power"><Power {...c} /><Jewel on={c.unit.on} /></div>
  </>;
}
function EchoFace(c: Ctl) {
  const v = c.unit.values;
  return <>
    <div className="ep-brand"><b>Tape Echo</b><span>{c.plugin.model}</span></div>
    <div className="ep-row">
      <div className="ep-window"><Reels /></div>
      <div className="ep-center"><HSlider def={param(c.plugin, "delay")} value={v.delay} onChange={(x) => rack.setValue(c.plugin.id, "delay", x)} width={300} /></div>
      <K {...c} id="repeats" look="chicken" size={66} /><K {...c} id="volume" look="chicken" size={66} /><K {...c} id="wear" look="chicken" size={66} />
    </div>
    <div className="ep-power"><Power {...c} /><Jewel on={c.unit.on} /></div>
  </>;
}
const FACES: Record<string, (c: Ctl) => React.ReactElement> = { geq: GraphicFace, eq: PultecFace, comp: LA2AFace, tube: VultureFace, crush: SPFace, filter: MoogFace, echo: EchoFace };

function RackUnit({ plugin, unit, index, onFocus }: Ctl & { index: number; onFocus: (index: number) => void }) {
  const Face = FACES[plugin.id];
  return <article className={"rk-unit face-" + plugin.id + (unit.on ? " on" : "")} data-i={index}
    onPointerDownCapture={(event) => { if (!event.currentTarget.classList.contains("front")) { event.preventDefault(); event.stopPropagation(); onFocus(index); } }}>
    <PatchCable on={unit.on} label={(unit.on ? t("Unplug") : t("Plug in")) + " " + plugin.name} onToggle={() => rack.setOn(plugin.id, !unit.on)} />
    {plugin.id !== "filter" && <Ear side="left" />}
    <div className="rk-panel"><Face plugin={plugin} unit={unit} /></div>
    {plugin.id !== "filter" && <Ear side="right" />}
    <div className="rk-dim" />
  </article>;
}

/* ---------------------------------------------------------------- now playing (footer, left) */
function NowPlaying() {
  const albums = useApp((state) => state.albums);
  const activeId = useApp((state) => state.activeAlbumId);
  const trackIndex = useApp((state) => state.trackIndex);
  const phase = useApp((state) => state.phase);
  const album = albums.find((item) => item.id === activeId) ?? activeAlbum();
  if (!album) return <div className="rk-now empty">{t("Nothing on the deck — pick a record in")} <b>{t("Albums")}</b></div>;
  const track = album.tracks[trackIndex];
  return <div className="rk-now">
    <button className="icon-btn" style={{ marginLeft: -10 }} aria-label={phase === "PLAYING" ? "Pause" : "Play"} onClick={pauseOrResume}><Icon name={phase === "PLAYING" ? "pause" : "play"} /></button>
    <img src={coverSrc(album)} alt="" />
    <span>{track ? splitTitle(track.title, album.artist)[0] : album.title} <i>· {album.artist}</i></span>
  </div>;
}

export function PluginsScreen() {
  const state = useRack();
  const focused = useRef(0);
  const stack = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const motion = useRef({ pos: 0, target: 0, velocity: 0 });
  const wheel = useRef(0);
  const count = useRef<HTMLDivElement>(null);
  const focus = (index: number) => {
    const next = Math.max(0, Math.min(PLUGINS.length - 1, index));
    if (next === focused.current) return;
    focused.current = next; motion.current.target = next;
    const plugin = PLUGINS[next];
    if (caption.current) {
      caption.current.classList.remove("swap"); void caption.current.offsetWidth; caption.current.classList.add("swap");
      caption.current.querySelector("h2")!.textContent = plugin.model + " " + plugin.name;
      caption.current.querySelector(".after")!.textContent = plugin.after;
    }
    if (count.current) count.current.textContent = String(next + 1).padStart(2, "0") + " / " + String(PLUGINS.length).padStart(2, "0");
  };
  useEffect(() => {
    let frame = 0, last = performance.now(), vu = 0, glow = 0;
    const bandNow = new Float32Array(GEQ_FREQS.length), bandShown = new Float32Array(GEQ_FREQS.length), bandPeak = new Float32Array(GEQ_FREQS.length);
    const tick = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      // same spring and poses as the crate's sleeves
      const m = motion.current, w = 13;
      m.velocity += (-w * w * (m.pos - m.target) - 2 * w * m.velocity) * dt; m.pos += m.velocity * dt;
      stack.current?.querySelectorAll<HTMLElement>(".rk-unit").forEach((element, index) => {
        const d = index - m.pos;
        let y: number, scale: number, scaleY: number, dim: number, opacity: number, z: number;
        if (d >= 0) {
          const k = Math.min(d, 6);
          y = -k * 30; scale = 1 - k * .035; scaleY = 1; dim = Math.min(.72, k * .17); opacity = d > 5 ? Math.max(0, 6 - d) : 1; z = 100 - k;
        } else {
          const t = Math.min(1, -d), ease = t * t * (3 - 2 * t);
          y = 30 * ease; scale = 1 + .02 * ease; scaleY = Math.cos(ease * 1.3); dim = ease * .7;
          opacity = 1 - Math.min(1, Math.max(0, (-d - .3) / .5)); z = 101 + t;
        }
        element.style.transform = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)}, ${(scale * scaleY).toFixed(4)})`;
        element.style.opacity = Math.max(0, opacity).toFixed(3);
        element.style.zIndex = String(Math.round(z * 10));
        // a unit that has fallen forward is on its way out: invisible once faded, and never catches clicks
        element.style.visibility = opacity <= .01 || d > 6 ? "hidden" : "visible";
        element.style.pointerEvents = d < -.3 ? "none" : "";
        element.classList.toggle("front", Math.abs(d) < .5);
        element.querySelector<HTMLElement>(".rk-dim")!.style.opacity = dim.toFixed(3);
      });
      // meters: LV-2A shows gain reduction (0 VU at rest), the valves glow with drive and level
      const reduction = rack.meter("comp");
      vu += (Math.max(-20, reduction) - vu) * Math.min(1, dt / .28);           // needle ballistics, ~300 ms
      const level = audio.readout().musicRms;
      const tube = rack.snapshot.tube;
      glow += ((tube.on ? .35 + tube.values.drive / 10 * .45 + Math.min(.3, level * 2.5) : .12) - glow) * Math.min(1, dt / .12);
      const root = stack.current;
      if (root) { root.style.setProperty("--vu-angle", vuAngle(vu).toFixed(2) + "deg"); root.style.setProperty("--glow", glow.toFixed(3)); }
      // GE-10 spectrum: fluorescent bars with a slow fall and peak-hold dots
      const vfd = root?.querySelector<HTMLCanvasElement>(".ge-vfd");
      if (vfd) {
        audio.bands(GEQ_FREQS, bandNow);
        const g = vfd.getContext("2d")!, w = vfd.width, h = vfd.height, cols = GEQ_FREQS.length, rows = 14;
        const colW = w / cols, cellH = h / rows;
        g.clearRect(0, 0, w, h);
        for (let i = 0; i < cols; i++) {
          const level = Math.min(1, Math.pow(bandNow[i], 1.6) * 1.35);
          bandShown[i] = level > bandShown[i] ? level : Math.max(level, bandShown[i] - dt * 1.4);
          bandPeak[i] = bandShown[i] > bandPeak[i] ? bandShown[i] : Math.max(0, bandPeak[i] - dt * .35);
          const lit = Math.round(bandShown[i] * rows), peak = Math.min(rows - 1, Math.round(bandPeak[i] * rows));
          for (let r = 0; r < rows; r++) {
            const on = r < lit || (r === peak && peak > 0);
            g.fillStyle = on ? (r >= rows - 3 ? "rgba(255,190,120,.95)" : "rgba(110,240,225,.95)") : "rgba(110,240,225,.07)";
            g.shadowColor = on ? "rgba(110,240,225,.8)" : "transparent"; g.shadowBlur = on ? 6 : 0;
            g.fillRect(i * colW + colW * .18, h - (r + 1) * cellH + 1.5, colW * .64, cellH - 3);
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("[role=slider]")) return;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); focus(focused.current + 1); }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); focus(focused.current - 1); }
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, []);
  const playing = useApp((s) => s.phase === "PLAYING");
  const engaged = PLUGINS.filter((plugin) => state[plugin.id].on).length;
  const first = PLUGINS[0];
  return <div className={"screen plugins-screen" + (playing ? " playing" : "")} onWheel={(event) => {
    wheel.current += event.deltaY + event.deltaX;
    if (Math.abs(wheel.current) > 40) { focus(focused.current + Math.sign(wheel.current)); wheel.current = 0; }
  }}>
    <header className="header">
      <div className="brand"><span className="h">{t("Plugins")}</span><span className="mono">{engaged ? engaged + " " + t("of") + " " + PLUGINS.length + " " + t("on") : PLUGINS.length + " " + t("units")}</span></div>
      <div className="hright"><button className="pill-btn" onClick={() => rack.reset()}><Icon name="x" size={14} />{t("Reset rack")}</button></div>
    </header>
    <div className="rk-stack" ref={stack}>
      {PLUGINS.map((plugin, index) => <RackUnit key={plugin.id} plugin={plugin} unit={state[plugin.id]} index={index} onFocus={focus} />)}
    </div>
    <div className="caption rk-caption" ref={caption}><h2>{first.model + " " + first.name}</h2><div className="sub"><span className="after">{first.after}</span></div></div>
    <footer className="foot">
      <NowPlaying />
      <div className="hint">{t("Scroll to flip · drag a knob · double-click resets")}</div>
      <div className="count mono" ref={count}>01 / {String(PLUGINS.length).padStart(2, "0")}</div>
    </footer>
  </div>;
}

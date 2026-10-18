import { useId, useRef, useState } from "react";
import { toPosition, toValue } from "./fx";
import type { ParamDef } from "./fx";

/* Vintage hardware parts for the plugin faceplates: knobs (bakelite / chicken-head / knurled
   aluminium), a bat toggle, a jewel pilot lamp, a VU meter, tape reels and 7-segment digits.
   Everything is SVG/CSS; colours come from the faceplate via CSS custom properties (--ink, --lamp). */

const SWEEP = 300, START = -150;
const polar = (cx: number, cy: number, r: number, deg: number) =>
  [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)] as const;

export type KnobLook = "bakelite" | "chicken" | "alu";
/** A knob with a silkscreened scale. Drag up/down (Shift = fine), wheel, arrows; double-click resets.
    The exact value only shows while the knob is handled — the panel itself has just the printed scale. */
export function Knob({ def, value, onChange, look, size = 84, marks = "numbers", legend }: {
  def: ParamDef; value: number; onChange: (value: number) => void; look: KnobLook; size?: number;
  marks?: "numbers" | "ticks" | "none"; legend?: [string, string, string?];
}) {
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);
  const drag = useRef<{ y: number; position: number } | null>(null);
  const position = toPosition(def, value);
  const angle = START + position * SWEEP;
  const nudge = (delta: number) => onChange(toValue(def, position + delta));
  const pad = 26, box = size + pad * 2, c = box / 2, r = size / 2;
  // continuous: 11 ticks with a 0–10 (or 0–100) dial; selectors: one tick per position, labelled
  const ticks = def.options ? def.options.map((_, i, all) => START + i * SWEEP / Math.max(1, all.length - 1)) : Array.from({ length: 11 }, (_, i) => START + i * SWEEP / 10);
  return <div className={"rk-knob " + look + (active ? " active" : "")} style={{ width: box }}>
    <div className="rk-knob-face" style={{ width: box, height: box }}>
      {marks !== "none" && <svg className="rk-scale" viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
        {ticks.map((deg, i) => {
          const major = def.options ? true : i % 5 === 0;
          const [x1, y1] = polar(c, c, r + 5, deg), [x2, y2] = polar(c, c, r + (major ? 11 : 8), deg);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? "major" : ""} />;
        })}
        {marks === "numbers" && ticks.map((deg, i) => {
          if (!def.options && i % 2) return null;
          const [x, y] = polar(c, c, r + 19, deg);
          const label = def.options ? def.options[i].label : def.max === 100 ? String(i * 10) : String(i);
          return <text key={"n" + i} x={x} y={y + 3.5}>{label}</text>;
        })}
        {legend && <>
          <text x={polar(c, c, r + 19, START)[0] - 6} y={box - 5} className="legend" textAnchor="end">{legend[0]}</text>
          {legend[2] && <text x={c} y={8} className="legend">{legend[2]}</text>}
          <text x={polar(c, c, r + 19, START + SWEEP)[0] + 6} y={box - 5} className="legend" textAnchor="start">{legend[1]}</text>
        </>}
      </svg>}
      <div className="rk-knob-body" role="slider" tabIndex={0} aria-label={def.label}
        aria-valuemin={def.min} aria-valuemax={def.max} aria-valuenow={value} aria-valuetext={def.format(value)}
        style={{ left: pad, top: pad, width: size, height: size }}
        onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
        onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { y: event.clientY, position }; setActive(true); }}
        onPointerMove={(event) => { if (drag.current) onChange(toValue(def, drag.current.position + (drag.current.y - event.clientY) / (event.shiftKey ? 900 : 220))); }}
        onPointerUp={() => { drag.current = null; setActive(false); }}
        onPointerCancel={() => { drag.current = null; setActive(false); }}
        onDoubleClick={() => onChange(def.default)}
        onWheel={(event) => { event.stopPropagation(); nudge(-Math.sign(event.deltaY) * (event.shiftKey ? .01 : .04)); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); nudge(.02); }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); nudge(-.02); }
        }}>
        {look === "chicken"
          ? <svg className="rk-chicken" viewBox="0 0 100 100" style={{ rotate: angle + "deg" }} aria-hidden="true">
              <defs><radialGradient id="ck" cx=".38" cy=".3" r=".8"><stop offset="0" stopColor="#4a4744" /><stop offset=".55" stopColor="#1d1b1a" /><stop offset="1" stopColor="#0b0a0a" /></radialGradient></defs>
              <circle cx="50" cy="50" r="31" fill="url(#ck)" />
              <path d="M50 3 C57 3 60 24 61 38 L61 62 C61 70 39 70 39 62 L39 38 C40 24 43 3 50 3 Z" fill="url(#ck)" />
              <path d="M50 8 L50 30" stroke="#efe9da" strokeWidth="3" strokeLinecap="round" />
              <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
            </svg>
          : <div className="rk-cap" style={{ rotate: angle + "deg" }}><i className="pointer" /></div>}
      </div>
      {(active || hover) && <div className="rk-readout">{def.format(value)}</div>}
    </div>
    <div className="rk-label">{def.label}</div>
  </div>;
}

/** Bat-handle toggle on a hex bushing, IN up / OUT down. */
export function BatToggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return <div className="rk-toggle">
    <span className="rk-toggle-mark">IN</span>
    <button className={"rk-bat" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} onClick={onToggle}>
      <svg viewBox="0 0 40 56" aria-hidden="true">
        <defs>
          <radialGradient id="nut" cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#f2f1ee" /><stop offset=".6" stopColor="#a5a4a0" /><stop offset="1" stopColor="#64635f" /></radialGradient>
          <linearGradient id="bat" x1="0" x2="1"><stop offset="0" stopColor="#7d7c78" /><stop offset=".4" stopColor="#f6f5f2" /><stop offset="1" stopColor="#8a8985" /></linearGradient>
        </defs>
        <polygon points="20,15 31.3,21.5 31.3,34.5 20,41 8.7,34.5 8.7,21.5" fill="url(#nut)" stroke="rgba(0,0,0,.35)" strokeWidth=".6" />
        <circle cx="20" cy="28" r="6.5" fill="#cfcdc8" stroke="rgba(0,0,0,.4)" strokeWidth=".6" />
        <g className="lever"><path d="M17.6 28 L16.2 6 Q20 2 23.8 6 L22.4 28 Z" fill="url(#bat)" stroke="rgba(0,0,0,.35)" strokeWidth=".5" /></g>
      </svg>
    </button>
    <span className="rk-toggle-mark">OUT</span>
  </div>;
}

/** Jewel pilot lamp: faceted glass, glows when the unit is in. Colour from --lamp. */
export function Jewel({ on }: { on: boolean }) {
  return <span className={"rk-jewel" + (on ? " on" : "")}><i /></span>;
}

/** Rack ear with two oval slots and screws. */
export function Ear({ side }: { side: "left" | "right" }) {
  return <div className={"rk-ear is-" + side}><span className="slot"><i className="screw" /></span><span className="slot"><i className="screw" /></span></div>;
}

/** VU law: the needle follows voltage, so the dial is laid out on 10^(dB/20) — 0 VU sits ~70 % across. */
export function vuAngle(db: number): number {
  const p = Math.pow(10, Math.max(-20, Math.min(3, db)) / 20), lo = Math.pow(10, -1), hi = Math.pow(10, 3 / 20);
  return -48 + (p - lo) / (hi - lo) * 96;
}
/** Moving-coil VU meter. The needle angle comes from --vu-angle (deg), set every frame by the screen. */
export function VUMeter({ label = "VU" }: { label?: string }) {
  const marks = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
  const labelled = new Set([-20, -10, -7, -5, -3, 0, 3]);
  const deg = vuAngle;
  return <div className="rk-vu">
    <svg viewBox="0 0 220 128" aria-hidden="true">
      <defs>
        <radialGradient id="vuface" cx=".5" cy=".95" r="1"><stop offset="0" stopColor="#fbf3d6" /><stop offset=".7" stopColor="#efe2b8" /><stop offset="1" stopColor="#d9c993" /></radialGradient>
      </defs>
      <rect x="0" y="0" width="220" height="128" rx="6" fill="url(#vuface)" />
      <path d={`M ${110 + 92 * Math.sin(deg(0) * Math.PI / 180)} ${118 - 92 * Math.cos(deg(0) * Math.PI / 180)} A 92 92 0 0 1 ${110 + 92 * Math.sin(deg(3) * Math.PI / 180)} ${118 - 92 * Math.cos(deg(3) * Math.PI / 180)}`}
        stroke="#c0281e" strokeWidth="5" fill="none" />
      {marks.map((db) => {
        const a = deg(db) * Math.PI / 180, inner = labelled.has(db) ? 80 : 84;
        return <g key={db}>
          <line x1={110 + inner * Math.sin(a)} y1={118 - inner * Math.cos(a)} x2={110 + 92 * Math.sin(a)} y2={118 - 92 * Math.cos(a)} stroke={db > 0 ? "#c0281e" : "#2a2622"} strokeWidth={db === 0 ? 1.6 : 1} />
          {labelled.has(db) && <text x={110 + 70 * Math.sin(a)} y={118 - 70 * Math.cos(a) + 3} className={db > 0 ? "red" : ""}>{db > 0 ? "+" + db : db}</text>}
        </g>;
      })}
      <text x="110" y="92" className="unit">{label}</text>
      <g className="needle"><line x1="110" y1="118" x2="110" y2="26" stroke="#141210" strokeWidth="1.3" /></g>
      <circle cx="110" cy="118" r="9" fill="#2a2622" />
    </svg>
    <span className="glass" />
  </div>;
}

/** Two tape reels behind a window; they turn while music plays (--reel-speed, paused otherwise). */
export function Reels() {
  const reel = <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="48" fill="#3b2a1d" />
    <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.08)" />
    <circle cx="50" cy="50" r="30" fill="#2a1d14" />
    {[0, 120, 240].map((a) => <path key={a} d="M50 50 L44 10 A40 40 0 0 1 56 10 Z" fill="#cfc8bb" transform={`rotate(${a} 50 50)`} opacity=".9" />)}
    <circle cx="50" cy="50" r="12" fill="#d8d2c6" stroke="rgba(0,0,0,.4)" />
    <circle cx="50" cy="50" r="4" fill="#3a3632" />
  </svg>;
  return <div className="rk-reels"><div className="reel is-left">{reel}</div><div className="tape" /><div className="reel is-right">{reel}</div></div>;
}

const SEGMENTS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgecd", "7": "abc", "8": "abcdefg", "9": "abcfgd", "-": "g", " ": ""
};
/** Red 7-segment digits; dim segments stay faintly visible like real LED displays. */
export function SevenSeg({ text }: { text: string }) {
  const seg = { a: "M3 1 L15 1 L13 3 L5 3 Z", b: "M16 2 L16 13 L14 12 L14 4 Z", c: "M16 15 L16 26 L14 24 L14 16 Z", d: "M3 27 L15 27 L13 25 L5 25 Z",
    e: "M2 15 L2 26 L4 24 L4 16 Z", f: "M2 2 L2 13 L4 12 L4 4 Z", g: "M3 14 L5 13 L13 13 L15 14 L13 15 L5 15 Z" } as const;
  return <svg className="rk-7seg" viewBox={`0 0 ${text.length * 20} 28`} aria-label={text}>
    {[...text].map((ch, i) => <g key={i} transform={`translate(${i * 20} 0) skewX(-6)`}>
      {(Object.keys(seg) as (keyof typeof seg)[]).map((s) => <path key={s} d={seg[s]} className={(SEGMENTS[ch] ?? "").includes(s) ? "lit" : ""} />)}
    </g>)}
  </svg>;
}

/** Vertical fader (SP-1200 style): slot, printed scale, black cap with a white line. */
export function Fader({ def, value, onChange, height = 150 }: { def: ParamDef; value: number; onChange: (value: number) => void; height?: number }) {
  const [active, setActive] = useState(false);
  const drag = useRef<{ y: number; position: number } | null>(null);
  const position = toPosition(def, value);
  const travel = height - 22;
  return <div className={"rk-fader" + (active ? " active" : "")}>
    <div className="rk-fader-track" style={{ height }} role="slider" tabIndex={0} aria-label={def.label}
      aria-valuemin={def.min} aria-valuemax={def.max} aria-valuenow={value} aria-valuetext={def.format(value)}
      onPointerDown={(event) => {
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        const box = event.currentTarget.getBoundingClientRect(), scale = box.height / height;
        const capY = (1 - position) * travel * scale + box.top + 11 * scale;
        // grabbing the cap keeps its offset; clicking the slot jumps there
        const start = Math.abs(event.clientY - capY) < 14 * scale ? position : 1 - (event.clientY - box.top - 11 * scale) / (travel * scale);
        drag.current = { y: event.clientY, position: start }; setActive(true); onChange(toValue(def, start));
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const scale = event.currentTarget.getBoundingClientRect().height / height;
        onChange(toValue(def, drag.current.position + (drag.current.y - event.clientY) / (travel * scale) * (event.shiftKey ? .25 : 1)));
      }}
      onPointerUp={() => { drag.current = null; setActive(false); }}
      onPointerCancel={() => { drag.current = null; setActive(false); }}
      onDoubleClick={() => onChange(def.default)}
      onWheel={(event) => { event.stopPropagation(); onChange(toValue(def, position - Math.sign(event.deltaY) * .04)); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); onChange(toValue(def, position + .02)); }
        if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); onChange(toValue(def, position - .02)); }
      }}>
      <span className="slot" />
      {Array.from({ length: 11 }, (_, i) => <i key={i} className={"tick" + (i % 5 === 0 ? " major" : "") + (def.bipolar && i === 5 ? " centre" : "")} style={{ top: 11 + i * travel / 10 }} />)}
      <span className="cap" style={{ top: (1 - position) * travel }} />
      {active && <span className="rk-readout fader">{def.format(value)}</span>}
    </div>
    <div className="rk-label">{def.label}</div>
  </div>;
}

/** Horizontal slider (the Echoplex head-position "Echo delay" control). */
export function HSlider({ def, value, onChange, width = 300 }: { def: ParamDef; value: number; onChange: (value: number) => void; width?: number }) {
  const [active, setActive] = useState(false);
  const drag = useRef<{ x: number; position: number } | null>(null);
  const position = toPosition(def, value);
  const travel = width - 40;
  return <div className={"rk-hslider" + (active ? " active" : "")} style={{ width }}>
    <div className="rk-hslider-track" role="slider" tabIndex={0} aria-label={def.label}
      aria-valuemin={def.min} aria-valuemax={def.max} aria-valuenow={value} aria-valuetext={def.format(value)}
      onPointerDown={(event) => {
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        const box = event.currentTarget.getBoundingClientRect(), scale = box.width / width;
        const start = Math.min(1, Math.max(0, (event.clientX - box.left - 20 * scale) / (travel * scale)));
        drag.current = { x: event.clientX, position: start }; setActive(true); onChange(toValue(def, start));
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const scale = event.currentTarget.getBoundingClientRect().width / width;
        onChange(toValue(def, drag.current.position + (event.clientX - drag.current.x) / (travel * scale) * (event.shiftKey ? .25 : 1)));
      }}
      onPointerUp={() => { drag.current = null; setActive(false); }}
      onPointerCancel={() => { drag.current = null; setActive(false); }}
      onDoubleClick={() => onChange(def.default)}
      onWheel={(event) => { event.stopPropagation(); onChange(toValue(def, position - Math.sign(event.deltaY) * .03)); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onChange(toValue(def, position + .02)); }
        if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); onChange(toValue(def, position - .02)); }
      }}>
      <span className="slot" />
      {Array.from({ length: 11 }, (_, i) => <i key={i} className={"tick" + (i % 5 === 0 ? " major" : "")} style={{ left: 20 + i * travel / 10 }} />)}
      <span className="cap" style={{ left: position * travel }} />
      {active && <span className="rk-readout hs" style={{ left: 20 + position * travel }}>{def.format(value)}</span>}
    </div>
    <div className="rk-label">{def.label}</div>
  </div>;
}

/** Two glowing valves behind a smoked window; --glow (0..1) set from drive and the music level. */
export function Valves() {
  const valve = <svg viewBox="0 0 60 120" aria-hidden="true">
    <defs>
      <linearGradient id="vglass" x1="0" x2="1"><stop offset="0" stopColor="rgba(255,255,255,.22)" /><stop offset=".25" stopColor="rgba(255,255,255,.04)" /><stop offset=".8" stopColor="rgba(255,255,255,.02)" /><stop offset="1" stopColor="rgba(255,255,255,.16)" /></linearGradient>
      <radialGradient id="vglow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ffb35c" /><stop offset=".45" stopColor="rgba(255,120,40,.55)" /><stop offset="1" stopColor="rgba(255,90,20,0)" /></radialGradient>
    </defs>
    <ellipse className="vglow" cx="30" cy="62" rx="26" ry="40" fill="url(#vglow)" />
    <rect x="17" y="34" width="26" height="54" rx="2" fill="#3b3a38" stroke="#6a6863" strokeWidth=".6" />
    <rect x="21" y="40" width="18" height="42" fill="#232221" />
    <line className="filament" x1="30" y1="42" x2="30" y2="80" stroke="#ffcf8a" strokeWidth="1.4" />
    <path d="M8 104 L8 30 Q8 6 30 6 Q52 6 52 30 L52 104 Z" fill="url(#vglass)" stroke="rgba(255,255,255,.18)" strokeWidth=".8" />
    <rect x="6" y="104" width="48" height="12" rx="2" fill="#1b1a19" />
    <circle cx="30" cy="8" r="3" fill="rgba(200,210,220,.35)" />
  </svg>;
  return <div className="rk-valves"><div className="valve">{valve}</div><div className="valve">{valve}</div></div>;
}
/** Patch cable into a jack on the unit's left ear: plugged = the unit is in. The cable hangs up from below
    the frame under its own weight and bends into the jack; click the cable or the plug to pull it out
    (a visible gap opens and the plug droops) or push it back in. */
export function PatchCable({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  // per-instance ids: a mask referenced from a hidden unit in the stack would hide every cable
  const id = useId().replace(/:/g, "");
  return <button className={"rk-cable" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} title={on ? "Unplug" : "Plug in"} onClick={onToggle}>
    <svg viewBox="0 0 440 480" aria-hidden="true">
      <defs>
        <linearGradient id={"pc-fade" + id} x1="0" y1="0" x2="0" y2="1"><stop offset=".62" stopColor="#fff" /><stop offset=".96" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id={"pc-mask" + id} maskUnits="userSpaceOnUse" x="0" y="0" width="440" height="480"><rect width="440" height="480" fill={`url(#pc-fade${id})`} /></mask>
        {/* everything right of the socket face is inside the jack: the shaft disappears into it as it slides in */}
        <clipPath id={"pc-clip" + id} clipPathUnits="userSpaceOnUse"><rect x="-200" y="-200" width="572" height="900" /></clipPath>
        <linearGradient id="pc-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7d7c78" /><stop offset=".28" stopColor="#fbfaf7" /><stop offset=".55" stopColor="#bdbcb7" /><stop offset=".8" stopColor="#8b8a86" /><stop offset="1" stopColor="#5b5a57" /></linearGradient>
        <linearGradient id="pc-boot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5a5856" /><stop offset=".3" stopColor="#2a2928" /><stop offset=".75" stopColor="#121212" /><stop offset="1" stopColor="#080808" /></linearGradient>
        <radialGradient id="pc-nut" cx=".35" cy=".3" r=".9"><stop offset="0" stopColor="#f4f3ef" /><stop offset=".6" stopColor="#a3a29d" /><stop offset="1" stopColor="#5e5d59" /></radialGradient>
      </defs>
      <g mask={`url(#pc-mask${id})`}>
        <path className="cable shadow" fill="none" />
        <path className="cable body" fill="none" />
        <path className="cable braid" fill="none" />
        <path className="cable shine" fill="none" />
      </g>
      {/* 1/4" plug: ribbed rubber boot, knurled body, chrome collar and sleeve, ring insulator, tip */}
      <g clipPath={`url(#pc-clip${id})`}><g className="plug">
        <path d="M296 141 Q300 139 318 138 L318 162 Q300 161 296 159 Z" fill="url(#pc-boot)" />
        {[301, 306, 311].map((x) => <rect key={x} x={x} y="139.5" width="1.6" height="21" rx=".8" fill="rgba(255,255,255,.08)" />)}
        <rect x="316" y="135" width="46" height="30" rx="7" fill="url(#pc-boot)" />
        <rect x="320" y="137" width="38" height="3" rx="1.5" fill="rgba(255,255,255,.16)" />
        {[328, 334, 340, 346].map((x) => <rect key={x} x={x} y="141" width="1.4" height="18" fill="rgba(0,0,0,.45)" />)}
        <rect x="360" y="138" width="10" height="24" rx="2" fill="url(#pc-chrome)" />
        <rect x="370" y="143" width="24" height="14" rx="1" fill="url(#pc-chrome)" />
        <rect x="394" y="143.5" width="3" height="13" fill="#141414" />
        <path d="M397 143.5 L403 145 Q408 150 403 155 L397 156.5 Z" fill="url(#pc-chrome)" />
      </g></g>
      {/* the jack is side-mounted on the unit's left edge (x 387): seen side-on — a hex nut on a threaded
          bushing. The plug runs straight into it; its shaft is clipped at the bushing face (x 372). */}
      <g className="socket">
        <rect x="372" y="141" width="6" height="18" rx="1" fill="url(#pc-chrome)" />
        {[143.5, 146.5, 149.5, 152.5, 155.5].map((y) => <rect key={y} x="372" y={y} width="6" height=".8" fill="rgba(0,0,0,.25)" />)}
        <rect x="377" y="135" width="11" height="30" rx="1.5" fill="url(#pc-chrome)" />
        <rect x="377" y="142.5" width="11" height=".9" fill="rgba(0,0,0,.28)" />
        <rect x="377" y="156.6" width="11" height=".9" fill="rgba(0,0,0,.28)" />
        <rect x="377" y="135" width="1.2" height="30" fill="rgba(255,255,255,.5)" />
      </g>    </svg>
  </button>;
}
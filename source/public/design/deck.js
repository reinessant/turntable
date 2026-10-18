/* =====================================================================
   DECK — the turntable, drawn as 2.5D layers.
   All geometry is in MILLIMETRES (real Braun-PS-500-like proportions)
   and scaled by one factor: mm → px. Nothing is hard-coded in px.

   Layers (bottom → top), each its own element so it can sit at its own
   translateZ and animate independently:
     plinth (div)  →  well + platter (div)  →  record (canvas, rotates)
     →  label (div, rotates)  →  sheen (div, FIXED to the light)
     →  arm shadow (svg)  →  arm (svg, rotates around pivot)
   ===================================================================== */

const MM = {
  plinth: { w: 590, h: 372, r: 9 },
  spindle: { x: 196, y: 186 },          // platter centre
  well: 160, platter: 156, mat: 153,    // radii
  record: 151, label: 50, hole: 3.62,   // 302 mm LP, 100 mm label, 7.24 mm hole
  grooveOuter: 146, grooveInner: 62,    // recorded area
  pivot: { x: 478, y: 82 },             // tonearm bearing centre
  armLen: 238,                          // pivot → stylus
  counterweightBack: 46,                // cw centre behind pivot
};

/* Two plinth layouts. "landscape" is the original. "portrait" is the same machine turned a quarter
   turn clockwise — record at the top, centred across the plinth; arm and controls below — but it is
   laid out, not CSS-rotated, so the light still comes from the top-left and the front face stays at
   the bottom. Positions are centres in mm; the portrait ones are the landscape ones mapped
   (x, y) → (372 − y, x), angles + 90°. */
const LAYOUT = {
  landscape: {
    plinth: { w: 590, h: 372 }, spindle: { x: 196, y: 186 }, pivot: { x: 478, y: 82 }, armRest: 99,
    play: { x: 430, y: 330 }, volume: { x: 464, y: 330 }, led: { x: 487.5, y: 330 },
    engrave: { x: 496, y: 326.5, anchor: "left" }, cue: { x: 514, y: 105.5, w: 24, h: 7 }
  },
  /* "wide": landscape, but the plinth reaches as far left of the record as right of it (342 mm each
     side; trimmed to 342 mm: just past the cue lever), so the record is at the plinth's centre. The arm side is unchanged; the left wing takes
     the start/stop + volume cluster, front-left like a classic direct-drive deck. */
  wide: {
    plinth: { w: 684, h: 372 }, spindle: { x: 342, y: 186 }, pivot: { x: 624, y: 82 }, armRest: 99,
    play: { x: 64, y: 330 }, volume: { x: 98, y: 330 }, led: { x: 121.5, y: 330 },
    engrave: { x: 130, y: 326.5, anchor: "left" }, cue: { x: 660, y: 105.5, w: 24, h: 7 }
  },
  portrait: {
    plinth: { w: 372, h: 590 }, spindle: { x: 186, y: 196 }, pivot: { x: 290, y: 478 }, armRest: 189,
    play: { x: 42, y: 430 }, volume: { x: 42, y: 464 }, led: { x: 42, y: 487.5 },
    engrave: { x: 42, y: 497, anchor: "centre" }, cue: { x: 266.5, y: 514, w: 7, h: 24 }
  }
};
let ARM_REST_DEG = 99;

/** Solve arm angle (radians, 0 = +x, y down) so the stylus sits at radius r. */
function armAngleFor(r) {
  const P = MM.pivot, S = MM.spindle, L = MM.armLen;
  // circle(P,L) ∩ circle(S,r): pick the intersection on the platter's right side
  const dx = S.x - P.x, dy = S.y - P.y, d = Math.hypot(dx, dy);
  const a = (L * L - r * r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L * L - a * a));
  const mx = P.x + (a * dx) / d, my = P.y + (a * dy) / d;
  const x = mx + (h * dy) / d, y = my - (h * dx) / d;   // the solution on the arm's side (right of the spindle)
  return Math.atan2(y - P.y, x - P.x);
}
const armRest = () => (ARM_REST_DEG * Math.PI) / 180;   // parked: down the right side (landscape) / along the bottom (portrait)

/** Render the vinyl surface once to a canvas (grooves, track bands, dust). */
function drawRecord(canvas, sizePx, trackFractions, vinyl) {
  const base = (vinyl && vinyl.base) || "#131316", edge = (vinyl && vinyl.edge) || base;
  const ink = vinyl && vinyl.light ? "0,0,0" : "255,255,255";   // grooves catch light on dark vinyl, shade on light vinyl
  const dpr = Math.min(2, window.devicePixelRatio || 1) * 1.5;
  canvas.width = canvas.height = Math.round(sizePx * dpr);
  canvas.style.width = canvas.style.height = sizePx + "px";
  const c = canvas.getContext("2d");
  const R = canvas.width / 2, k = R / MM.record;
  c.translate(R, R);

  // base — never pure black
  const body = c.createRadialGradient(0, 0, 0, 0, 0, R);
  body.addColorStop(0, base); body.addColorStop(.75, base); body.addColorStop(1, edge);
  c.fillStyle = body; c.beginPath(); c.arc(0, 0, R, 0, 7); c.fill();

  // outer rim bevel
  c.strokeStyle = `rgba(${ink},.10)`; c.lineWidth = 1.2 * k;
  c.beginPath(); c.arc(0, 0, R - 0.6 * k, 0, 7); c.stroke();

  // grooves: fine rings with slightly random intensity (real pressing variation)
  const bands = trackFractions;  // cumulative fractions of the album, e.g. [0.1, 0.23, ...]
  const rOut = MM.grooveOuter * k, rIn = MM.grooveInner * k, step = 0.42 * k;
  for (let r = rOut; r > rIn; r -= step) {
    const f = (rOut - r) / (rOut - rIn);                 // 0 at outer edge → 1 at inner
    const inGap = bands.some(b => Math.abs(f - b) < 0.0085);
    if (inGap) continue;                                  // smooth gap between tracks
    const a = 0.028 + Math.random() * 0.03;
    c.strokeStyle = `rgba(${ink},${a})`; c.lineWidth = 0.5;
    c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke();
  }
  // gaps between tracks — a touch lighter, smooth, reads as the "bands" of a real LP
  for (const b of bands) {
    const r = rOut - b * (rOut - rIn);
    c.strokeStyle = `rgba(${ink},.045)`; c.lineWidth = 1.4 * k;
    c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke();
  }
  // lead-in and run-out are smooth and slightly glossier
  c.strokeStyle = `rgba(${ink},.035)`; c.lineWidth = 3 * k;
  c.beginPath(); c.arc(0, 0, (MM.grooveOuter + 2) * k, 0, 7); c.stroke();
  c.lineWidth = 8 * k; c.beginPath(); c.arc(0, 0, (MM.grooveInner - 5) * k, 0, 7); c.stroke();

  // dust + a few hairline scratches — these are what make ROTATION visible
  for (let i = 0; i < 70; i++) {
    const ang = Math.random() * 6.283, rr = (MM.label + 6 + Math.random() * 88) * k;
    c.fillStyle = `rgba(${ink},${0.08 + Math.random() * 0.18})`;
    c.beginPath(); c.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, (0.12 + Math.random() * 0.25) * k, 0, 7); c.fill();
  }
  for (let i = 0; i < 5; i++) {
    const ang = Math.random() * 6.283, rr = (70 + Math.random() * 70) * k, span = 0.15 + Math.random() * 0.4;
    c.strokeStyle = `rgba(${ink},.06)`; c.lineWidth = 0.6;
    c.beginPath(); c.arc(0, 0, rr, ang, ang + span); c.stroke();
  }
}

/** The tonearm as one SVG in plinth millimetre space: a static bearing housing, and the rotating arm —
    knurled counterweight, gimbal, Ø9 tube with a specular line, collar, aluminium headshell with a
    finger lift and a black cartridge with its stylus. */
function armSVG(id) {
  const P = MM.pivot, L = MM.armLen, cwB = MM.counterweightBack;
  const cyl = (name, stops) => `<linearGradient id="${id}-${name}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
  const knurl = (x0, x1, y0, y1, step) => { let s = ""; for (let x = x0; x <= x1; x += step) s += `<line x1="${x.toFixed(2)}" y1="${y0}" x2="${x.toFixed(2)}" y2="${y1}"/>`; return s; };
  return `
  <defs>
    ${cyl("tube", [[0, "#55544f"], [.16, "#9d9b96"], [.3, "#fbfaf7"], [.4, "#e2e0db"], [.62, "#a3a19c"], [.85, "#6b6a66"], [1, "#3f3e3b"]])}
    ${cyl("cw", [[0, "#3a3937"], [.18, "#8d8b86"], [.32, "#f2f0eb"], [.46, "#c9c7c2"], [.7, "#7c7a76"], [1, "#2c2b29"]])}
    ${cyl("collar", [[0, "#4a4945"], [.3, "#f6f5f1"], [.55, "#b7b5b0"], [1, "#55544f"]])}
    ${cyl("shell", [[0, "#9a9893"], [.25, "#f3f2ee"], [.6, "#c3c1bb"], [1, "#7f7d78"]])}
    ${cyl("cart", [[0, "#3c3c3f"], [.3, "#232325"], [1, "#0b0b0c"]])}
    <radialGradient id="${id}-base" cx=".36" cy=".3" r=".85">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#d6d3cd"/><stop offset=".85" stop-color="#9a978f"/><stop offset="1" stop-color="#7d7a74"/>
    </radialGradient>
    <radialGradient id="${id}-cap" cx=".38" cy=".32" r=".8">
      <stop offset="0" stop-color="#fdfdfb"/><stop offset=".6" stop-color="#bdbab4"/><stop offset="1" stop-color="#7e7b75"/>
    </radialGradient>
    <linearGradient id="${id}-spec" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".15" stop-color="#fff" stop-opacity=".9"/><stop offset=".85" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <!-- bearing housing (static): turned base, a darker bearing well, anti-skate dial -->
  <circle cx="${P.x}" cy="${P.y}" r="16" fill="url(#${id}-base)"/>
  <circle cx="${P.x}" cy="${P.y}" r="16" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>
  ${[13.5, 11, 8.5].map((r) => `<circle cx="${P.x}" cy="${P.y}" r="${r}" fill="none" stroke="rgba(0,0,0,.09)" stroke-width=".35"/>`).join("")}
  <circle cx="${P.x}" cy="${P.y}" r="10.5" fill="rgba(0,0,0,.18)"/>
  <!-- rotating arm, drawn along +x from the pivot -->
  <g class="arm-rot" style="transform-origin:${P.x}px ${P.y}px">
    <g transform="translate(${P.x} ${P.y})">
      <!-- rear stub -->
      <rect x="${-cwB + 12}" y="-3.6" width="${cwB - 14}" height="7.2" rx="1" fill="url(#${id}-tube)"/>
      <!-- counterweight: cylinder, knurled bands, chrome ring, dark end cap -->
      <rect x="${-cwB - 16}" y="-17" width="32" height="34" rx="2.5" fill="url(#${id}-cw)"/>
      <g stroke="rgba(0,0,0,.28)" stroke-width=".42">${knurl(-cwB - 14.5, -cwB - 6.5, -17, 17, 1.15)}${knurl(-cwB + 6.5, -cwB + 14.5, -17, 17, 1.15)}</g>
      <rect x="${-cwB - 4.5}" y="-17" width="9" height="34" fill="url(#${id}-collar)" opacity=".85"/>
      <rect x="${-cwB - 4.5}" y="-17" width=".7" height="34" fill="rgba(0,0,0,.35)"/>
      <rect x="${-cwB + 3.8}" y="-17" width=".7" height="34" fill="rgba(0,0,0,.35)"/>
      <rect x="${-cwB - 18.5}" y="-15" width="3" height="30" rx="1.4" fill="#2a2927"/>
      <!-- gimbal: yoke ring + cap with screw -->
      <circle r="10" fill="url(#${id}-cw)"/>
      <circle r="10" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".5"/>
      <circle r="6.6" fill="url(#${id}-cap)" stroke="rgba(0,0,0,.25)" stroke-width=".4"/>
      <circle r="1.9" fill="#77746e"/><line x1="-1.4" y1="0" x2="1.4" y2="0" stroke="#3a3936" stroke-width=".5"/>
      <!-- tube Ø9 with a long specular line -->
      <rect x="8" y="-4.5" width="${L - 47}" height="9" rx="4.5" fill="url(#${id}-tube)"/>
      <rect x="11" y="-2.7" width="${L - 54}" height=".8" rx=".4" fill="url(#${id}-spec)"/>
      <!-- collar where the headshell plugs in -->
      <rect x="${L - 41}" y="-5.6" width="8" height="11.2" rx="1.2" fill="url(#${id}-collar)"/>
      <rect x="${L - 37.5}" y="-5.6" width=".6" height="11.2" fill="rgba(0,0,0,.3)"/>
      <!-- headshell at its offset angle: aluminium plate, finger lift, cartridge, screws, stylus -->
      <g transform="translate(${L - 36} 0) rotate(20)">
        <path d="M2 -6.5 L38 -9 Q45 -9.4 45.6 -3.5 L45.6 4.6 Q45 10 38.5 9.6 L2 7 Q-1 6.6 -1 3.4 L-1 -3.2 Q-1 -6.2 2 -6.5 Z" fill="url(#${id}-shell)"/>
        <path d="M2 -6.5 L38 -9 Q45 -9.4 45.6 -3.5" fill="none" stroke="rgba(255,255,255,.7)" stroke-width=".45"/>
        <path d="M38.5 9.6 L2 7" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".5"/>
        <path d="M21 8.4 C22 15, 23.5 19.8, 30.5 21.2" fill="none" stroke="#c9c7c1" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M21 8.4 C22 15, 23.5 19.8, 30.5 21.2" fill="none" stroke="rgba(255,255,255,.65)" stroke-width=".6" stroke-linecap="round" transform="translate(-.4 -.5)"/>
        <rect x="15" y="-6.2" width="22" height="12.6" rx="1.6" fill="url(#${id}-cart)"/>
        <rect x="16.2" y="-5.2" width="19.6" height="1.1" rx=".5" fill="rgba(255,255,255,.14)"/>
        <rect x="31" y="-5.4" width="3.4" height="11" rx=".8" fill="#b4232a" opacity=".85"/>
        <circle cx="19.5" cy="-7.6" r="1.25" fill="url(#${id}-cap)"/><circle cx="32.5" cy="-8.4" r="1.25" fill="url(#${id}-cap)"/>
        <path d="M37 -.6 L41.5 -.2 L41.5 .6 L37 1 Z" fill="#d9d7d1"/>
      </g>
    </g>
  </g>`;
}
function armShadowSVG() {
  const P = MM.pivot, L = MM.armLen, cwB = MM.counterweightBack;
  return `
  <defs><filter id="armblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur class="arm-blur" stdDeviation="1.6"/></filter></defs>
  <g filter="url(#armblur)" fill="#000">
    <circle cx="${P.x}" cy="${P.y}" r="15"/>
    <g class="arm-rot" style="transform-origin:${P.x}px ${P.y}px">
      <g transform="translate(${P.x} ${P.y})">
        <rect x="${-cwB - 17}" y="-19" width="34" height="38" rx="5"/>
        <rect x="-10" y="-4.5" width="${L - 22}" height="9" rx="4.5"/>
        <g transform="translate(${L - 36} 0) rotate(20)"><path d="M-4 -9 L40 -8 Q44 -8 44 -4 L44 6 Q44 9 40 9 L-4 9 Z"/></g>
      </g>
    </g>
  </g>`;
}

/**
 * Build a deck.
 * @param {HTMLElement} host  element to build into (it gets sized)
 * @param {object} o  { widthPx, cover, trackFractions, playing, stylusRadiusMm }
 */
function buildDeck(host, o) {
  const L = LAYOUT[o.layout in LAYOUT ? o.layout : "landscape"];
  MM.plinth.w = L.plinth.w; MM.plinth.h = L.plinth.h;
  MM.spindle = { ...L.spindle }; MM.pivot = { ...L.pivot }; ARM_REST_DEG = L.armRest;
  const ARM_REST = armRest();
  const k = o.widthPx / MM.plinth.w;          // px per mm
  const px = mm => (mm * k).toFixed(2) + "px";
  const S = MM.spindle;
  host.classList.remove(...[...host.classList].filter(c => c.startsWith("finish-")));
  host.classList.add("deck", "finish-" + (o.finish || "graphite"));
  host.classList.toggle("is-playing", !!o.playing);
  host.style.width = px(MM.plinth.w); host.style.height = px(MM.plinth.h);
  host.style.setProperty("--k", k);

  const box = (c, w, h) => `left:${px(c.x - w / 2)};top:${px(c.y - h / 2)};width:${px(w)};height:${px(h)}`;
  const disc = (r, cls) => `<div class="${cls}" style="left:${px(S.x - r)};top:${px(S.y - r)};width:${px(2 * r)};height:${px(2 * r)}"></div>`;

  host.innerHTML = `
    <div class="plinth" style="border-radius:${px(MM.plinth.r)}"></div>
    ${disc(MM.well, "well")}
    ${disc(MM.platter, "platter")}
    ${disc(MM.mat, "mat")}
    <div class="knob" data-act="play" data-tip="${o.playing ? "Pause" : "Play"}" style="${box(L.play, 24, 24)}"></div>
    <div class="knob small" data-act="volume" data-tip="Volume" style="${box(L.volume, 16, 16)}"></div>
    <div class="led ${o.playing ? "on" : ""}" style="${box(L.led, 3, 3)}"></div>
    <div class="engrave" style="${L.engrave.anchor === "left" ? `left:${px(L.engrave.x)};top:${px(L.engrave.y)}` : `left:${px(L.engrave.x - 12)};width:${px(24)};text-align:center;top:${px(L.engrave.y)}`}; font-size:${px(6.2)}">33⅓</div>
    <div class="cue" data-act="cue" data-tip="${o.playing ? "Lift arm" : "Lower arm"}" style="${box(L.cue, L.cue.w, L.cue.h)}"></div>
    <div class="rest" style="left:${px(MM.pivot.x + Math.cos(ARM_REST) * 168 - 9)};top:${px(MM.pivot.y + Math.sin(ARM_REST) * 168 - 6)};width:${px(18)};height:${px(12)}${o.layout === "portrait" ? ";transform:rotate(90deg)" : ""}"></div>
    <div class="record-shadow" style="left:${px(S.x - MM.record)};top:${px(S.y - MM.record)};width:${px(2 * MM.record)};height:${px(2 * MM.record)}"></div>
    <div class="spin ${o.playing ? "playing" : ""}" style="left:${px(S.x - MM.record)};top:${px(S.y - MM.record)};width:${px(2 * MM.record)};height:${px(2 * MM.record)}">
      <canvas class="vinyl"></canvas>
      <div class="label" style="width:${px(2 * MM.label)};height:${px(2 * MM.label)}">
        <img src="${o.cover}" alt="">
        <span class="hole" style="width:${px(2 * MM.hole)};height:${px(2 * MM.hole)}"></span>
      </div>
    </div>
    <div class="sheen" style="left:${px(S.x - MM.record)};top:${px(S.y - MM.record)};width:${px(2 * MM.record)};height:${px(2 * MM.record)}"></div>
    <div class="spindle" style="left:${px(S.x - 2.6)};top:${px(S.y - 2.6)};width:${px(5.2)};height:${px(5.2)}"></div>
    <svg class="arm-shadow" viewBox="0 0 ${MM.plinth.w} ${MM.plinth.h}">${armShadowSVG()}</svg>
    <svg class="arm" viewBox="0 0 ${MM.plinth.w} ${MM.plinth.h}">${armSVG("a")}</svg>
  `;
  drawRecord(host.querySelector(".vinyl"), 2 * MM.record * k, o.trackFractions || [], o.vinyl);

  const ang = o.stylusRadiusMm ? armAngleFor(o.stylusRadiusMm) : ARM_REST;
  host.querySelectorAll(".arm-rot").forEach(g => (g.style.transform = `rotate(${ang}rad)`));
  host.classList.toggle("needle-down", !!o.stylusRadiusMm);
  return { k, setArm: r => host.querySelectorAll(".arm-rot").forEach(g => (g.style.transform = `rotate(${r ? armAngleFor(r) : ARM_REST}rad)`)) };
}

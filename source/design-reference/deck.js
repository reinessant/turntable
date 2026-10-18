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
const ARM_REST = (99 * Math.PI) / 180;   // parked, pointing down the right side of the plinth

/** Render the vinyl surface once to a canvas (grooves, track bands, dust). */
function drawRecord(canvas, sizePx, trackFractions) {
  const dpr = Math.min(2, window.devicePixelRatio || 1) * 1.5;
  canvas.width = canvas.height = Math.round(sizePx * dpr);
  canvas.style.width = canvas.style.height = sizePx + "px";
  const c = canvas.getContext("2d");
  const R = canvas.width / 2, k = R / MM.record;
  c.translate(R, R);

  // base — never pure black
  c.fillStyle = "#131316"; c.beginPath(); c.arc(0, 0, R, 0, 7); c.fill();

  // outer rim bevel
  c.strokeStyle = "rgba(255,255,255,.10)"; c.lineWidth = 1.2 * k;
  c.beginPath(); c.arc(0, 0, R - 0.6 * k, 0, 7); c.stroke();

  // grooves: fine rings with slightly random intensity (real pressing variation)
  const bands = trackFractions;  // cumulative fractions of the album, e.g. [0.1, 0.23, ...]
  const rOut = MM.grooveOuter * k, rIn = MM.grooveInner * k, step = 0.42 * k;
  for (let r = rOut; r > rIn; r -= step) {
    const f = (rOut - r) / (rOut - rIn);                 // 0 at outer edge → 1 at inner
    const inGap = bands.some(b => Math.abs(f - b) < 0.0085);
    if (inGap) continue;                                  // smooth gap between tracks
    const a = 0.028 + Math.random() * 0.03;
    c.strokeStyle = `rgba(255,255,255,${a})`; c.lineWidth = 0.5;
    c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke();
  }
  // gaps between tracks — a touch lighter, smooth, reads as the "bands" of a real LP
  for (const b of bands) {
    const r = rOut - b * (rOut - rIn);
    c.strokeStyle = "rgba(255,255,255,.045)"; c.lineWidth = 1.4 * k;
    c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke();
  }
  // lead-in and run-out are smooth and slightly glossier
  c.strokeStyle = "rgba(255,255,255,.035)"; c.lineWidth = 3 * k;
  c.beginPath(); c.arc(0, 0, (MM.grooveOuter + 2) * k, 0, 7); c.stroke();
  c.lineWidth = 8 * k; c.beginPath(); c.arc(0, 0, (MM.grooveInner - 5) * k, 0, 7); c.stroke();

  // dust + a few hairline scratches — these are what make ROTATION visible
  for (let i = 0; i < 70; i++) {
    const ang = Math.random() * 6.283, rr = (MM.label + 6 + Math.random() * 88) * k;
    c.fillStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.18})`;
    c.beginPath(); c.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, (0.12 + Math.random() * 0.25) * k, 0, 7); c.fill();
  }
  for (let i = 0; i < 5; i++) {
    const ang = Math.random() * 6.283, rr = (70 + Math.random() * 70) * k, span = 0.15 + Math.random() * 0.4;
    c.strokeStyle = "rgba(255,255,255,.06)"; c.lineWidth = 0.6;
    c.beginPath(); c.arc(0, 0, rr, ang, ang + span); c.stroke();
  }
}

/** The tonearm as one SVG in plinth millimetre space. */
function armSVG(id) {
  const P = MM.pivot, L = MM.armLen, cwB = MM.counterweightBack;
  return `
  <defs>
    <linearGradient id="${id}-tube" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6d6c6a"/><stop offset=".28" stop-color="#f4f3f0"/>
      <stop offset=".55" stop-color="#b9b7b2"/><stop offset="1" stop-color="#5f5e5b"/>
    </linearGradient>
    <linearGradient id="${id}-cw" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a4947"/><stop offset=".3" stop-color="#d9d7d2"/>
      <stop offset=".6" stop-color="#8e8c88"/><stop offset="1" stop-color="#3b3a38"/>
    </linearGradient>
    <radialGradient id="${id}-base" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#d8d5cf"/><stop offset="1" stop-color="#9c9993"/>
    </radialGradient>
    <linearGradient id="${id}-head" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3a3d"/><stop offset=".35" stop-color="#55555a"/><stop offset="1" stop-color="#1c1c1e"/>
    </linearGradient>
  </defs>
  <!-- bearing housing (does not rotate) -->
  <circle cx="${P.x}" cy="${P.y}" r="15" fill="url(#${id}-base)"/>
  <circle cx="${P.x}" cy="${P.y}" r="15" fill="none" stroke="rgba(0,0,0,.18)" stroke-width=".6"/>
  <circle cx="${P.x}" cy="${P.y}" r="9.5" fill="none" stroke="rgba(0,0,0,.12)" stroke-width=".5"/>
  <!-- rotating arm, drawn along +x from the pivot -->
  <g class="arm-rot" style="transform-origin:${P.x}px ${P.y}px">
    <g transform="translate(${P.x} ${P.y})">
      <!-- counterweight, on-axis behind the pivot -->
      <rect x="${-cwB - 17}" y="-19" width="34" height="38" rx="5" fill="url(#${id}-cw)"/>
      ${[...Array(9)].map((_, i) => `<line x1="${-cwB - 13 + i * 3.2}" y1="-19" x2="${-cwB - 13 + i * 3.2}" y2="-15.5" stroke="rgba(0,0,0,.28)" stroke-width=".5"/>`).join("")}
      <rect x="${-cwB + 17}" y="-4" width="${cwB - 20}" height="8" fill="url(#${id}-tube)"/>
      <!-- gimbal cap -->
      <circle r="8.5" fill="url(#${id}-base)" stroke="rgba(0,0,0,.2)" stroke-width=".5"/>
      <circle r="2.2" fill="#8e8b85"/>
      <!-- tube Ø9 -->
      <rect x="6" y="-4.5" width="${L - 38}" height="9" rx="4.5" fill="url(#${id}-tube)"/>
      <!-- headshell: slim, offset angle, finger lift -->
      <g transform="translate(${L - 36} 0) rotate(20)">
        <rect x="-4" y="-5.5" width="12" height="11" rx="2" fill="url(#${id}-tube)"/>
        <path d="M6 -9 L40 -8 Q44 -8 44 -4 L44 6 Q44 9 40 9 L6 9 Z" fill="url(#${id}-head)"/>
        <path d="M20 9 L22 21 Q22.5 23 24.5 23 L27 23" fill="none" stroke="#2a2a2c" stroke-width="2.2" stroke-linecap="round"/>
        <rect x="14" y="-6.5" width="22" height="12.5" rx="1.5" fill="#101012"/>
        <line x1="8" y1="-8.2" x2="40" y2="-7.4" stroke="rgba(255,255,255,.18)" stroke-width=".6"/>
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
  const k = o.widthPx / MM.plinth.w;          // px per mm
  const px = mm => (mm * k).toFixed(2) + "px";
  const S = MM.spindle;
  host.classList.add("deck", "finish-" + (o.finish || "graphite"));
  host.classList.toggle("is-playing", !!o.playing);
  host.style.width = px(MM.plinth.w); host.style.height = px(MM.plinth.h);
  host.style.setProperty("--k", k);

  const disc = (r, cls) => `<div class="${cls}" style="left:${px(S.x - r)};top:${px(S.y - r)};width:${px(2 * r)};height:${px(2 * r)}"></div>`;

  host.innerHTML = `
    <div class="plinth" style="border-radius:${px(MM.plinth.r)}"></div>
    ${disc(MM.well, "well")}
    ${disc(MM.platter, "platter")}
    ${disc(MM.mat, "mat")}
    <div class="knob" data-act="play" data-tip="${o.playing ? "Pause" : "Play"}" style="left:${px(418)};top:${px(318)};width:${px(24)};height:${px(24)}"></div>
    <div class="knob small" data-act="volume" data-tip="Volume — drag" style="left:${px(456)};top:${px(322)};width:${px(16)};height:${px(16)}"></div>
    <div class="led ${o.playing ? "on" : ""}" style="left:${px(486)};top:${px(328.5)};width:${px(3)};height:${px(3)}"></div>
    <div class="engrave" style="left:${px(496)};top:${px(326.5)}; font-size:${px(6.2)}">33⅓</div>
    <div class="cue" data-act="cue" data-tip="${o.playing ? "Lift arm" : "Lower arm"}" style="left:${px(MM.pivot.x + 24)};top:${px(MM.pivot.y + 20)};width:${px(24)};height:${px(7)}"></div>
    <div class="rest" style="left:${px(MM.pivot.x + Math.cos(ARM_REST) * 168 - 9)};top:${px(MM.pivot.y + Math.sin(ARM_REST) * 168 - 6)};width:${px(18)};height:${px(12)}"></div>
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
  drawRecord(host.querySelector(".vinyl"), 2 * MM.record * k, o.trackFractions || []);

  const ang = o.stylusRadiusMm ? armAngleFor(o.stylusRadiusMm) : ARM_REST;
  host.querySelectorAll(".arm-rot").forEach(g => (g.style.transform = `rotate(${ang}rad)`));
  host.classList.toggle("needle-down", !!o.stylusRadiusMm);
  return { k, setArm: r => host.querySelectorAll(".arm-rot").forEach(g => (g.style.transform = `rotate(${r ? armAngleFor(r) : ARM_REST}rad)`)) };
}

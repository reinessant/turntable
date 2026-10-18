# Design Specification — Port This Exactly

This folder is a **working visual reference** of the three screens: open
`player.html`, `crate.html` and `import.html` in a browser. They are real,
interactive HTML/CSS/JS — scroll the track ring, click play/pause, flip the
crate with the wheel. Rendered screenshots are in `screens/`.

**Your job is to port this design into the app exactly.** Do not reinterpret
it, do not "improve" it, do not substitute your own values. Every colour,
size, spacing, radius, shadow, font and easing is in these files. Copy the CSS
values literally; copy the drawing code in `deck.js` (it is framework-free and
drops into a React component as-is, or can be translated line by line).

Where this document or the reference files conflict with FIX_ROUND_3.md, **the
reference wins** for anything visual. FIX_ROUND_3.md still governs audio (§4),
the removal of three.js (§1), transitions (§6) and motion rules (§8).

---

## 0. What the owner asked for, and how the design answers it

| Request | Answer in the reference |
|---|---|
| "Strict and realistic, not cartoonish, not vanilla" | Graphite powder-coat plinth with a diamond-cut chamfer, machined aluminium platter and knobs, a tiny cold-white LED. No cream, no orange, no rounded toy shapes. An aluminium finish is available as the alternative (`?finish=alu`). |
| "Should feel expensive, like modern strict sites" | Blurred-cover backdrop, glass capsule, layered shadows, grain, one display face, a strict spacing scale, almost no chrome. |
| "More glow" | The cover's colour lights the room: blurred cover + a coloured glow behind the deck/sleeve. |
| "Track names as little records on top that rotate on the wheel, like around a pole" | The track ring: records orbit a vertical axis; wheel turns the ring with spring physics. |
| "The disc keeps spinning when paused" | Bug. Pausing must stop the platter (tape-stop, see FIX_ROUND_3 §4.2). In the reference, `.is-playing` is the only thing that spins it. |
| "A cooler font" | Mona Sans Expanded for display text, Geist for UI, Geist Mono for numbers. |

---

## 1. Files

| File | Contains |
|---|---|
| `tokens.css` | **All design tokens**: spacing scale, page frame, radii, ink levels, glass, type scale, easing, shadows, fonts. Backdrop / glow / grain. Pill and icon buttons. The 1920×1080 artboard fit. |
| `deck.js` | The turntable: real millimetre geometry, record renderer (grooves, track gaps, dust), tonearm SVG, arm-angle solver. |
| `deck.css` | Deck materials: graphite and aluminium finishes, chamfer, well, platter, strobe ring, record, fixed sheen, arm shadow, knobs, LED. |
| `player.html` | Player layout, track ring, tracklist, lyrics, transport capsule. |
| `crate.html` | Crate: sleeve stack with flip physics, peeking record, caption, preview footer. |
| `import.html` | Import screen. |
| `icons.js` | Phosphor Icons (light weight + 3 fill), inlined. Bundle `@phosphor-icons/core` in the app instead. |
| `fonts/` | Geist, Geist Mono, Mona Sans (woff2). Bundle these; no CDN. |
| `fonts-compare.html`, `fonts/candidates/` | The six fonts that were compared. Mona Sans (B) was chosen. |
| `screens/` | Screenshots of the target. Compare your build against these side by side. |

---

## 2. The artboard

- Every screen is laid out on a **fixed 1920 × 1080 artboard**, scaled
  uniformly to the window: `s = min(w / 1920, h / 1080)`, centred.
- Backdrop and grain are full-bleed, outside the artboard.
- Tauri window: default 1920×1080 (or maximised), **minimum 1600×900**.
- All px values in this document are artboard px.

---

## 3. Tokens (summary — `tokens.css` is authoritative)

**Spacing** — only these: `4 8 12 16 24 32 48 64 96 128`.

**Page frame**

| | px |
|---|---|
| Side margin | 64 |
| Header top | 44 (header row is 32 tall) |
| Bottom margin under capsule | 40 |

**Radii** — 6 · 10 · 14 · pill.

**Ink** — one colour at six strengths: 94% · 64% · 42% · 24% · 12% (hairline) · 6% (hover). On dark rooms ink is `rgb(243,241,236)`; on light rooms `rgb(20,20,20)`. Never pure black or white.

**Type**

| Role | Font | Size / weight | Tracking | Stretch |
|---|---|---|---|---|
| Display (album title) | Mona Sans | 46 / 700, lh 1.0 | −0.045em | 115% |
| Title (screen name) | Mona Sans | 30 / 650 | −0.035em | 112% |
| Active lyric | Mona Sans | 30 / 600, lh 1.2 | −0.03em | 106% |
| Lyric | Geist | 22 / 500, lh 1.3 | −0.01em | — |
| Body large | Geist | 16 / 450 | 0 | — |
| Body | Geist | 14 / 450 | 0 | — |
| Small | Geist | 13 / 400 | 0 | — |
| Micro label | Geist | 11 / 500, uppercase | +0.14em | — |
| Numbers | Geist Mono | 12 / 400, tabular | 0 | — |

Mona Sans has no Cyrillic; Cyrillic falls back to Geist automatically via the
font stack. Keep it.

**Easing** — arrivals `cubic-bezier(.22,1,.36,1)`, departures
`cubic-bezier(.64,0,.78,0)`, moves `cubic-bezier(.65,0,.35,1)`. Durations
140 / 260 / 520 ms.

**Shadows** — objects never get one shadow. Use `--shadow-object` (deck) and
`--shadow-card` (sleeves, cover card), which stack 3–5 layers.

---

## 4. Backdrop (every screen)

Bottom to top: base colour → **blurred cover** (150% size, blur 120px,
saturate 1.2, brightness .85) → **tone** `rgba(10,10,14,.56)` → **glow**
(radial, 1100×800, the cover's key colour, screen blend, behind the object) →
**vignette** → UI → **grain** (7% overlay, SVG turbulence).

In the app, pre-render the blur once per album to a small canvas and upscale
it; do not run a 120px CSS blur live. The glow colour is the cover's dominant
saturated hue (compute once at import).

**Light room (Revision 2 — mandatory).** If the cover's mean luminance is
> 0.62, use `body.room-light` from `tokens.css`: pale base, cover blur at 55%
opacity, a light tone, a white glow, dark ink, frosted-white glass, multiply
grain. See `screens/player-light.png`. A light / black-and-white cover must
never be darkened into grey.

**Glow colour rule.** If the cover is nearly achromatic (mean OKLCH chroma
< 0.05), the glow is neutral (white). Never invent a hue from noise — the first
build turned a black-and-white cover's room green.

---

## 5. Player (`player.html`)

```
y 44–76     header: [‹ Crate] ................................ [✎ Edit album]
y 96–196    track ring (records orbiting an axis), centred on x 960
y 214       caption under the ring: "03  Sloppy Joe"
y 379–751   DECK, centred at (960-ish, 565). Everything else aligns to it:
            · album title top = plinth top (left column starts y 372)
            · active lyric line centre = deck centre (y 565)
            · cover card centre = deck centre
y 516–948   tracklist (scrolls if long; ends 32 px above the capsule)
y 980–1040  transport capsule (w 720, centred)
```
**Revision 2 — composition.** The first version sat ~60 px low: the deck
centre was at y ≈ 600 and long tracklists ran under the capsule. The deck
centre is now y 565 and the two side columns are aligned to the deck, not to
the header. Nothing may overlap the capsule.

### 5.1 Header
Two glass pills, 32 tall, radius pill, 13/500 text, 14 px icon, padding
`0 14 0 10`. Left `‹ Crate`, right `✎ Edit album`.

### 5.2 Track ring — "records around a pole"
- One small record per track. Base size **100 px** = the size of the current
  one; others scale **down** to 76% (never upscale — it blurs).
- Records sit on a ring of **radius 340 px**, **30°** apart, around a vertical
  axis at x 960. Position of each: `θ = (i − ringPos) × 25°`;
  `x = sin θ × 300`, `z = (cos θ − 1) × 300`; perspective scale
  `900 / (900 − z)`; the record turns edge-on with `scaleX(cos(θ × 0.85))`.
- **Project it manually in 2D** (as in the reference). Do not use CSS
  `preserve-3d` for this: it clips shadows and rasterises blurry.
- Visible only within **±80°**, fading out from 55° to 80°; hidden beyond. The
  edge-on squeeze is `max(0.35, cos(θ × 0.6))` — records never become slivers.
  Each record's shadow opacity = its squeeze factor. (Revision 2: the first
  version bunched records together and showed thin slivers near the ends of
  the album.) Side records darken via an overlay (`(1 − cosθ) × .55`), not a
  CSS filter.
- A faint front arc (the orbit) under the ring, 1 px, gradient to transparent
  at both ends.
- `ringPos` is **one float** damped to the target with a critically damped
  spring (ω = 11). Wheel: every 50 units of delta = one track. The deck's arm
  travels to the chosen track **450 ms after the ring settles** (clicking a
  record commits immediately).
- The current record: 1 px ring at 6 px offset (ink 24%), spins at 33⅓ when
  playing, stops when paused. Its label is the album cover.
- Each record: grooved vinyl, a fixed sheen that does not rotate, a label at
  36% of its diameter, a 3 px spindle hole, and its own soft shadow element
  (not a box-shadow).
- Caption under the ring: mono number (ink 24%) + title (Body, ink 64%),
  crossfading on change.

### 5.3 Left column
- Display title, then artist (Body large, 64%) 10 below, then mono meta line
  (year · tracks · total) 12 below.
- Tracklist 32 below, **max-height 432 px, scrolls**, bottom 14% faded, the
  current row kept in view. Titles are split: the main title at 64%, and a
  trailing credit (`prod …`, `ft …`, `feat …`, `with …`) in ink 24% after
  6 px; a leading "Artist - " equal to the album artist is dropped.
  Rows **36 px**, radius 8, padding 0 12, grid
  `28px 1fr auto`, gap 10. Index mono 24%, title Body 64%, duration mono 24%.
- Hover: background ink 6%. Current row: background ink 6%, title 100% weight
  550, and the index is replaced by a **10 px record glyph**.
- No divider lines. No thick left bar.

### 5.4 Stage
- Cover card **196 px** square, straight (no rotation), `--shadow-card`, 1 px
  inner top highlight. Gap **40 px** to the deck.
- Deck **590 px wide** (plinth 590 × 372 mm at 1 px/mm). Card + gap + deck is
  centred horizontally on x 960 and sits at ~52% of the stage height.
- The deck tilts `rotateX(5deg)` in a `perspective: 2400px` container, and
  follows the cursor by up to ±2.5° (900 ms ease). The record sheen angle
  follows the cursor ±8°. That is the only "3D".

### 5.5 Lyrics
- Column right-aligned at x 1456–1856 (w 400), top 315, height 500, masked to
  fade at top (0–22%) and bottom (74–100%).
- Active line: Mona Sans 30/600, 100% ink, its centre at **50%** of the column
  = the deck's centre line (y 565). Other lines Geist 22/500.
- Falloff by distance from active: opacity 1 · .46 · .28 · .16 · .09 · .05,
  blur 0 · 0 · 0 · .6 · 1.2 · 1.6 px.
- 20 px between lines. No hanging indent. Scroll 700 ms ease-out.

### 5.6 Transport capsule
- 720 × 60, pill, glass (`--glass-*` tokens), bottom 40, centred.
- Left→right: prev (36 px icon button) · **play/pause 40 px solid circle**
  (ink background, inverse icon, 18 px fill icon) · next · elapsed (mono, w 44) ·
  progress (flex, 3 px track at ink 12%, fill at 94%, 11 px thumb on hover
  only) · total · 1 px separator · heart · speaker.

---

## 6. The deck (`deck.js`, `deck.css`)

- Geometry is in **millimetres** and scaled by a single factor. Key values:
  plinth 590 × 372 r9 · spindle (196, 186) · well r160 · platter r156 · mat r153 ·
  record r151 · label r50 · hole r3.62 · grooves 146 → 62 · pivot (478, 82) ·
  arm length 238 · counterweight 46 behind pivot.
- The arm angle for any stylus radius comes from `armAngleFor(r)` (circle
  intersection). Stylus radius from album progress:
  `r = 146 − progress × (146 − 62)`, where progress is across the **whole
  album**, so each track sits in its own band.
- Parked arm: 99°. Needle down: arm shadow offset (2.5, 3.5) mm, opacity .42.
  Lifted: (7, 9) mm, opacity .30. Animate between them — that is the "lift".
- The record surface is rendered **once** to a canvas: fine grooves with
  random intensity, lighter smooth gaps between tracks at the cumulative
  duration fractions, smooth lead-in and run-out, dust and a few hairline
  scratches (these make rotation visible). The canvas rotates; the **sheen
  overlay does not**.
- Platter rim: brushed conic gradient + a printed strobe-dot ring; rotates with
  the record.
- Controls: two machined knobs, one 3 mm LED (cold white when playing, off
  otherwise), engraved "33⅓", a slim cue lever, a dark arm-rest post. Nothing
  else on the plinth.
- **Finish:** graphite is the default. Aluminium is the alternative. Both use
  the same chamfer variables. Offer the choice in settings later; ship
  graphite.

**Rotation state:** the platter spins only while playing. In the app, platter
angular speed is a damped value driven by the audio engine — it decelerates
with the tape-stop (700 ms) and accelerates with the tape-start (350 ms). It
must be exactly 0 when paused or stopped.

---

## 7. Crate (`crate.html`)

```
y 44–76     header: "Crate" (Title) + mono count ....... [Sort pill] [search] [+ Import solid]
            sleeve stack centred at (960, 486); focused sleeve 460 × 460
y 752       caption: Display title, then artist + mono meta, left-aligned to the sleeve
y 1008–1040 footer: [speaker] [eq bars] Previewing · Track ... SCROLL TO FLIP · ENTER TO PLAY ... 03 / 12
```

- **Flip model:** one float `pos` damped toward an integer (spring ω = 13).
  Each sleeve's pose derives only from `d = i − pos`:
  - behind (`d ≥ 0`): `translateY(−36·d)`, `scale(1 − .045·d)`, dim `.13·d`
    (max .75), up to 8 visible — their tops form the visible stack.
  - flipping past (`−1 < d < 0`): falls forward around its bottom edge,
    `scaleY(cos(ease × 1.3))`, darkening to .7 and fading out.
- Sleeve: 3 px radius, `--shadow-card`, 1 px top highlight, faint corner wear,
  light diagonal sheen.
- **Peeking record:** 430 px, behind the focused sleeve, slides out 150 px to
  the right 520 ms after the sleeve settles (640 ms ease-out), turning slowly.
  Slides back in when flipping.
- **Room colour:** on focus change the blurred backdrop crossfades to the new
  cover (260 ms out, 520 ms in) and the glow takes its colour.
- Caption crossfades: out 180 ms moving up 6 px, in moving from +6 px.

---

## 8. Import (`import.html`)

- Content block **1200 px**, centred; grid `360px 1fr`, gap 64; starts at y 132.
- Display title "New album" + Body-large note ("12 files dropped", ink 42%).
- Left: cover 360 × 360, radius 14, `--shadow-card`, a glass "Replace" pill
  at bottom-left 12 px in. Under it: "Applied to all N tracks" (Small, 42%),
  then two pills stacked: "Paste track titles", "Add more files".
- Right: three fields in a grid `1fr 1fr 140px`, gap 32. Micro label, 10 px,
  then value at 20/500 with a 1 px bottom rule (ink 12%, 42% when focused).
  No boxes.
- Tracks header: micro "TRACKS" + a micro hint on the right, 1 px rule under,
  48 px above.
- Rows 48 px, radius 10, grid `24 32 1fr auto 36`: drag handle (Phosphor
  dots-six-vertical, 24%), mono index, title (Body large) with the source
  filename after it in Small 24%, mono duration, a remove × that appears on
  hover. Editing: underline at 42% and a caret.
- Drop zone under the list: 56 px, radius 10, 1 px dashed at 24%, icon + text.
- Header: "× Cancel" glass pill left; right a Small status ("12 tracks · 29:52 ·
  ready") and "✓ Save album" solid pill.
- The backdrop is the dropped cover's blur, with a darker tone (.62).

---

## 9. Checks before you show me anything

1. Put your screenshot and the matching file from `screens/` side by side at
   the same size. List every visible difference. Fix them.
2. Measure: header at y 44, capsule bottom at 40 px, side margins 64, deck
   width 590, card 196, gap 40. Report the measured values.
3. Greyscale your screenshot: the deck must read as a real object with a lit
   top edge and a grounded shadow.
4. Pause playback: the platter and the current record in the ring must both
   stop. Confirm.
5. Scroll the ring quickly back and forth: nothing jumps, nothing clips, no
   square artefacts around records.
6. No pure black/white, no orange, no rotated cover card, no divider lines in
   the tracklist, no text glyph icons.


---

## REVISION 3 — composition, centring, clickable deck (overrides §5.1–5.4 where they differ)

Feedback: "too much empty space at the top — pull the content up" and "things
don't look centred". Both were true in the reference. Fixed as follows; see
`screens/player-graphite.png`, `screens/player-light.png`, `screens/crate.png`.

**Player**
- The **deck stands alone, centred on the screen axis (x 960)**. The cover card
  beside it is removed — it made the deck+card group look right-heavy.
- Deck width **680 px**, centre at **y 545** (top ≈ 331, bottom ≈ 759).
  Content now starts ~100 px under the ring caption instead of ~150.
- The album cover moves into the **left column, above the title**: 120 × 120,
  radius 3, `--shadow-card`, 24 px gap to the title. Left column top = plinth
  top (y 330).
- Tracklist: 28 px under the meta line, max-height 344, scrolls, fades at top
  (0–6%) and bottom (86–100%), `position: relative` so the current row can be
  scrolled into view correctly.
- Lyrics column: top 345, height 400, active line centred at 50% = y 545 = the
  deck's centre line.
- Glow centred on the deck (50% / 50%).
- In the transitions, target **B** (cover) is now the album cover in the left
  column. The record travels from it to the platter — a longer, calmer glide.

**Crate**
- The focused sleeve **and its peeking record are centred together**: the
  crate is shifted 64 px left (`left: calc(50% - 64px)`), the caption with it.

**Clickable deck controls** (`deck.js` data-act, `deck.css` bottom)
- Large knob = **Play / Pause** (same as the capsule button).
- Small knob = **Volume** — drag vertically to turn; it rotates with the value.
- Cue lever = **Lift / lower arm** (pause/resume with the arm, no tape-stop).
- Tonearm headshell = drag to seek (PLAYER_DYNAMICS_SPEC §2.1).
- Every control: pointer cursor, hover = brightness 1.12 + a faint 3 px ring,
  press = scale .93 (physically pressed) + a click sound, and a micro tooltip
  above it (11 px uppercase on a dark 85% pill). See
  `screens/deck-control-hover.png`.

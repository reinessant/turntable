# Crate → Player Transition — How to Build It So It Doesn't Glitch

The owner reports the transition into an album is "very buggy". The timeline
itself is in FIX_ROUND_3 §6.3–6.4 and is fine. What goes wrong in practice is
almost always the **architecture**: screens unmounting mid-animation, elements
measured before they exist, React re-rendering in the middle of a tween, or
the artboard scale being ignored. Rebuild the transition on the structure
below. Do not patch the current one.

---

## 1. The ten causes of a glitchy transition — check each one

| # | Cause | Symptom | Rule |
|---|---|---|---|
| 1 | The crate unmounts the moment the player mounts | Things vanish or jump on the first frame | **Both screens stay mounted for the whole transition.** Switch the route/state only in `onComplete`. |
| 2 | Measuring the destination before it has laid out | The sleeve flies to (0,0) or the wrong spot | Mount the player **hidden** (`visibility: hidden`, not `display: none`) *first*, wait two animation frames, then measure. |
| 3 | Animating the real elements across screens | Clipping by `overflow`, wrong stacking, parent transforms fighting | Animate **clones** in a dedicated **flight layer**; hide the originals meanwhile. |
| 4 | Ignoring the artboard scale (`--fit`) | Off by a factor at any window size other than 1920×1080 | The flight layer lives **outside** the scaled artboard, in window pixels. Use `getBoundingClientRect()` for every start/end rect — it already includes the scale and the deck tilt. |
| 5 | React state changes during the tween | Stutters, restarts, elements snapping | **No `setState` while the timeline runs.** Everything is driven by one GSAP timeline on refs. State changes happen before start and in `onComplete` only. |
| 6 | React StrictMode double-running effects in dev | Two timelines at once, "double" motion | Create the timeline in an effect that **kills it in cleanup** (`return () => tl.kill()`), and guard with a ref so a second call is ignored. |
| 7 | Images not decoded yet | The cover or label pops in mid-flight | Before starting: `await img.decode()` for the cover and label, and draw the record canvas. Only then play. |
| 8 | Animating layout properties (`width`, `height`, `top`, `left`) | Jank, layout thrash | Clones are positioned once at their start rect, then **only `transform` and `opacity`** animate. Scale = end size / start size. |
| 9 | Animating big blurs / backdrop-filters | Frame drops | Never animate `filter: blur()` on anything larger than the UI text blocks. Do not animate the backdrop — it doesn't change (same album). The glass capsule fades in with opacity only. |
| 10 | Input during the transition | Half-run states, double transitions | Set `pointer-events: none` on the whole app and ignore keys until `onComplete`. |

---

## 2. Structure

```
<App>
  <Backdrop/>                 ← full-bleed, unchanged during the transition
  <Artboard scale=--fit>
    <Crate  visible={screen==='crate'  || transitioning}/>
    <Player visible={screen==='player' || transitioning}/>
  </Artboard>
  <FlightLayer/>              ← position: fixed; inset: 0; z-index above both;
                                 pointer-events: none; NOT inside the artboard
</App>
```

## 3. Sequence (crate → player)

**Before the timeline (synchronous preparation):**
1. `transitioning = true`, lock input.
2. Mount the player with the selected album, `visibility: hidden`. Deck arm at
   rest, platter stopped, record hidden (`opacity: 0`) on the platter.
3. Wait **two** `requestAnimationFrame`s.
4. `await` decode of cover image and label image; draw the record canvas.
5. Measure in window px:
   - `A` = crate focused sleeve rect
   - `B` = player cover-card rect
   - `C` = player record rect (on the platter, as rendered with tilt)
6. Create clones in the flight layer:
   - **sleeve clone**: the cover image, placed exactly at `A`
   - **record clone**: a record (vinyl + label), placed at `C`'s size but
     positioned **behind the sleeve clone** at `A`'s centre, hidden inside it
7. Hide the originals: crate focused sleeve (`visibility: hidden`), player
   cover card, player record.

**Timeline (1.5 s) — from FIX_ROUND_3 §6.3, mapped onto the clones:**

| Time | What |
|---|---|
| 0–250 ms | Crate: other sleeves fall away and fade (their own animation, on the real crate), caption and header fade out. |
| 100–700 ms | Sleeve clone: `A → B` on a slight upward arc (animate x and y with different eases, or use a motion path), scale `B.w / A.w`. |
| 300–850 ms | Player becomes `visibility: visible` at `opacity: 0` → 1, deck rising `translateY(16px) → 0`. The UI columns stay at opacity 0. |
| 600–1150 ms | Record clone: slides out of the sleeve clone's right edge (it is **below** the sleeve clone in z-order, so it emerges from inside), then travels on an arc to `C`, scaling to `C`'s size; ends with a 40 ms settle. |
| 950–1500 ms | Player UI: tracklist, lyrics, ring, capsule fade in with 8 px rise, staggered 70 ms. Blur only on these small blocks, max 6 px. |

**`onComplete`:**
1. Show the player's real cover card and real record **in the same frame**
   the clones are removed (set both in one callback — no gap, no double).
2. Remove clones. Set `screen = 'player'`, `transitioning = false`.
3. Unmount or hide the crate. Unlock input.
4. Start the play sequence (FIX_ROUND_3 §4.1).

**Player → crate** is the same mechanism in reverse with the 0.9 s timeline
from FIX_ROUND_3 §6.4: measure `C`, `B`, and the crate's focused-sleeve slot
`A` (crate mounted hidden, positioned on the right album) before starting.

## 4. Tools for tuning

- **Scrub slider** for the master timeline in the debug panel (`tl.progress()`).
- **Slow motion**: a key (e.g. `S`) that sets `gsap.globalTimeline.timeScale(0.2)`.
  Every glitch is obvious at 20% speed.
- An **outline toggle** that draws 1 px outlines on the flight-layer clones
  and on `A`, `B`, `C` — mismatched rects become visible instantly.

## 5. Verification — required

- Record the transition in both directions, **at normal speed and at 20%
  speed**, at 1920×1080 and at 1600×900. Send the recordings.
- At 20% speed there must be: no frame where the cover exists twice, no frame
  where it is missing, no jump at the start or end, nothing passing over text,
  no layout shift in the player when the clones are removed.
- Add row T4 to BUGFIX_CHECKLIST: "Transition verified at 20% speed in both
  directions at two window sizes — no doubles, gaps, jumps or overlaps."

---

## 6. REVISION 3 — slower, calmer timings (replaces the timings above and in FIX_ROUND_3 §6.3–6.4)

The owner likes the transition now but wants it **slower and gentler**: when
you stop, the record should lift off the deck carefully, float, and settle
calmly — "pf" — into its sleeve and back into the crate. This is a ritual,
not a navigation. Keep the architecture; change only timings and curves.

Curves used below:
- `lift`  = `cubic-bezier(0.25, 0.1, 0.25, 1)` — soft start, soft end
- `glide` = `cubic-bezier(0.45, 0, 0.25, 1)` — slow departure, long gentle arrival
- `settle`= `cubic-bezier(0.22, 1, 0.36, 1)` — arrives and rests
- **Never linear. No bounce, no overshoot** except the 1–2 px settles noted.

### Player → Crate (≈ 3.2 s)

| Time (ms) | What happens |
|---|---|
| 0 | Back pressed. Input locked. Tape-stop starts (audio + platter, 700 ms). |
| 0–450 | UI fades out: capsule, lyrics, track ring, tracklist — opacity → 0, 8 px drop, `ease-in`, staggered 60 ms. |
| 150–950 | Tonearm lifts (150 ms, shadow separates), then swings back to its rest, 650 ms, `glide`, and lowers onto the rest. |
| 950–1450 | **Record lifts off the platter**: scale 1.00 → 1.035, its shadow widens and softens (blur ×3, offset ×2, opacity −30%), 500 ms, `lift`. It is now visibly floating above the deck. |
| 1450–1650 | A short **hover**: the record holds, drifting 2 px up, residual rotation decaying to 0. This pause is what makes it feel careful. |
| 1650–2550 | **Glide to the sleeve**: the record travels on a gentle arc (apex ~40 px above the straight line) to just right of the cover card, scaling down to the sleeve's proportion, rotating a slow ~25°, 900 ms, `glide`. |
| 2400–2950 | **Into the sleeve**: the record slides left, *behind* the sleeve, until hidden, 550 ms, `settle`. Soft paper-and-vinyl "shff" sound as it enters. |
| 2500–3100 | Deck fades down: opacity → 0, 12 px drop, 600 ms, `ease-in-out`. |
| 2800–3500 | **Sleeve returns to the crate**: travels on an arc to its crate slot, scaling up to crate size, 700 ms, `glide`, then a **1.5 px settle** — the "pf" — with a soft low cardboard thump. |
| 3000–3500 | The other sleeves rise back in around it, 500 ms, `settle`, staggered 40 ms outward. |
| 3300–3650 | Crate header and caption fade in, 350 ms. Input unlocked. Preview starts after its normal dwell. |

### Crate → Player (≈ 2.4 s) — the same calm character, in reverse

| Time (ms) | What happens |
|---|---|
| 0–350 | Other sleeves sink and fade, staggered 20 ms; caption and header fade. Preview surfaces and fades (existing behaviour). |
| 150–950 | Sleeve lifts out of the crate (small rise, 150 ms) then glides to the cover-card position, 800 ms, `glide`. |
| 700–1200 | Deck fades up in place: opacity 0 → 1, 12 px rise, 500 ms, `settle`. |
| 1000–1500 | Record slides out of the sleeve's right edge, 500 ms, `lift`, and hovers briefly. |
| 1500–2200 | Record glides on an arc to the platter, scale to size, 700 ms, `glide`; then lowers onto it — shadow tightens, scale 1.035 → 1.00, 250 ms, with a soft felt contact sound. |
| 2000–2400 | UI fades in (ring, tracklist, lyrics, capsule), staggered 70 ms. Then the play sequence begins. |

### Rules

- All timings live in one constants file so they can be tuned; expose a global
  **speed multiplier** in the debug panel (0.5×–1.5×) — the owner will want to
  fine-tune the feel.
- Shadows are the main depth cue during the float: a lifted record must have a
  visibly larger, softer, fainter shadow than a record on the platter.
- The record rotates slowly while floating (inertia from the platter), never
  spins fast, never stops abruptly.
- `prefers-reduced-motion` still collapses everything to a 200 ms crossfade.

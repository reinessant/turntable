# Bugfix Checklist — Every Known Bug, One Place

Every bug the owner has reported so far, with where the fix is specified. Work
through all of them. When you report progress, copy this table and fill the
**Status** column honestly: `FIXED (verified how)`, `NOT FIXED`, or
`N/A (why)`. "Verified" means you looked at it running — not that it compiles.

Documents referenced:
- **F3** = FIX_ROUND_3.md (in this pack)
- **DS** = design-reference/DESIGN_SPEC.md (in this pack)
- **Pack** = the earlier specification pack (turntable-spec-pack.zip), which
  you already have. Its import, crate-interaction and lyrics-source documents
  still apply where F3 and DS don't replace them.

## Audio and playback

| # | Bug | Fix | Status |
|---|---|---|---|
| A1 | Time advances but no music / only white noise | Music through `decodeAudioData` + `AudioBufferSourceNode` from binary file bytes. Never play raw bytes as PCM, never `readTextFile`. `AudioContext.resume()` on first gesture. F3 §4.2 | |
| A2 | **Platter keeps spinning when paused** | Pause = tape-stop (rate 1→0 in 700 ms), platter speed follows the same curve and ends at exactly 0. Only playing spins it. F3 §4.2, DS §6 | |
| A3 | Dragging the platter gives a "glitchy" slowdown, not a tape-stop | Caused by `HTMLMediaElement.preservesPitch`. Use `AudioBufferSourceNode.playbackRate` (speed + pitch together), smoothed with `setTargetAtTime`. F3 §4.2 | |
| A4 | No tape-stop / tape-start sound on pause / play | Rate ramps: stop 700 ms, start 350 ms, platter in sync. F3 §4.2 | |
| A5 | ~4 s of hiss before music, ~9 s total after pressing play | Press play → music in ≤ 1.8 s. New timeline F3 §4.1 | |
| A6 | Surface noise too loud | −42 dBFS, ducked 6 dB under music, sparse crackle. F3 §4.3 | |
| A7 | Debug panel shows `speed 0.000` while playing | Fix the readout; show platter rpm, playback rate and tracked position side by side. F3 §4.4 | |
| A8 | Track change is slow | ≤ 1.2 s for adjacent tracks. F3 §4.5 | |

## Visuals

| # | Bug | Fix | Status |
|---|---|---|---|
| V1 | Whole app looks "cheap / Roblox" | Remove three.js; 2.5D layered deck. F3 §0–1, DS §6 | |
| V2 | Turntable cartoonish / "vanilla" (cream, orange) | Graphite finish, chamfer, machined knobs, cold-white LED. DS §0, §6 | |
| V3 | Record is a flat black circle | Canvas record: grooves, track-gap rings, dust, fixed sheen. DS §6 | |
| V4 | Tonearm crude, counterweight floating, random rectangles on plinth | `deck.js` arm SVG and control set, nothing else on the plinth. DS §6 | |
| V5 | Background dull mauve-grey | Blurred-cover backdrop + glow + grain. DS §4 | |
| V6 | Colour banding rings | Grain overlay. DS §4 | |
| V7 | Icons are text glyphs, inconsistent | Phosphor light, bundled. DS §1, F3 §7.4 | |
| V8 | UI tiny, grey, no hierarchy | Type scale + tokens. DS §3, §5 | |
| V9 | Lyrics hanging indent looks broken | No indent, 20 px between lines. DS §5.5 | |
| V10 | Pure black / pure white used | Forbidden everywhere. DS §3 | |
| V11 | Font not good enough | Mona Sans Expanded (display) + Geist + Geist Mono. DS §3 | |

## Crate

| # | Bug | Fix | Status |
|---|---|---|---|
| C1 | Second album shows the first album's cover | Key covers by album id + file path. F3 §5.1 | |
| C2 | Sleeves intersect; stray heart-shaped line | Stack from the `pos` model; remove the broken crescent. F3 §5.1, DS §7 | |
| C3 | "1 tracks" | Pluralise. F3 §5.1 | |
| C4 | Blurry cover | 1000 px source for the focused sleeve. F3 §5.1 | |
| C5 | Detached shadow blob, misaligned caption, clipped header | DS §7 | |
| C6 | Can't judge flipping with 1–2 albums | Dev "seed demo crate" (40 albums). F3 §5.5 | |

## Transitions

| # | Bug | Fix | Status |
|---|---|---|---|
| T1 | Hard camera zoom into the deck | No camera zooms. F3 §6.2 | |
| T2 | Record flies over the tracklist and lyrics | Nothing travels over text. F3 §6.2–6.4 | |
| T3 | Empty grey platter visible mid-transition | Deck appears with its mat. F3 §6.3 | |
| T4 | **Transition into an album is very buggy** | Rebuild on the flight-layer architecture: both screens mounted, clones, measure after layout, one GSAP timeline, no setState mid-tween. TRANSITION_SPEC.md. Verify at 20% speed, both directions, two window sizes. | |

## Build and runtime — these were not in any document before

| # | Bug | Fix | Status |
|---|---|---|---|
| R1 | Release build showed a blank white screen | Every asset (fonts, icons, images) bundled and loaded by paths that resolve in the **release** build, not only in dev. Grep for any runtime `http://` / `https://` fetch and remove it — the only allowed network call is `https://lrclib.net`. | |
| R2 | Silent failures | Wrap each screen in an ErrorBoundary that shows the error text on screen. Suspense fallbacks must show a visible "loading …" line, never a blank screen. | |
| R3 | Tauri CSP | `security.csp` must allow only what is used: `self`, `blob:` and `data:` for images/media, the asset protocol if used, and `connect-src https://lrclib.net`. Nothing else external. | |
| R4 | Leftover three.js / Draco / KTX2 / HDRI / glb code and dependencies | Delete all of it and remove the packages. F3 §1 | |
| R5 | Release not actually verified | Before reporting: run the **release** build, import an album, play it, pause it, change track, and screenshot each. "It compiled and the window opened" is not verification. | |

## Round 2 (after the first port)

| # | Bug | Fix | Status |
|---|---|---|---|
| L1 | Composition sits too low; tracklist runs under the capsule | Deck centre y 565, columns aligned to the deck, scrolling tracklist. DS §5 (Revision 2) | |
| L2 | Black-and-white cover → muddy grey room with a random green glow | Light room + neutral-glow rule. DS §4, tokens.css `room-light` | |
| L3 | Track ring: records bunch up and turn into slivers near the album's ends | Radius 340, 30° step, ±80° window, squeeze ≥ 0.35. DS §5.2 | |
| L4 | Long track names with "prod …" credits | Split credits into muted text. DS §5.3 | |

## Import

| # | Bug | Fix | Status |
|---|---|---|---|
| I1 | Files have no tags → titles are filenames | Filename cleanup + "Paste track titles" (one line per track). F3 §7.9, Pack: ALBUM_IMPORT_SPEC §5.2 | |
| I2 | Import screen looks bad | DS §8 | |


## Round 3

| # | Bug / request | Fix | Status |
|---|---|---|---|
| P1 | Crate footer says "Previewing · <first track>" while a different (random) track is actually playing | The label must come from the SAME object that chose the random track. Set it when the preview actually starts, not when the album is focused. | |
| P2 | When the record starts playing, a ghost of the crate is visible behind the deck (dark translucent sleeve rectangles with lines), and the record sits offset from the platter so two discs show | The crate must be fully hidden (`visibility: hidden`) after the transition, not just faded. The record clone's end rect must be the real record's rect measured AFTER layout; on completion swap clone → real record in the same frame. See TRANSITION_SPEC §1 #1–#3 and §3. Verify at 20% speed. | |
| P3 | Composition too low / top too empty / not centred | DESIGN_SPEC Revision 3. | |
| P4 | Controls on the deck must be clickable | DESIGN_SPEC Revision 3 — play knob, volume knob, cue lever, tonearm. | |
| P5 | Transitions too fast | TRANSITION_SPEC §6 (Revision 3 timings). | |
| W1 | Custom title bar | TITLEBAR_SPEC.md. Window drags by the top bar, double-click maximises, min/max/close work, max icon swaps to restore. | |
| W2 | Window still resizes from all edges and keeps its shadow | TITLEBAR_SPEC.md | |
| W3 | Nothing in the app header is covered by the drag region at 1600×900 and 1920×1080 | TITLEBAR_SPEC.md | |

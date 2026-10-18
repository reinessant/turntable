/* All transition timings live here. Seconds unless noted; eases are GSAP names
   (CustomEase "flightLift" / "flightGlide" / "flightSettle" are registered from FLIGHT_EASE). */

/** Crate → player: pick a record → darkness → tap the record → impact + wave of light. */
export const REVEAL = {
  /** 1. The clicked sleeve acknowledges the click. */
  ack: { duration: .18, rotate: -3, scale: 1.04, ease: "power2.out", release: .22 },
  /** 2a. The record snaps out of the sleeve (starts this long after the click). */
  slideOut: { start: .1, duration: .22, distance: 300, ease: "power3.out" },
  /** 2b. Flight straight onto the platter (starts when the slide-out ends). */
  flight: {
    duration: .48, ease: "flightGlide",
    overshoot: 1.04,        // relative scale peak just before landing
    settle: .16, settleEase: "flightSettle",
    hoverScale: 1.035,      // the record hovers this much "above" the platter until tapped
    crateLookFade: .2       // the crate-style vinyl crossfades into the deck's real record
  },
  /** 3. Darkness: starts together with the slide-out. */
  dark: { duration: .35, ease: "power1.inOut", color: "#000" },
  /** 4. Waiting for the tap: the record turns slowly, alone in the dark. */
  idle: { speed: .15 },
  /** 5. The tap — the impact. All times are relative to the tap. */
  tap: {
    punch: .55, punchEase: "expo.out",          // the whole deck "lands": scale hoverScale → 1 around the record
    shadowDrop: .2, shadowEase: "power2.out",
    flash: .07, flashOut: .65, flashPeak: .5,   // warm flash at the record, in / out / opacity
    ring: .85, ringScale: 3.4, ringEase: "expo.out", ringOpacity: .55,   // shock ring
    armSwingMs: 260, armSwingEase: "cubic-bezier(.3,1.32,.5,1)",         // y > 1 = micro overshoot
    kickPeak: 4.5, kickRise: .07, kickRiseEase: "power2.out",
    kickSettle: 1.03, kickSettleEase: "power3.out",                      // rise + settle ≈ 1.1 s
    musicFadeIn: .3
  },
  /** 5b. Darkness leaves as a widening hole from the record's centre — fast start, long soft tail. */
  wave: {
    duration: 1.3, ease: "power4.out",
    featherFrom: 3, featherTo: 280,             // px, soft edge grows with the wave
    light: .12, lightIn: .12, lightOutStart: .45   // warm rgba(255,228,190,light) on the wave front (≤ .16)
  },
  /** 5c. Player UI, staggered (relative to the tap). */
  ui: { start: .38, duration: .55, stagger: .05, y: 14, ease: "expo.out" },
  /** prefers-reduced-motion: no flight, no wave. */
  reduced: { crossfade: .2 }
} as const;

/** Player → crate: the room closes in on the record, it lifts off and flies home into its sleeve. */
export const RETURN = {
  ui: { duration: .28, stagger: .03, y: -10, ease: "power2.in" },
  armSwingMs: 300,
  close: { duration: .6, ease: "power3.inOut", light: .1 },   // the dark hole shrinks onto the record
  lift: { duration: .18, scale: 1.035, ease: "power2.out" },   // at the end of the close
  flight: { duration: .5, ease: "flightGlide", crateLookFade: .3 },
  open: { delay: .26, duration: .5, ease: "power1.inOut" },    // darkness fades (after the record has crossed the sleeve)
  slideIn: { duration: .32, ease: "power3.inOut" },            // the record slides back into the sleeve
  bump: { scale: 1.025, up: .12, down: .28 },                  // the sleeve takes the record
  reduced: { crossfade: .2 }
} as const;

export const FLIGHT_EASE = {
  lift: "0.25,0.1,0.25,1",
  glide: "0.45,0,0.25,1",
  settle: "0.22,1,0.36,1"
} as const;

import { useEffect, useRef } from "react";
import gsap from "gsap";
import "./eases";
import { audio } from "./audio";
import type { Album } from "./types";
import { coverSrc } from "./PlayerScreen";
import { deckMotion } from "./deckMotion";
import { copyCanvases, labelReady, paintLabel } from "./labelArt";
import { REVEAL, RETURN } from "./transitionTiming";

/* The record's journey between the crate and the deck.

   "in"  (crate → player): the sleeve acknowledges the click → the record snaps out and flies onto the
         real platter → the room goes black, only the record is left, turning slowly → tap → impact:
         the record drops (the deck lands around it), flash + shock ring, the arm swings in, the platter
         kicks, music starts, the darkness bursts open from the record → player UI.
   "out" (player → crate): UI goes, the darkness closes in on the record, the arm leaves, the record
         lifts and flies home while the crate comes back, then slides into its sleeve.

   Everything that moves is a clone in this layer or a transform/opacity on a real element; every inline
   style touched on a real element is remembered and put back in cleanup. */

export type RecordDirection = "in" | "out";
interface Props {
  album: Album;
  direction: RecordDirection;
  focused: number;
  timeline: React.MutableRefObject<gsap.core.Timeline | null>;
  /** "in": the tap — switch to the player screen and start the music (inside the user gesture) */
  onTap: () => void;
  /** "in": Esc / a click on another cover before the darkness closes, or a failure: back to the crate */
  onCancel: () => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}
type Stage = "prep" | "intro" | "waiting" | "tapped" | "leaving" | "out";

/** Edge of the slid-out record from the sleeve centre, in artboard px: sleeve 460 + record 430 → clear at 445. */
const SLID_OUT_X = 450;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const need = <T extends Element>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error("Transition element missing: " + selector);
  return element;
};
const centre = (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

export function RecordTransition({ album, direction, focused, timeline, onTap, onCancel, onComplete, onError }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onTap, onCancel, onComplete, onError });
  callbacks.current = { onTap, onCancel, onComplete, onError };

  useEffect(() => {
    const maybeHost = layer.current;
    if (!maybeHost) return;
    const host: HTMLDivElement = maybeHost;
    let stage: Stage = "prep";
    let disposed = false;
    let raf = 0;
    const tweens: gsap.core.Animation[] = [];
    const timers: number[] = [];
    const gsapTouched = new Set<HTMLElement>();
    /** the player UI: only opacity and --ui-y are animated — a GSAP clear of `transform` on these would write
        their drift animation's live `translate` into the transform and leave the blocks a few px off */
    const uiTouched: HTMLElement[] = [];
    const saved = new Map<HTMLElement, Map<string, string>>();
    /** set an inline style on a real element, remembering the value it had */
    /** `drop`: on restore just remove it (for props React may have changed meanwhile, e.g. the peek's opacity) */
    const put = (element: HTMLElement, prop: string, value: string, drop = false) => {
      let props = saved.get(element);
      if (!props) saved.set(element, props = new Map());
      if (!props.has(prop)) props.set(prop, drop ? "" : element.style.getPropertyValue(prop));
      element.style.setProperty(prop, value);
    };
    const touch = (...elements: HTMLElement[]) => { for (const element of elements) gsapTouched.add(element); };
    const keep = <T extends gsap.core.Animation>(animation: T): T => { tweens.push(animation); return animation; };
    let deckHostRef: HTMLElement | null = null;

    let tap = () => {};
    let cancel = () => {};
    let darkDone = false;
    let sleeveBox = new DOMRect();
    let disc = { x: 0, y: 0, r: 0 };
    const inDisc = (x: number, y: number) => Math.hypot(x - disc.x, y - disc.y) <= disc.r;
    function onPointer(event: PointerEvent) {
      if (event.button !== 0 || direction !== "in") return;
      const { clientX: x, clientY: y } = event;
      if (stage === "intro" && !darkDone) {
        // the crate is still visible: a click on another cover cancels; a second click on this one is ignored
        const s = sleeveBox;
        if (!(x >= s.left && x <= s.right && y >= s.top && y <= s.bottom)) cancel();
        return;
      }
      if ((stage === "intro" || stage === "waiting") && inDisc(x, y)) tap();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
      if ((event.key === "Enter" || event.code === "Space") && darkDone) { event.preventDefault(); event.stopPropagation(); tap(); }
    }
    if (direction === "in") addEventListener("keydown", onKey, true);
    host.addEventListener("pointerdown", onPointer);

    const cleanup = () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const animation of tweens) animation.kill();
      for (const timer of timers) clearTimeout(timer);
      if (gsapTouched.size) gsap.set([...gsapTouched], { clearProps: "opacity,transform,transformOrigin,willChange" });
      for (const element of uiTouched) { element.style.removeProperty("opacity"); element.style.removeProperty("--ui-y"); }
      for (const [element, props] of saved) for (const [prop, value] of props)
        value ? element.style.setProperty(prop, value) : element.style.removeProperty(prop);
      deckHostRef?.classList.remove("arm-swing");
      deckMotion.reset();
      host.replaceChildren();
      host.classList.remove("is-waiting");
      timeline.current = null;
      removeEventListener("keydown", onKey, true);
      host.removeEventListener("pointerdown", onPointer);
    };

    const run = async () => {
      await frame(); await frame();
      if (disposed) return;
      const crate = need<HTMLElement>(".crate-screen");
      const player = need<HTMLElement>(".player-screen");
      const sleeve = need<HTMLElement>(`.crate-screen .sleeve[data-i="${focused}"]`);
      const face = need<HTMLElement>(".face", sleeve);
      const peek = need<HTMLElement>(".crate-screen .peek");
      const peekDisc = need<HTMLElement>(".v", peek);
      const deckHost = need<HTMLElement>(".player-screen #deck");
      deckHostRef = deckHost;
      const stageBox = need<HTMLElement>(".stage", player);
      const spin = need<HTMLElement>(".spin", deckHost);
      const shadow = need<HTMLElement>(".record-shadow", deckHost);
      const sheen = need<HTMLElement>(".sheen", deckHost);
      const ui = [...player.querySelectorAll<HTMLElement>(".header, .carousel, .carousel-caption, .left, .lyrics, .capsule")];
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const swing = (ms: number, ease: string) => {
        deckHost.style.setProperty("--arm-swing-ms", ms + "ms");
        deckHost.style.setProperty("--arm-swing-ease", ease);
        deckHost.classList.add("arm-swing");
        timers.push(window.setTimeout(() => deckHost.classList.remove("arm-swing"), ms + 60));
      };

      if (reduced) {
        stage = direction === "in" ? "tapped" : "out";
        const [from, to] = direction === "in" ? [crate, player] : [player, crate];
        put(to, "visibility", "visible");
        touch(from, to);
        gsap.set(to, { opacity: 0 });
        const crossfade = (direction === "in" ? REVEAL : RETURN).reduced.crossfade;
        timeline.current = keep(gsap.timeline({ onComplete: () => { if (direction === "in") callbacks.current.onTap(); callbacks.current.onComplete(); } }))
          .to(from, { opacity: 0, duration: crossfade, ease: "none" }, 0)
          .to(to, { opacity: 1, duration: crossfade, ease: "none" }, 0);
        return;
      }

      // ---- Prepare: the destination screen is mounted underneath; the deck's record is hidden while a clone moves.
      if (direction === "in") {
        put(player, "visibility", "hidden");
        for (const element of [spin, shadow, sheen]) put(element, "visibility", "hidden");
        uiTouched.push(...ui);
        gsap.set(ui, { opacity: 0, "--ui-y": REVEAL.ui.y + "px" });
      }
      touch(face);
      await Promise.all([labelReady(spin.querySelector<HTMLCanvasElement>("canvas.label-art")), labelReady(peek.querySelector("canvas"))]);
      if (disposed) return;

      // ---- Measure (window px, includes the artboard --fit). C comes from the record's shadow: the record
      // itself carries a rotation, which inflates its bounding box.
      const P = peek.getBoundingClientRect();
      sleeveBox = sleeve.getBoundingClientRect();
      if (!P.width) throw new Error("Transition target has no layout");
      const fit = P.width / peek.offsetWidth;                        // artboard px → window px
      // the deck may be turned: its record box is a rotated square, so build C from its (fixed) centre and true size
      const shadowBox = shadow.getBoundingClientRect(), recordSize = shadow.offsetWidth * fit;
      const C = new DOMRect(shadowBox.left + shadowBox.width / 2 - recordSize / 2, shadowBox.top + shadowBox.height / 2 - recordSize / 2, recordSize, recordSize);
      if (!C.width) throw new Error("Transition target has no layout");
      const peekX0 = new DOMMatrix(getComputedStyle(peek).transform).m41;
      const c = centre(C), p = centre(P);
      // where the record sits when it is fully out of the sleeve, relative to the platter
      const outX = p.x + (SLID_OUT_X - peekX0) * fit - c.x, outY = p.y - c.y;
      const outScale = P.width / C.width;
      const k = parseFloat(getComputedStyle(deckHost).getPropertyValue("--k")) || 1;   // deck px per mm
      const maxR = Math.hypot(Math.max(c.x, innerWidth - c.x), Math.max(c.y, innerHeight - c.y));

      // ---- Layer: darkness (+ hole), impact flash and ring, the record clone.
      const dark = document.createElement("div");
      dark.className = "reveal-dark";
      dark.style.setProperty("--dark", REVEAL.dark.color);
      dark.style.setProperty("--x", c.x + "px");
      dark.style.setProperty("--y", c.y + "px");
      const hole = { r: 0, f: 0, light: 0 };
      const paint = () => {
        dark.style.setProperty("--r", hole.r.toFixed(1) + "px");
        dark.style.setProperty("--f", hole.f.toFixed(1) + "px");
        dark.style.setProperty("--light", hole.light.toFixed(3));
      };
      const flash = document.createElement("div");
      flash.className = "reveal-flash";
      Object.assign(flash.style, { left: c.x + "px", top: c.y + "px", width: C.width * 3 + "px", height: C.width * 3 + "px" });
      const ring = document.createElement("div");
      ring.className = "reveal-ring";
      Object.assign(ring.style, { left: c.x + "px", top: c.y + "px", width: C.width * REVEAL.flight.hoverScale + "px", height: C.width * REVEAL.flight.hoverScale + "px" });
      const clone = document.createElement("div");
      clone.className = "reveal-disc";
      Object.assign(clone.style, { left: C.left + "px", top: C.top + "px", width: C.width + "px", height: C.height + "px", visibility: "hidden" });
      clone.style.setProperty("--k", String(k));
      const rotor = document.createElement("div");
      rotor.className = "reveal-rotor";
      const spinClone = spin.cloneNode(true) as HTMLElement;
      // no explicit visibility on the clone's children: they must inherit the clone's hidden/visible
      spinClone.style.removeProperty("visibility");
      Object.assign(spinClone.style, { left: "0", top: "0", transformOrigin: "0 0",
        transform: `scale(${C.width / spin.offsetWidth}, ${C.height / spin.offsetHeight})` });
      copyCanvases(spin, spinClone);
      const crateLook = document.createElement("div");
      crateLook.className = "reveal-crate-look";
      const crateLabel = document.createElement("canvas");
      crateLabel.className = "reveal-crate-label";
      crateLook.append(Object.assign(document.createElement("div"), { className: "peek-vinyl" }), crateLabel);
      void paintLabel(crateLabel, coverSrc(album), C.width * .34 * outScale / fit).catch(() => undefined);
      rotor.append(spinClone, crateLook);
      const sheenClone = sheen.cloneNode(false) as HTMLElement;
      sheenClone.style.removeProperty("visibility");
      Object.assign(sheenClone.style, { left: "0", top: "0", width: "100%", height: "100%" });
      clone.append(rotor, sheenClone);
      host.append(dark, flash, ring, clone);
      gsap.set([flash, ring], { xPercent: -50, yPercent: -50, opacity: 0 });

      const spinLoop = () => { rotor.style.transform = `rotate(${deckMotion.angle + deckMotion.offset}rad)`; raf = requestAnimationFrame(spinLoop); };
      const slide = { x: 0 };
      const paintSlide = () => peek.style.setProperty("translate", slide.x + "px 0px");
      put(peek, "transition", "none");
      put(peek, "opacity", "1", true);   // behind the sleeve at rest, so visible is always safe
      put(peek, "translate", "0px 0px");
      put(face, "will-change", "transform");

      if (direction === "out") return runOut();
      return runIn();

      // =========================================================== crate → player
      function runIn() {
        const t = REVEAL;
        disc = { ...c, r: C.width / 2 * t.flight.hoverScale };
        const slideLocal = t.slideOut.distance + Math.max(0, 150 - peekX0);   // always ends clear of the sleeve
        gsap.set(clone, { x: outX + (slideLocal - (SLID_OUT_X - peekX0)) * fit, y: outY, scale: outScale });
        gsap.set(dark, { opacity: 0 });
        paint();

        let cloneShown = false, waiting = false;
        const showClone = () => {
          if (cloneShown) return;
          cloneShown = true;
          const m = new DOMMatrix(getComputedStyle(peekDisc).transform);
          deckMotion.angle = Math.atan2(m.b, m.a) - deckMotion.offset;   // carry the crate record's spin over
          deckMotion.idle = t.idle.speed;
          put(peek, "visibility", "hidden");
          clone.style.visibility = "visible";
          spinLoop();
        };
        const goDark = () => {
          if (darkDone) return;
          darkDone = true;
          put(crate, "visibility", "hidden");
          put(player, "visibility", "visible");
        };
        const enterWaiting = () => {
          if (waiting) return;
          waiting = true;
          stage = "waiting";
          host.classList.add("is-waiting");   // just the record, alone in the dark
        };

        const slideEnd = t.slideOut.start + t.slideOut.duration;
        const landed = slideEnd + t.flight.duration;
        const intro = keep(gsap.timeline({ paused: true }))
          .to(face, { rotation: t.ack.rotate, scale: t.ack.scale, duration: t.ack.duration, ease: t.ack.ease }, 0)
          .to(face, { rotation: 0, scale: 1, duration: t.ack.release, ease: "power2.inOut" }, t.ack.duration)
          .to(slide, { x: slideLocal, duration: t.slideOut.duration, ease: t.slideOut.ease, onUpdate: paintSlide }, t.slideOut.start)
          .to(dark, { opacity: 1, duration: t.dark.duration, ease: t.dark.ease }, t.slideOut.start)
          .call(goDark, [], t.slideOut.start + t.dark.duration)
          .call(showClone, [], slideEnd)
          .to(clone, { x: 0, y: 0, duration: t.flight.duration, ease: t.flight.ease }, slideEnd)
          .to(clone, { scale: t.flight.hoverScale * t.flight.overshoot, duration: t.flight.duration, ease: t.flight.ease }, slideEnd)
          .to(clone, { scale: t.flight.hoverScale, duration: t.flight.settle, ease: t.flight.settleEase }, landed)
          .to(crateLook, { opacity: 0, duration: t.flight.crateLookFade, ease: "none" }, slideEnd)
          .call(enterWaiting, [], landed + t.flight.settle);

        tap = () => {
          if (stage !== "intro" && stage !== "waiting") return;
          if (stage === "intro") { intro.progress(1); goDark(); showClone(); enterWaiting(); }
          stage = "tapped";
          host.classList.remove("is-waiting");
          cancelAnimationFrame(raf);
          const tp = t.tap;

          // the record is already on the platter: swap the clone for the deck's own record (same angle),
          // and land the whole deck around it — it is scaled up to the hover size and settles to 1.
          for (const element of [spin, shadow, sheen]) put(element, "visibility", "visible");
          clone.remove();
          touch(stageBox, shadow);
          const sb = stageBox.getBoundingClientRect();
          gsap.set(stageBox, { transformOrigin: `${((c.x - sb.left) / fit).toFixed(1)}px ${((c.y - sb.top) / fit).toFixed(1)}px` });
          audio.sound("drop");

          // arm in fast with a micro overshoot, then the usual slow drift (deck.css 900 ms)
          swing(tp.armSwingMs, tp.armSwingEase);

          // platter: jerk up to ×4.5 and settle to 33⅓ — the same rotation keeps going, only its speed changes
          deckMotion.idle = 0;
          deckMotion.drive = 1;
          deckMotion.boost = t.idle.speed;

          // music, inside the gesture
          callbacks.current.onTap();

          hole.r = C.width / 2 * t.flight.hoverScale + 2; hole.f = t.wave.featherFrom; hole.light = 0;
          paint();
          const wave = keep(gsap.timeline({ onComplete: () => callbacks.current.onComplete() }))
            .fromTo(stageBox, { scale: t.flight.hoverScale }, { scale: 1, duration: tp.punch, ease: tp.punchEase }, 0)
            .fromTo(shadow, { y: 9 * k, scale: 1.06, opacity: .55 }, { y: 0, scale: 1, opacity: 1, duration: tp.shadowDrop, ease: tp.shadowEase }, 0)
            .to(flash, { opacity: tp.flashPeak, duration: tp.flash, ease: "power1.out" }, 0)
            .to(flash, { opacity: 0, duration: tp.flashOut, ease: "power2.out" }, tp.flash)
            .fromTo(ring, { scale: .98, opacity: tp.ringOpacity }, { scale: tp.ringScale, opacity: 0, duration: tp.ring, ease: tp.ringEase }, 0)
            .to(deckMotion, { boost: tp.kickPeak, duration: tp.kickRise, ease: tp.kickRiseEase }, 0)
            .to(deckMotion, { boost: 1, duration: tp.kickSettle, ease: tp.kickSettleEase, onComplete: () => { deckMotion.drive = null; } }, tp.kickRise)
            .to(hole, { r: maxR, f: t.wave.featherTo, duration: t.wave.duration, ease: t.wave.ease, onUpdate: paint }, 0)
            .to(hole, { light: t.wave.light, duration: t.wave.lightIn, ease: "sine.out", onUpdate: paint }, 0)
            .to(hole, { light: 0, duration: t.wave.duration - t.wave.lightOutStart, ease: "sine.in", onUpdate: paint }, t.wave.lightOutStart)
            .to(ui, { opacity: 1, "--ui-y": "0px", duration: t.ui.duration, stagger: t.ui.stagger, ease: t.ui.ease }, t.ui.start);
          timeline.current = wave;
        };

        cancel = () => {
          if (stage !== "intro" && stage !== "waiting") return;
          stage = "leaving";
          intro.pause();
          host.classList.remove("is-waiting");
          put(crate, "visibility", "visible");
          put(player, "visibility", "hidden");
          const back = keep(gsap.timeline({ onComplete: () => callbacks.current.onCancel() }))
            .to(dark, { opacity: 0, duration: .3, ease: "power1.out" }, 0)
            .to(face, { rotation: 0, scale: 1, duration: .2, ease: "power2.out" }, 0);
          let slideBackAt = 0;
          if (cloneShown) {
            // back to where it left the sleeve, then the real crate record slides home
            back.to(crateLook, { opacity: 1, duration: .2, ease: "none" }, 0)
              .to(clone, { x: outX + (slideLocal - (SLID_OUT_X - peekX0)) * fit, y: outY, scale: outScale, duration: .25, ease: "power2.inOut" }, 0)
              .call(() => { clone.remove(); cancelAnimationFrame(raf); put(peek, "visibility", "visible"); deckMotion.idle = 0; }, [], .25);
            slideBackAt = .25;
          }
          back.to(slide, { x: 0, duration: .22, ease: "power2.inOut", onUpdate: paintSlide }, slideBackAt);
          timeline.current = back;
        };

        stage = "intro";
        timeline.current = intro;
        intro.play();
      }

      // =========================================================== player → crate
      function runOut() {
        const t = RETURN;
        stage = "out";
        uiTouched.push(...ui);
        put(peek, "visibility", "hidden");
        gsap.set(crateLook, { opacity: 0 });
        hole.r = maxR; hole.f = REVEAL.wave.featherTo; hole.light = 0;
        paint();
        swing(t.armSwingMs, "cubic-bezier(.45,0,.2,1)");

        const toClone = () => {
          for (const element of [spin, shadow, sheen]) put(element, "visibility", "hidden");
          clone.style.visibility = "visible";
          hole.r = 0; hole.f = 0; hole.light = 0; paint();   // fully black now; the clone covers the record
          put(crate, "visibility", "visible");
          put(player, "visibility", "hidden");
          spinLoop();
        };
        const toPeek = () => {
          cancelAnimationFrame(raf);
          clone.style.visibility = "hidden";
          const x = new DOMMatrix(getComputedStyle(peek).transform).m41;   // React may have moved it out to 150 meanwhile
          slide.x = SLID_OUT_X - x; paintSlide();
          const turn = peekDisc.getAnimations()[0];                         // continue the label's angle
          if (turn) turn.currentTime = (((deckMotion.angle + deckMotion.offset) / (Math.PI * 2)) % 1 + 1) % 1 * 10000;
          put(peek, "visibility", "visible");
        };

        const flightAt = t.close.duration + t.lift.duration;
        const land = flightAt + t.flight.duration;
        const bumpAt = land + t.slideIn.duration * .6;
        timeline.current = keep(gsap.timeline({ onComplete: () => callbacks.current.onComplete() }))
          .to(ui, { opacity: 0, "--ui-y": t.ui.y + "px", duration: t.ui.duration, stagger: t.ui.stagger, ease: t.ui.ease }, 0)
          .to(hole, { r: C.width / 2 + 2, f: REVEAL.wave.featherFrom, duration: t.close.duration, ease: t.close.ease, onUpdate: paint }, 0)
          .to(hole, { light: t.close.light, duration: t.close.duration * .4, ease: "sine.out", onUpdate: paint }, 0)
          .to(hole, { light: 0, duration: t.close.duration * .6, ease: "sine.in", onUpdate: paint }, t.close.duration * .4)
          .call(toClone, [], t.close.duration)
          .to(clone, { scale: t.lift.scale, duration: t.lift.duration, ease: t.lift.ease }, t.close.duration)
          .to(clone, { x: outX, y: outY, scale: outScale, duration: t.flight.duration, ease: t.flight.ease }, flightAt)
          .to(crateLook, { opacity: 1, duration: t.flight.crateLookFade, ease: "none" }, flightAt + .05)
          .to(dark, { opacity: 0, duration: t.open.duration, ease: t.open.ease }, flightAt + t.open.delay)
          .call(toPeek, [], land)
          .to(slide, { x: 0, duration: t.slideIn.duration, ease: t.slideIn.ease, onUpdate: paintSlide }, land)
          .to(face, { scale: t.bump.scale, duration: t.bump.up, ease: "power2.out" }, bumpAt)
          .to(face, { scale: 1, duration: t.bump.down, ease: "power2.inOut" }, bumpAt + t.bump.up);
      }
    };

    void run().catch((error) => {
      if (disposed) return;
      callbacks.current.onError(error instanceof Error ? error : new Error(String(error)));
      if (direction === "in") callbacks.current.onCancel(); else callbacks.current.onComplete();
    });
    return cleanup;
  }, [album.id, direction, focused, timeline]);

  return <div className="reveal-layer" ref={layer} aria-hidden="true" />;
}

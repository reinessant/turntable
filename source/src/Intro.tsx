import { useEffect } from "react";
import gsap from "gsap";
import { REVEAL } from "./transitionTiming";

/* Launch: the window opens full screen but see-through, with only the turning record from index.html
   showing over the desktop (painted before any script). Then a ring of light, and the wave: a circle grows from
   the record and the app shows inside it until it fills the screen — the same wave as dropping the needle.
   The circle is CSS variables on <html> (--wx --wy --wr --wf --wl), read by the splash and by #root's mask.
   The albums themselves are held back (html.albums-hold) and rise in only after the record has faded. */
export function Intro({ onDone, skip = false }: { onDone: () => void; skip?: boolean }) {
  useEffect(() => {
    const html = document.documentElement, splash = document.getElementById("splash");
    const albumsIn = () => {
      if (!html.classList.contains("albums-hold")) return;
      html.classList.add("albums-in"); html.classList.remove("albums-hold");
      setTimeout(() => html.classList.remove("albums-in"), 1400);
    };
    const finish = () => { splash?.remove(); albumsIn(); html.classList.remove("launching");["--wx", "--wy", "--wr", "--wf", "--wl"].forEach((v) => html.style.removeProperty(v)); onDone(); };
    if (!splash || skip) { finish(); return; }
    const disc = splash.querySelector<HTMLElement>(".disc")!, ring = splash.querySelector<HTMLElement>(".ring")!;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const tl = gsap.timeline({ onComplete: finish });
      tl.set(html, { "--wr": "200vmax" }).to(splash, { opacity: 0, duration: REVEAL.reduced.crossfade + .2 }, .2);
      return () => { tl.kill(); };
    }
    const box = disc.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2, r0 = box.width / 2;
    const far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + REVEAL.wave.featherTo;
    Object.assign(ring.style, { left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px" });
    const wave = { r: 0, f: 0, light: 0 };
    const paint = () => {
      html.style.setProperty("--wx", cx + "px"); html.style.setProperty("--wy", cy + "px");
      html.style.setProperty("--wr", wave.r.toFixed(1) + "px"); html.style.setProperty("--wf", wave.f.toFixed(1) + "px");
      html.style.setProperty("--wl", wave.light.toFixed(3));
    };
    paint();
    const IMPACT = .75;
    const tl = gsap.timeline({ onComplete: finish });
    // the landing: the record lifts a hair and drops, a ring of light leaves it
    tl.to(disc, { scale: 1.045, duration: .16, ease: "power2.out" }, IMPACT - .2)
      .to(disc, { scale: 1, duration: REVEAL.tap.punch, ease: REVEAL.tap.punchEase }, IMPACT - .04)
      .fromTo(ring, { opacity: REVEAL.tap.ringOpacity, scale: 1 }, { opacity: 0, scale: REVEAL.tap.ringScale, duration: REVEAL.tap.ring, ease: REVEAL.tap.ringEase, immediateRender: false }, IMPACT)
      // the wave: from the record's edge to the far corner; the app shows inside it, its front lit warm
      .set(wave, { r: r0, f: REVEAL.wave.featherFrom, onComplete: paint }, IMPACT)
      .to(wave, { r: far, f: REVEAL.wave.featherTo, duration: REVEAL.wave.duration, ease: REVEAL.wave.ease, onUpdate: paint }, IMPACT)
      .to(wave, { light: REVEAL.wave.light * 1.6, duration: REVEAL.wave.lightIn, ease: "power1.out", onUpdate: paint }, IMPACT)
      .to(wave, { light: 0, duration: REVEAL.wave.duration - REVEAL.wave.lightOutStart, ease: "power1.in", onUpdate: paint }, IMPACT + REVEAL.wave.lightOutStart)
      // the record gives way
      .to(disc, { opacity: 0, scale: .92, duration: .45, ease: "power2.in" }, IMPACT + .12)
      // only once the record is gone do the albums come up out of the opened room
      .call(albumsIn, [], IMPACT + .62);
    // a click or key: straight to the wave
    const hurry = () => { if (tl.time() < IMPACT - .2) tl.seek(IMPACT - .2); };
    addEventListener("pointerdown", hurry, { once: true }); addEventListener("keydown", hurry, { once: true });
    return () => { tl.kill(); removeEventListener("pointerdown", hurry); removeEventListener("keydown", hurry); };
  }, []);
  return null;
}

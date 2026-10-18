/* The setup's music: a quiet lo-fi loop made here (nothing licensed is shipped) — electric piano on
   Dm9 · G13 · Cmaj9 · Am9, a soft bass, lazy swung drums, vinyl crackle. It's rendered once into a buffer,
   then played by a reader that can go at any speed, backwards too, so the record on screen scratches it. */
(function () {
  const BPM = 80, BEAT = 60 / BPM, BAR = BEAT * 4, BARS = 8;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const CHORDS = [
    { notes: [50, 53, 57, 60, 64], bass: 38 },   // Dm9
    { notes: [53, 59, 64, 69], bass: 43 },       // G13 (shell)
    { notes: [52, 55, 59, 62], bass: 36 },       // Cmaj9
    { notes: [55, 60, 64, 71], bass: 45 }        // Am9
  ];
  const swing = (eighth) => eighth * BEAT / 2 + (eighth % 2 ? BEAT * .08 : 0);

  async function render(sr) {
    const length = Math.ceil((BARS + 1) * BAR * sr);
    const ctx = new OfflineAudioContext(2, length, sr);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .25;
    const warm = ctx.createBiquadFilter(); warm.type = "lowpass"; warm.frequency.value = 6500;
    const master = ctx.createGain(); master.gain.value = .9;
    master.connect(comp).connect(warm).connect(ctx.destination);

    // electric piano: a sine with a fast-fading octave "tine", through a soft low-pass with a slow tremolo
    const keysBus = ctx.createGain(); keysBus.gain.value = .55;
    const keysLp = ctx.createBiquadFilter(); keysLp.type = "lowpass"; keysLp.frequency.value = 1900; keysLp.Q.value = .4;
    const trem = ctx.createGain(); trem.gain.value = .85;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 3.6; const lfoDepth = ctx.createGain(); lfoDepth.gain.value = .15; lfo.connect(lfoDepth).connect(trem.gain); lfo.start();
    keysBus.connect(keysLp).connect(trem).connect(master);
    const pan = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
    function ep(note, at, dur, vel) {
      const f = midi(note), out = ctx.createGain(), p = pan((note % 7 - 3) * .07);
      out.gain.setValueAtTime(0, at); out.gain.linearRampToValueAtTime(vel, at + .008);
      out.gain.setTargetAtTime(vel * .35, at + .01, .7); out.gain.setTargetAtTime(0, at + dur, .25);
      const a = ctx.createOscillator(); a.frequency.value = f; a.detune.value = (Math.random() - .5) * 6;
      const b = ctx.createOscillator(); b.frequency.value = f * 2; const bg = ctx.createGain(); bg.gain.setValueAtTime(.32, at); bg.gain.setTargetAtTime(0, at, .09);
      const c = ctx.createOscillator(); c.type = "triangle"; c.frequency.value = f * 1.002; const cg = ctx.createGain(); cg.gain.value = .12;
      a.connect(out); b.connect(bg).connect(out); c.connect(cg).connect(out); out.connect(p).connect(keysBus);
      for (const o of [a, b, c]) { o.start(at); o.stop(at + dur + 1.5); }
    }
    function bass(note, at, dur, vel) {
      const f = midi(note), g = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vel, at + .02); g.gain.setTargetAtTime(vel * .6, at + .03, .4); g.gain.setTargetAtTime(0, at + dur, .08);
      const o = ctx.createOscillator(); o.frequency.value = f; const o2 = ctx.createOscillator(); o2.frequency.value = f * 2; const g2 = ctx.createGain(); g2.gain.value = .18;
      o.connect(g); o2.connect(g2).connect(g); g.connect(lp).connect(master); o.start(at); o2.start(at); o.stop(at + dur + .5); o2.stop(at + dur + .5);
    }
    const noise = (() => { const b = ctx.createBuffer(1, sr, sr), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    function hit(at, { type, freq, q = .7, decay, vel, tone = 0, toneDecay = .08 }) {
      const src = ctx.createBufferSource(); src.buffer = noise; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(vel, at); g.gain.setTargetAtTime(0, at, decay);
      src.connect(f).connect(g).connect(master); src.start(at, Math.random() * .5); src.stop(at + decay * 8);
      if (tone) { const o = ctx.createOscillator(); o.frequency.value = tone; const og = ctx.createGain(); og.gain.setValueAtTime(vel * .6, at); og.gain.setTargetAtTime(0, at, toneDecay); o.connect(og).connect(master); o.start(at); o.stop(at + toneDecay * 8); }
    }
    function kick(at, vel) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(115, at); o.frequency.exponentialRampToValueAtTime(42, at + .13);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vel, at + .004); g.gain.setTargetAtTime(0, at + .01, .11);
      o.connect(g).connect(master); o.start(at); o.stop(at + .8);
    }

    for (let bar = 0; bar <= BARS; bar++) {
      const ch = CHORDS[bar % 4], t0 = bar * BAR;
      ch.notes.forEach((n, i) => ep(n, t0 + i * .014, BAR * .62, .085 - i * .006));
      ch.notes.slice(1).forEach((n, i) => ep(n + (i === 2 && bar % 2 ? 2 : 0), t0 + BEAT * 2.5 + swing(1) * .1 + i * .012, BEAT * 1.3, .05));
      bass(ch.bass, t0, BEAT * 1.6, .32); bass(ch.bass + (bar % 2 ? 7 : 12), t0 + BEAT * 2.5, BEAT * .45, .2); bass(ch.bass, t0 + BEAT * 3, BEAT * .9, .26);
      kick(t0, .55); kick(t0 + swing(3), .38); kick(t0 + BEAT * 2.5, .45);
      hit(t0 + BEAT, { type: "bandpass", freq: 1700, decay: .055, vel: .16, tone: 185 });
      hit(t0 + BEAT * 3, { type: "bandpass", freq: 1700, decay: .06, vel: .17, tone: 185 });
      for (let e = 0; e < 8; e++) hit(t0 + swing(e), { type: "highpass", freq: 7200, decay: .018, vel: e % 2 ? .035 : .055 });
    }
    const raw = await ctx.startRendering();

    // fold the extra bar's tail onto the start so the loop is seamless, then lay crackle and hiss over it
    const n = Math.round(BARS * BAR * sr), out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: sr });
    for (let c = 0; c < 2; c++) {
      const src = raw.getChannelData(c), dst = out.getChannelData(c);
      dst.set(src.subarray(0, n));
      for (let i = 0; i < src.length - n; i++) dst[i] += src[n + i];
      let lp = 0;
      for (let i = 0; i < n; i++) { lp += .05 * ((Math.random() * 2 - 1) - lp); dst[i] += lp * .012; }
      for (let k = 0; k < BARS * BAR * 5; k++) { const at = Math.floor(Math.random() * (n - 40)), v = (Math.random() * .5 + .15) * (Math.random() < .12 ? 2.2 : 1) * .05; for (let j = 0; j < 30; j++) dst[at + j] += v * Math.exp(-j / 5) * (j % 2 ? -1 : 1); }
    }
    return out;
  }

  /* the reader: a play head that moves at `rate` (smoothed), wrapping round the loop */
  const Music = { ready: null, rate: 1, muted: false };
  let ctx, gain, data, pos = 0, cur = 0, target = 1;
  Music.ready = (async () => {
    ctx = new AudioContext({ latencyHint: "interactive" });
    data = await render(ctx.sampleRate);
    const L = data.getChannelData(0), R = data.getChannelData(1), n = L.length;
    const node = ctx.createScriptProcessor(1024, 0, 2);
    const smooth = 1 - Math.exp(-1 / (ctx.sampleRate * .035));
    node.onaudioprocess = (e) => {
      const oL = e.outputBuffer.getChannelData(0), oR = e.outputBuffer.getChannelData(1);
      for (let i = 0; i < oL.length; i++) {
        cur += (target - cur) * smooth; pos += cur; if (pos >= n) pos -= n; else if (pos < 0) pos += n;
        const i0 = Math.floor(pos), i1 = i0 + 1 >= n ? 0 : i0 + 1, fr = pos - i0;
        oL[i] = L[i0] + (L[i1] - L[i0]) * fr; oR[i] = R[i0] + (R[i1] - R[i0]) * fr;
      }
    };
    gain = ctx.createGain(); gain.gain.value = 0;
    node.connect(gain).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    gain.gain.setTargetAtTime(Music.muted ? 0 : .5, ctx.currentTime, .8);
    return true;
  })();
  Music.setRate = (r) => { target = Math.max(-4, Math.min(4, r)); };
  Music.setMuted = (m) => { Music.muted = m; if (gain) gain.gain.setTargetAtTime(m ? 0 : .5, ctx.currentTime, .12); };
  Music.wake = () => { if (ctx && ctx.state === "suspended") ctx.resume(); };
  window.Music = Music;
})();

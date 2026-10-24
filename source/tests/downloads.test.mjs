/* Checks of the download logic that has no I/O (node:test, nothing to install): `node --test tests/`
   The pool must give every track exactly one end (done or given up), whatever SoundCloud does. */
import test from "node:test";
import assert from "node:assert/strict";
import { runPool } from "../src/pool.ts";
import { credit, trustSplits } from "../src/credit.ts";
import { explain, readLink } from "../src/link.ts";
import { HUE_RANGE, hsl, trackAccent } from "../src/palette.ts";
import { albumProgress, albumTimes, audibleEnd, audibleStart, entryTrim, rmsOf, trackLookup } from "../src/bulk.ts";

const RATE = /HTTP Error (403|429)/;
const fast = { minGap: 1, maxGap: 4, firstPause: 4, longestPause: 20 };

/** runs a pool and records how every track ended */
async function play(count, work, extra = {}) {
  const ends = new Map(), starts = [];
  let inflight = 0, peak = 0;
  await runPool({
    count, ...fast, isRate: (m) => RATE.test(m), cancelled: () => false, retry() {}, pause() {},
    start: (i) => starts.push(i),
    done: (i) => ends.set(i, [...(ends.get(i) ?? []), "done"]),
    fail: (i, _m, refused) => ends.set(i, [...(ends.get(i) ?? []), refused ? "refused" : "fail"]),
    work: async (i) => { inflight++; peak = Math.max(peak, inflight); try { await work(i); } finally { inflight--; } },
    ...extra
  });
  return { ends, starts, peak };
}
const onlyOnce = (ends, count) => { for (let i = 0; i < count; i++) assert.equal(ends.get(i)?.length, 1, `track ${i} ended ${JSON.stringify(ends.get(i))}`); };

test("every track of a set that works is done, once", async () => {
  const { ends, peak } = await play(17, async () => {});
  onlyOnce(ends, 17);
  assert.ok([...ends.values()].every((e) => e[0] === "done"));
  assert.ok(peak <= 4);
});

test("a set of one, and an empty one", async () => {
  onlyOnce((await play(1, async () => {})).ends, 1);
  assert.equal((await play(0, async () => {})).ends.size, 0);
});

test("a track that fails for its own reason is given up, the rest go on", async () => {
  const { ends } = await play(12, async (i) => { if (i % 5 === 0) throw new Error("This track is not available"); });
  onlyOnce(ends, 12);
  assert.deepEqual([...ends].filter(([, e]) => e[0] === "fail").map(([i]) => i).sort((a, b) => a - b), [0, 5, 10]);
});

test("a refusal that passes is retried and the track comes through", async () => {
  const seen = new Set();
  const { ends } = await play(10, async (i) => { if (i === 3 && !seen.has(i)) { seen.add(i); throw new Error("HTTP Error 429"); } });
  onlyOnce(ends, 10);
  assert.equal(ends.get(3)[0], "done");
});

test("one track that is always refused is given up while the others finish", async () => {
  const { ends } = await play(10, async (i) => { if (i === 4) throw new Error("HTTP Error 403: Forbidden"); });
  onlyOnce(ends, 10);
  assert.equal(ends.get(4)[0], "refused");
  assert.equal([...ends.values()].filter((e) => e[0] === "done").length, 9);
});

test("when nothing gets through the pool gives up on all, and ends", async () => {
  const { ends } = await play(20, async () => { throw new Error("HTTP Error 429"); });
  onlyOnce(ends, 20);
  assert.ok([...ends.values()].every((e) => e[0] === "refused"));
});

test("cancelling stops new tracks from starting", async () => {
  let stop = false;
  const { starts } = await play(30, async (i) => { if (i === 2) stop = true; }, { cancelled: () => stop });
  assert.ok(starts.length < 30);
});

test("a work that throws a non-Error is still an end", async () => {
  const { ends } = await play(3, async () => { throw "plain string"; });
  onlyOnce(ends, 3);
});

test("credit: artist - title, and what is not a split", () => {
  assert.deepEqual(credit("boolymon - bologna 2", "archive"), { artist: "boolymon", title: "bologna 2" });
  assert.deepEqual(credit("01 - Intro", "me"), { artist: "me", title: "01 - Intro" });
  assert.deepEqual(credit("Song - Slowed + Reverb", "me"), { artist: "me", title: "Song - Slowed + Reverb" });
  assert.deepEqual(credit("whatever", "me", { artist: "A", track: "B" }), { artist: "A", title: "B" });
  assert.deepEqual(credit("", "me"), { artist: "me", title: "" });
});

test("trustSplits keeps a lone split from one uploader as posted", () => {
  const entry = (title, artist, plainTitle) => ({ artist, uploader: "u", plain: { artist: "u", title: plainTitle }, draft: { title } });
  const out = trustSplits(true, [entry("Part 2", "Intro", "Intro - Part 2"), entry("b", "u", "b")]);
  assert.equal(out[0].draft.title, "Intro - Part 2");
  assert.equal(out[0].artist, "u");
});

test("links: what is accepted is tidied, whatever it is wrapped in", () => {
  const ok = (text, url) => assert.deepEqual(readLink(text), { ok: true, url }, text);
  ok("https://soundcloud.com/artist/track", "https://soundcloud.com/artist/track");
  ok("  soundcloud.com/artist/track  ", "https://soundcloud.com/artist/track");
  ok("http://soundcloud.com/artist/track", "https://soundcloud.com/artist/track");
  ok("www.soundcloud.com/artist/sets/album", "https://www.soundcloud.com/artist/sets/album");
  ok("listen to this: https://soundcloud.com/a/b?si=1 — it's good", "https://soundcloud.com/a/b?si=1");
  ok("(https://soundcloud.com/a/b).", "https://soundcloud.com/a/b");
  ok("https://soundcloud.com/a/b#t=1:20", "https://soundcloud.com/a/b");
  ok("https://m.soundcloud.com/a/b", "https://m.soundcloud.com/a/b");
  ok("https://on.soundcloud.com/AbC123", "https://on.soundcloud.com/AbC123");
  ok("https://user:pw@soundcloud.com:8443/a/b", "https://soundcloud.com/a/b");
  ok("https://soundcloud.com/a/sets/b/s-SecretX", "https://soundcloud.com/a/sets/b/s-SecretX");
});

test("links: every wrong one says what is wrong", () => {
  const no = (text, part) => { const r = readLink(text); assert.equal(r.ok, false, text); assert.match(r.error, part, text); };
  no("", /Paste a link first/);
  no("   ", /Paste a link first/);
  no("hello there", /doesn't look like a link/);
  no("12345", /doesn't look like a link/);
  no("https://www.youtube.com/watch?v=abc", /only from SoundCloud. This link is from youtube\.com\./);
  no("https://open.spotify.com/album/x", /from open\.spotify\.com/);
  no("https://soundcloud.com.evil.com/a/b", /from soundcloud\.com\.evil\.com/);
  no("https://evilsoundcloud.com/a/b", /from evilsoundcloud\.com/);
  no("https://soundcloud.com", /home page/);
  no("https://soundcloud.com/", /home page/);
  no("https://soundcloud.com/discover", /no music of its own/);
  no("https://soundcloud.com/artist/followers", /lists people/);
  no("https://api.soundcloud.com/tracks/1", /service page/);
  no("https://on.soundcloud.com/a/b", /incomplete/);
  no("https://snd.sc/abc", /short or file link/);
  no("https://i1.sndcdn.com/artworks-x.jpg", /short or file link/);
});

test("explain: the downloader's wording becomes a sentence a person understands", () => {
  assert.match(explain("Unsupported URL: https://soundcloud.com/x"), /can't read this SoundCloud page/);
  assert.match(explain("Unable to download JSON metadata: HTTP Error 404: Not Found"), /can't find anything/);
  assert.match(explain("This track is private"), /private/i);
  assert.match(explain("<urlopen error [Errno 11001] getaddrinfo failed>"), /internet connection/);
  assert.match(explain("The downloader took too long"), /took too long/);
  assert.equal(explain("something nobody planned for"), "something nobody planned for");
});

/* ---------------------------------------------------------------- a very long list */
const MILLION = 1_000_000;
const timed = async (fn) => { const t0 = performance.now(); const out = await fn(); return { out, ms: performance.now() - t0 }; };

test("a million tracks go through the pool, each ends once, and it takes seconds, not minutes", async () => {
  const ends = new Uint8Array(MILLION);
  let twice = 0;
  const { ms } = await timed(() => runPool({
    count: MILLION, parallel: 4, minGap: 0, maxGap: 0, isRate: () => false, cancelled: () => false, retry() {}, pause() {}, start() {},
    done: (i) => { if (ends[i]++) twice++; }, fail: (i) => { if (ends[i]++) twice++; },
    work: async (i) => { if (i % 1000 === 7) throw new Error("This track is not available"); }
  }));
  assert.equal(twice, 0);
  assert.equal(ends.reduce((a, b) => a + (b === 1 ? 1 : 0), 0), MILLION);
  assert.ok(ms < 20_000, "took " + Math.round(ms) + " ms");
});

test("a million lookups in a record of a million tracks are instant (the old linear search would not finish)", async () => {
  const tracks = Array.from({ length: MILLION }, (_, i) => ({ id: "t" + i, albumId: "a", index: i, title: "T" + i, duration: 200, filePath: "x" }));
  const album = { id: "a", title: "A", artist: "X", tracks };
  const find = trackLookup([album, { id: "b", tracks: [] }]);
  const { out, ms } = await timed(() => { let hits = 0; for (let i = 0; i < MILLION; i++) if (find("a", "t" + i)?.track.id === "t" + i) hits++; return hits; });
  assert.equal(out, MILLION);
  assert.equal(find("a", "nope"), undefined);
  assert.equal(find("zzz", "t1"), undefined);
  assert.ok(ms < 8_000, "took " + Math.round(ms) + " ms");
});

test("album progress: right at the ends, and cheap to ask on every frame for a million tracks", () => {
  const tracks = Array.from({ length: MILLION }, () => ({ duration: 100 }));
  const album = { tracks };
  albumTimes(album);                                        // the one-off sum
  const t0 = performance.now();
  let last = 0;
  for (let i = 0; i < 100_000; i++) last = albumProgress(album, MILLION - 1, 50);
  assert.ok(performance.now() - t0 < 200, "100 000 frames took " + Math.round(performance.now() - t0) + " ms");
  assert.ok(last > .999999 && last <= 1);
  assert.equal(albumProgress(album, 0, 0), 0);
  assert.equal(albumProgress(album, -5, 0), 0);                              // a bad index does not break the bar
  assert.equal(albumProgress({ tracks: [] }, 0, 0), 0);                      // an empty record is not NaN
  assert.equal(albumProgress({ tracks: [{ duration: 0 }] }, 0, 0), 0);       // a track with no length counts one second
  assert.equal(albumProgress({ tracks: [{ duration: 100 }, { duration: 100 }] }, 1, 50), .75);
});

test("trustSplits and credit stay linear on a million tracks", () => {
  const got = Array.from({ length: MILLION }, (_, i) => ({ artist: "Artist " + (i % 5000), uploader: "u", plain: { artist: "u", title: "t" + i }, draft: { title: "t" + i } }));
  const t0 = performance.now();
  const out = trustSplits(true, got);
  assert.equal(out.length, MILLION);
  for (let i = 0; i < 100_000; i++) credit("Artist " + i + " - Title " + i, "someone");
  assert.ok(performance.now() - t0 < 10_000, "took " + Math.round(performance.now() - t0) + " ms");
});

test("links: a huge pasted text and odd characters do not hang or throw", () => {
  const t0 = performance.now();
  assert.equal(readLink("x ".repeat(500_000)).ok, false);
  assert.equal(readLink("https://soundcloud.com/" + "a".repeat(100_000)).ok, true);
  for (const odd of ["https://", "http://:", "https://soundcloud.com:abc/x", " ", "https://[::1", "%%%", "https://soundcloud.com/a b", "https://sound​cloud.com/x"]) readLink(odd);
  assert.ok(performance.now() - t0 < 3_000);
});

test("audibleEnd: a silent tail is not counted, a quiet tail and a clean end are left alone", () => {
  const rate = 1000, tone = (seconds, level = .5) => Float32Array.from({ length: seconds * rate }, (_, i) => Math.sin(i / 7) * level);
  const silence = (seconds) => new Float32Array(seconds * rate);
  const join = (...parts) => Float32Array.from(parts.flatMap((p) => [...p]));
  const near = (a, b) => Math.abs(a - b) < .06;
  assert.ok(near(audibleEnd([join(tone(10), silence(6))], rate), 10));                       // 6 s of silence after the music
  assert.ok(near(audibleEnd([join(tone(10), silence(6)), join(tone(9), silence(7))], rate), 10));   // either channel counts
  assert.equal(audibleEnd([tone(10)], rate), 10);                                           // no tail
  assert.equal(audibleEnd([join(tone(10), silence(0.3))], rate), 10.3);                     // a short gap is not worth moving for
  assert.ok(near(audibleEnd([join(tone(10), tone(3, .01))], rate), 13));                    // a quiet tail (-40 dB) is still music
  assert.equal(audibleEnd([silence(60)], rate), 60);                                        // nothing audible: keep the file's end
  assert.equal(audibleEnd([], rate), 0);
  const long = join(tone(5), silence(100));
  assert.equal(audibleEnd([long], rate), 105);                                              // silence longer than the scan: no verdict
});

test("audibleStart: digital silence at the front is skipped, a quiet intro is not", () => {
  const rate = 1000, tone = (seconds, level = .5) => Float32Array.from({ length: seconds * rate }, (_, i) => Math.sin(i / 7) * level);
  const silence = (seconds) => new Float32Array(seconds * rate);
  const join = (...parts) => Float32Array.from(parts.flatMap((p) => [...p]));
  const near = (a, b) => Math.abs(a - b) < .12;
  assert.ok(near(audibleStart([join(silence(3), tone(5))], rate), 3));      // 3 s of nothing, then music (minus the run-in)
  assert.equal(audibleStart([tone(5)], rate), 0);                           // starts at once
  assert.equal(audibleStart([join(silence(0.3), tone(5))], rate), 0);       // a short gap is left alone
  assert.equal(audibleStart([join(tone(3, .01), tone(3))], rate), 0);       // a quiet intro (-40 dB) is music: not skipped
  assert.equal(audibleStart([silence(30)], rate), 0);                       // all silent: no verdict
  assert.equal(audibleStart([], rate), 0);
});

test("entryTrim: a louder track comes in turned down, never boosted, never to nothing", () => {
  assert.equal(entryTrim(.2, .2), 1);
  assert.equal(entryTrim(.2, .1), 1);                       // the new one is quieter: left alone
  assert.equal(entryTrim(.2, .21), 1);                      // within a dB
  assert.ok(Math.abs(entryTrim(.1, .2) - .5) < 1e-9);       // twice as loud: half
  assert.equal(entryTrim(.01, .5), .4);                     // way louder: no more than about 8 dB down
  assert.equal(entryTrim(0, .5), 1);                        // unknown level: no change
  assert.equal(entryTrim(.2, NaN), 1);
  assert.ok(Math.abs(rmsOf([Float32Array.from({ length: 1000 }, () => .5)], 1000, 0, 1) - .5) < 1e-6);
  assert.equal(rmsOf([], 1000, 0, 1), 0);
});

test("palette: every track keeps the tone of its album, a grey cover stays grey", () => {
  const toHue = ([r, g, b]) => { const max = Math.max(r, g, b), min = Math.min(r, g, b); if (max === min) return null; const d = max - min; const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const dist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  for (const hue of [5, 120, 215, 300, 350]) for (let i = 0; i < 40; i++) {
    const { main, light } = trackAccent(hue, .12, i);
    assert.ok(dist(toHue(main), hue) <= HUE_RANGE + 2, `hue ${hue} track ${i}: ${toHue(main)}`);
    assert.ok(dist(toHue(light), hue) <= HUE_RANGE + 2);
  }
  for (let i = 0; i < 10; i++) { const { main, light } = trackAccent(40, .01, i); assert.equal(main[0], main[1]); assert.equal(main[1], main[2]); assert.equal(light[0], light[2]); }
  const tones = new Set(Array.from({ length: 8 }, (_, i) => trackAccent(215, .12, i).main.join()));
  assert.ok(tones.size >= 5, "neighbouring tracks are told apart");
  assert.deepEqual(hsl(0, 100, 50), [255, 0, 0]);
});

test("palette: in a light room the animation is drawn in ink (dark), not in light", () => {
  const lum = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
  for (const [hue, chroma] of [[20, .12], [210, .09], [40, .01]]) for (let i = 0; i < 12; i++) {
    const ink = trackAccent(hue, chroma, i, true), glow = trackAccent(hue, chroma, i, false);
    assert.ok(lum(ink.main) < 130 && lum(ink.light) < 110, `ink is dark: ${ink.main} ${ink.light}`);
    assert.ok(lum(ink.main) < lum(glow.main));
  }
});

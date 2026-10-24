import { audio } from "./audio";
import { fetchLyrics } from "./api";
import { parseLrc } from "./lyrics";
import { readLyrics } from "./library";
import { activeAlbum, useApp } from "./state";
import { settings, updateSettings } from "./settings";
import { t } from "./lang";
import type { Album, RepeatMode, ShuffleMode, Track, TransportPhase } from "./types";

let generation = 0;
let pendingIndex: number | null = null;
/** true from "back to the crate" until the next album starts: nothing may start playing meanwhile */
let leaving = false;
/** pause pressed while the arm was travelling to a track: land, but stay paused */
let holdAfterCue = false;
const state = () => useApp.getState();
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const phase = (value: TransportPhase) => useApp.setState({ phase: value, playing: value === "PLAYING" });
const valid = (id: number) => id === generation && !leaving && useApp.getState().screen === "player";
/** a track that would not play: the needle noise stops with it, and the transport does not hang half-way */
function failed(error: unknown): void {
  audio.surface(0);
  phase("STOPPED");
  useApp.setState({ message: error instanceof Error ? error.message : t("Playback failed") });
}

/* ---------------------------------------------------------------- shuffle and repeat
   Shuffle plays every track once in a random order (a "bag" that is emptied, then refilled when repeat is on),
   inside the record on the deck ("album") or across the whole library ("all": the mini player and the tray).
   `history` is what was played, so ◀◀ steps back through it. */
interface Slot { albumId: string; index: number }
let bag: Slot[] = [];
let bagKey = "";
let history: Slot[] = [];
const sameSlot = (a: Slot | null, b: Slot | null) => !!a && !!b && a.albumId === b.albumId && a.index === b.index;
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
/** Every track of the library. Shuffling "all" leaves the playlists out: their tracks are already in their albums. */
function libraryTracks(withPlaylists = false): Slot[] {
  return useApp.getState().albums.filter((album) => withPlaylists || album.kind !== "playlist")
    .flatMap((album) => album.tracks.map((_, index) => ({ albumId: album.id, index })));
}
/** the track the player is on, or is travelling to */
function hereSlot(): Slot | null {
  const id = state().activeAlbumId;
  return id ? { albumId: id, index: currentTarget() } : null;
}
function fillBag(from: Slot | null, force = false): void {
  const mode = state().shuffle;
  const key = mode + "|" + (mode === "album" ? state().activeAlbumId : state().albums.length);
  const changed = key !== bagKey;
  if (!changed && !force) return;
  bagKey = key;
  if (changed && mode === "album") history = [];      // another record: its own round, its own way back
  const pool = mode === "album" ? libraryTracks(true).filter((slot) => slot.albumId === state().activeAlbumId) : libraryTracks();
  bag = shuffled(pool.filter((slot) => !sameSlot(slot, from)));
}
/** The next track in shuffle order, without taking it; null when the round is over (and repeat is not on). */
function peekShuffled(): Slot | null {
  const from = hereSlot();
  fillBag(from);
  const exists = (slot: Slot) => !!state().albums.find((album) => album.id === slot.albumId)?.tracks[slot.index];
  while (bag.length && (sameSlot(bag[0], from) || !exists(bag[0]))) bag.shift();   // a track picked by hand, or a deleted record
  if (!bag.length) {
    if (state().repeat !== "all") return null;
    fillBag(from, true);
    return bag[0] ?? from;                  // a library of one track: the same one again
  }
  return bag[0];
}
function preloadNext(album: Album, index: number): void {
  // after the last track, repeat-all goes back to the first: that one is made ready too
  const after = index + 1 < album.tracks.length ? index + 1 : state().repeat === "all" ? 0 : -1;
  const slot = state().shuffle === "off" ? (after >= 0 ? { albumId: album.id, index: after } : null) : peekShuffled();
  const track = slot && state().albums.find((item) => item.id === slot.albumId)?.tracks[slot.index];
  if (track) void audio.preload(track.filePath);
}
/** Play a slot: another track of this record moves the arm; another record is swapped onto the deck in place
    (the way the search does it), which is also how the mini player and the tray start a record. */
function goTo(slot: Slot, from: Slot | null): void {
  const s = state();
  const album = s.albums.find((item) => item.id === slot.albumId);
  if (!album?.tracks[slot.index]) return;
  if (from) { history.push(from); if (history.length > 300) history.shift(); }
  if (slot.albumId === s.activeAlbumId) { void cueTrack(slot.index); return; }
  if (s.screen === "import" || s.screen === "playlist" || s.transitionBusy) return;
  audio.stopMusic();
  useApp.setState({ section: "albums", screen: "player" });
  void startAlbumNow(album, .25, slot.index);
}
export function setShuffle(mode: ShuffleMode): void {
  history = []; bag = []; bagKey = "";
  useApp.setState({ shuffle: mode });
  void updateSettings({ shuffle: mode });
  const s = state();
  if (mode === "off") return;
  if (mode === "all" && (!s.activeAlbumId || s.phase === "STOPPED") && !s.transitionBusy) {
    // nothing on the deck: "shuffle everything" starts something
    const slot = shuffled(libraryTracks())[0];
    if (slot) goTo(slot, null);
    return;
  }
  const album = activeAlbum();
  if (album) preloadNext(album, s.trackIndex);
}
export const toggleShuffleAlbum = () => setShuffle(state().shuffle === "album" ? "off" : "album");
/** The mini player's one shuffle key: off → this album → the whole library → off (no album on the tape: off ↔ library). */
export function cycleShuffle(): void {
  const s = state();
  const order: ShuffleMode[] = s.activeAlbumId ? ["off", "album", "all"] : ["off", "all"];
  setShuffle(order[(order.indexOf(s.shuffle) + 1) % order.length]);
}
export const toggleShuffleAll = () => setShuffle(state().shuffle === "all" ? "off" : "all");
export function setRepeat(mode: RepeatMode): void {
  useApp.setState({ repeat: mode });
  void updateSettings({ repeat: mode });
}
export const cycleRepeat = () => setRepeat(({ off: "all", all: "one", one: "off" } as const)[state().repeat]);
export { albumProgress, albumTimes } from "./bulk";
async function lyricsFor(track: Track, album: Album, id: number): Promise<void> {
  useApp.setState({ lyrics: { mode: "loading", lines: [], plain: "" } });
  // an answer may come back after the next track has started: it must not land on that one
  const current = () => valid(id) && useApp.getState().activeAlbumId === album.id && activeAlbum()?.tracks[useApp.getState().trackIndex]?.id === track.id;
  try {
    let raw = "", source = "";
    if (track.lyricsPath) {
      raw = await readLyrics(track.lyricsPath);
      source = "local .lrc";
    } else {
      // one retry: a dropped connection should not cost the whole track its lyrics
      const result = await fetchLyrics(track, album).catch(() => delay(1500).then(() => fetchLyrics(track, album)));
      raw = result.syncedLyrics || result.plainLyrics || "";
      source = raw ? "LRCLIB" : "";
    }
    if (!current()) return;
    const lines = parseLrc(raw);
    useApp.setState({ lyrics: lines.length ? { mode: "synced", lines, plain: "", source } :
      raw.trim() ? { mode: "plain", lines: [], plain: raw.trim(), source } :
      { mode: "none", lines: [], plain: "" } });
  } catch {
    if (current()) useApp.setState({ lyrics: { mode: "none", lines: [], plain: "" } });
  }
}
async function playTrack(index: number, id: number, offset = 0, fullSpeed = false): Promise<void> {
  const album = activeAlbum();
  const track = album?.tracks[index];
  if (!album || !track || !valid(id)) return;
  useApp.setState({ trackIndex: index, duration: track.duration, position: offset, message: "" });
  void lyricsFor(track, album, id);
  try {
    await audio.load(track.filePath, offset);
    if (!valid(id)) return;
    await audio.play(fullSpeed);
    if (!valid(id)) return;
    audio.surface(.006);
    phase("PLAYING");
    preloadNext(album, index);
  } catch (error) {
    if (valid(id)) failed(error);
  }
}
export async function startAlbum(album: Album): Promise<void> {
  const id = ++generation, began = performance.now();
  leaving = false; holdAfterCue = false;
  audio.stopPreview(true);
  audio.stopMusic();
  useApp.setState({ activeAlbumId: album.id, trackIndex: 0, position: 0, duration: album.tracks[0]?.duration || 0, cueLifted: false });
  if (!album.tracks.length) { phase("STOPPED"); return; }
  const loading = audio.load(album.tracks[0].filePath);
  try { await audio.unlock(); }
  catch (error) { useApp.setState({ message: String(error) }); return; }
  audio.targetSpeed = 1;
  audio.sound("motor");
  phase("SPINNING_UP");
  await delay(80); if (!valid(id)) return;
  phase("CUEING_IN");
  await delay(770); if (!valid(id)) return;
  phase("LEAD_IN");
  await delay(300); if (!valid(id)) return;
  audio.sound("needle");
  audio.surface(.021, .03);
  await delay(350); if (!valid(id)) return;
  try {
    await loading;
    if (!valid(id)) return;
    await audio.play();
    phase("PLAYING");
    audio.surface(.006);
    console.info("Music started after", Math.round(performance.now() - began), "ms");
    preloadNext(album, 0);
    void lyricsFor(album.tracks[0], album, id);
  } catch (error) {
    if (valid(id)) failed(error);
  }
}
/** Start the album at once (the tap on the record is the user gesture): needle already on its way,
    music at full speed with a short fade-in. The decode was preloaded when the record was picked. */
export async function startAlbumNow(album: Album, fadeIn: number, index = 0): Promise<void> {
  const id = ++generation;
  leaving = false; holdAfterCue = false;
  audio.stopPreview(true);
  useApp.setState({ activeAlbumId: album.id, trackIndex: index, position: 0, duration: album.tracks[index]?.duration || 0, cueLifted: false });
  const first = album.tracks[index];
  if (!first) { phase("STOPPED"); return; }
  phase("PLAYING");
  try {
    await audio.unlock();
    audio.sound("needle");
    await audio.load(first.filePath);
    if (!valid(id)) return;
    await audio.play(true, fadeIn);
    audio.surface(.006);
    void lyricsFor(first, album, id);
    preloadNext(album, index);
  } catch (error) {
    if (valid(id)) failed(error);
  }
}
export async function cueTrack(index: number, position = 0): Promise<void> {
  const album = activeAlbum();
  const track = album?.tracks[index];
  if (!album || !track) return;
  const id = ++generation, began = performance.now();
  pendingIndex = index;
  leaving = false;                          // picking a track (e.g. after the album ran out) is a fresh start
  useApp.setState({ cueLifted: false });
  const distance = Math.abs(index - useApp.getState().trackIndex) / Math.max(1, album.tracks.length - 1);
  const travel = 400 + 500 * distance;
  audio.fadeMusic(0, .12);
  audio.sound("cue");
  phase("CUEING_IN");
  await delay(150); if (!valid(id)) return;
  // tag duration first; load() then replaces it with the decoded one (tags can be wrong — a seek past the
  // real end would skip to the next track)
  useApp.setState({ trackIndex: index, position, duration: track.duration });
  const loading = audio.load(track.filePath, position);
  await delay(travel); if (!valid(id)) return;
  phase("LEAD_IN");
  await delay(250); if (!valid(id)) return;
  audio.sound("needle");
  audio.surface(.021, .03);
  try {
    await loading;
    if (!valid(id)) return;
    if (holdAfterCue) {
      holdAfterCue = false;
      audio.holdPaused();
      phase("PAUSED");
      void lyricsFor(track, album, id);
      return;
    }
    await audio.play(true);
    audio.surface(.006);
    phase("PLAYING");
    console.info("Track changed after", Math.round(performance.now() - began), "ms");
    void lyricsFor(track, album, id);
    preloadNext(album, index);
  } catch (error) {
    if (valid(id)) failed(error);
  }
}
export function pauseOrResume(): void {
  const state = useApp.getState();
  if (state.cueLifted) { void lowerCue(); return; }
  if (state.phase === "PLAYING") {
    audio.pause();
    phase("PAUSED");
  } else if (state.phase === "PAUSED") {
    void audio.play().then(() => phase("PLAYING")).catch((error) => useApp.setState({ message: String(error) }));
  } else if (state.phase === "CUEING_IN" || state.phase === "LEAD_IN") {
    holdAfterCue = !holdAfterCue;           // the arm is on its way: decide whether it lands playing or paused
  } else if (state.phase === "STOPPED") {
    const album = activeAlbum();
    if (album && state.screen === "player") void startAlbumNow(album, .3);
  }
}
export async function lowerCue(): Promise<void> {
  try { await audio.lowerCue(); useApp.setState({ cueLifted: false }); phase("PLAYING"); }
  catch (error) { useApp.setState({ message: String(error) }); }
}
export function toggleCue(): void {
  if (useApp.getState().cueLifted) { void lowerCue(); return; }
  if (useApp.getState().phase !== "PLAYING") { pauseOrResume(); return; }
  audio.liftCue();
  useApp.setState({ cueLifted: true });
  phase("PAUSED");
}
export async function stopAlbum(): Promise<void> {
  const id = ++generation;
  leaving = true; holdAfterCue = false;
  audio.pause();
  useApp.setState({ cueLifted: false });
  phase("CUEING_OUT");
  await delay(700);
  if (id !== generation) return;
  audio.stopMusic();
  phase("STOPPED");
}
/** The track the arm is already travelling to (so quick repeated next/prev clicks add up). */
const currentTarget = () => useApp.getState().phase === "CUEING_IN" && pendingIndex !== null ? pendingIndex : useApp.getState().trackIndex;
export function nextTrack(): void {
  const album = activeAlbum();
  if (!album || leaving) return;            // a track ending while we leave for the crate must not start the next
  const from = currentTarget();
  if (state().phase === "CUEING_OUT") return;
  if (state().shuffle !== "off") {
    const slot = peekShuffled();
    if (!slot) { void stopAlbum(); return; }
    const here = hereSlot();
    bag = bag.filter((item) => !sameSlot(item, slot));
    goTo(slot, here);
    return;
  }
  if (from + 1 < album.tracks.length) void cueTrack(from + 1);
  else if (state().repeat === "all") void cueTrack(0);
  else void stopAlbum();
}
/** Crossfade: shortly before the end of a track the next one of the same record starts under it, with no arm travel in
    between. Anything else (repeat one, another record in shuffle-all, the last track, the next one not decoded yet)
    is left to the ordinary way. True when the next track has begun. */
function crossfadeNext(seconds: number): boolean {
  const s = state(), album = activeAlbum();
  if (!album || leaving || s.phase !== "PLAYING" || s.cueLifted || s.transitionBusy || s.repeat === "one") return false;
  // a record that is meant to be heard as it was made plays gapless, if the setting says so (in a shuffled order there is no "as made")
  if (album.kind !== "playlist" && s.shuffle === "off" && !settings().crossfadeAlbums) return false;
  let slot: Slot | null;
  if (s.shuffle !== "off") slot = peekShuffled();
  else {
    const next = s.trackIndex + 1;
    slot = next < album.tracks.length ? { albumId: album.id, index: next } : s.repeat === "all" && album.tracks.length > 1 ? { albumId: album.id, index: 0 } : null;
  }
  if (!slot || slot.albumId !== album.id) return false;
  const track = album.tracks[slot.index];
  const length = track ? audio.crossfadeTo(track.filePath, seconds) : 0;
  if (!track || !length) return false;
  if (s.shuffle !== "off") {
    const here = hereSlot();
    bag = bag.filter((item) => !sameSlot(item, slot));
    if (here) { history.push(here); if (history.length > 300) history.shift(); }
  }
  const id = ++generation;
  pendingIndex = null;
  // the position and the length come from the audio; `fade` is what the spiral draws
  const fade = { from: s.trackIndex, to: slot.index, start: performance.now(), length, fromPos: s.position, fromDur: s.duration, lyrics: s.lyrics };
  useApp.setState({ trackIndex: slot.index, message: "", fade });
  // the animation clears it when it is done; with the animation off (or another screen open) nothing would, and a stale fade would stay
  window.setTimeout(() => { if (useApp.getState().fade === fade) useApp.setState({ fade: null }); }, (length + 3) * 1000);
  void lyricsFor(track, album, id);
  preloadNext(album, slot.index);
  return true;
}
audio.onNearEnd = crossfadeNext;
/** A track that ran to its end: repeat-one plays it again at once (no arm travel), otherwise on to the next. */
audio.onEnded = () => {
  if (leaving) return;
  if (state().repeat === "one" && activeAlbum()) { void playTrack(state().trackIndex, ++generation, 0, true); return; }
  nextTrack();
};
export function previousTrack(): void {
  const s = useApp.getState();
  if (s.phase !== "CUEING_IN" && s.position > 3) { audio.seek(0); return; }
  if (s.shuffle !== "off") {
    // back through what was played; the track left behind becomes the next one again
    const slot = history.pop();
    if (!slot) { audio.seek(0); return; }
    const here = hereSlot();
    if (here) bag.unshift(here);
    goTo(slot, null);
    return;
  }
  void cueTrack(Math.max(0, currentTarget() - 1));
}
export function seek(seconds: number): void { audio.seek(seconds); }
export async function seekAlbumProgress(progress: number): Promise<void> {
  const album = activeAlbum();
  if (!album) return;
  const total = album.tracks.reduce((sum, track) => sum + Math.max(track.duration, 1), 0);
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < album.tracks.length; index++) {
    const duration = Math.max(album.tracks[index].duration, 1);
    if (remaining < duration || index === album.tracks.length - 1) {
      await cueTrack(index, Math.min(remaining, duration - .1));
      return;
    }
    remaining -= duration;
  }
}


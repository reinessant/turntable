import { audio } from "./audio";
import { fetchLyrics } from "./api";
import { parseLrc } from "./lyrics";
import { readLyrics } from "./library";
import { activeAlbum, useApp } from "./state";
import type { Album, Track, TransportPhase } from "./types";

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
export function albumProgress(album: Album, index: number, position: number): number {
  const total = album.tracks.reduce((sum, track) => sum + Math.max(track.duration, 1), 0);
  const before = album.tracks.slice(0, index).reduce((sum, track) => sum + Math.max(track.duration, 1), 0);
  return Math.min(1, (before + position) / total);
}
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
    const next = album.tracks[index + 1];
    if (next) void audio.preload(next.filePath);
  } catch (error) {
    if (valid(id)) useApp.setState({ message: error instanceof Error ? error.message : "Playback failed" });
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
    const next = album.tracks[1];
    if (next) void audio.preload(next.filePath);
    void lyricsFor(album.tracks[0], album, id);
  } catch (error) {
    if (valid(id)) useApp.setState({ message: error instanceof Error ? error.message : "Playback failed" });
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
    const next = album.tracks[index + 1];
    if (next) void audio.preload(next.filePath);
  } catch (error) {
    if (valid(id)) {
      phase("STOPPED");
      useApp.setState({ message: error instanceof Error ? error.message : "Playback failed" });
    }
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
    const next = album.tracks[index + 1];
    if (next) void audio.preload(next.filePath);
  } catch (error) {
    if (valid(id)) useApp.setState({ message: error instanceof Error ? error.message : "Playback failed" });
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
  if (from + 1 < album.tracks.length) void cueTrack(from + 1);
  else void stopAlbum();
}
audio.onEnded = nextTrack;
export function previousTrack(): void {
  const state = useApp.getState();
  if (state.phase !== "CUEING_IN" && state.position > 3) audio.seek(0);
  else void cueTrack(Math.max(0, currentTarget() - 1));
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


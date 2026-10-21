/* Listening stats. Once a second, while a record is really playing (not paused, not scratched), the second is
   added to the track, its album, the artist, the genres, the day, the hour of the day and the weekday. A "play"
   counts once a track has been heard for 30 s (or half of it, for a short one); leaving a track early is a skip.
   Everything is kept in stats.json next to the library and is only ever added to — the names are stored with the
   numbers, so deleting an album does not erase its history. */
import { isTauri } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { audio } from "./audio";
import { activeAlbum, useApp } from "./state";
import type { Album } from "./types";

export interface AlbumStat { title: string; artist: string; sec: number; plays: number; genres: string[]; playlist?: boolean }
export interface TrackStat { title: string; artist: string; album: string; albumId: string; sec: number; plays: number; skips: number }
export interface StatsData {
  v: 1;
  /** when counting began */
  since: number;
  /** seconds listened, and the plays (see above) */
  total: number;
  plays: number;
  skips: number;
  /** tracks heard right to the end */
  finished: number;
  /** the longest unbroken listening session, in seconds (a session ends after ten quiet minutes), and how many there were */
  bestSession: number;
  sessions: number;
  days: Record<string, number>;
  /** seconds per hour of the day (0–23) and per weekday (Monday first) */
  hours: number[];
  weekdays: number[];
  albums: Record<string, AlbumStat>;
  tracks: Record<string, TrackStat>;
  artists: Record<string, number>;
  genres: Record<string, number>;
  /** seconds heard through playlists, and per playlist */
  viaPlaylists: number;
  playlists: Record<string, { title: string; sec: number; plays: number }>;
}
const empty = (): StatsData => ({
  v: 1, since: Date.now(), total: 0, plays: 0, skips: 0, finished: 0, bestSession: 0, sessions: 0, days: {},
  hours: Array(24).fill(0), weekdays: Array(7).fill(0), albums: {}, tracks: {}, artists: {}, genres: {}, viaPlaylists: 0, playlists: {}
});

/** What the stats screen reads. It is refreshed at most every couple of seconds, and only while the screen is open. */
export const useStats = create<{ data: StatsData; loaded: boolean }>(() => ({ data: empty(), loaded: false }));

const LOCAL_KEY = "turntable.stats";
let storeFile: Awaited<ReturnType<typeof load>> | null = null;
const store = async () => storeFile ??= await load("stats.json", { autoSave: false });
let data: StatsData = empty();
let dirty = false, lastSave = 0, lastPublish = 0;

const dayKey = (date: Date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
export const dayOf = dayKey;

function publish(force = false): void {
  const now = Date.now();
  if (!force && now - lastPublish < 2000) return;
  lastPublish = now;
  useStats.setState({ data: structuredClone(data), loaded: true });
}
async function save(): Promise<void> {
  if (!dirty) return;
  dirty = false; lastSave = Date.now();
  try {
    if (isTauri()) { const file = await store(); await file.set("stats", data); await file.save(); }
    else localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch { dirty = true; }
}
/** Whatever the file holds, made into a well-formed StatsData: a damaged or hand-edited file must not take the screen down. */
function sanitize(raw: unknown): StatsData {
  const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  const rec = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const s = rec(raw), out = empty();
  out.since = num(s.since) > 946684800000 ? num(s.since) : out.since;      // anything before 2000 is not a date
  for (const key of ["total", "plays", "skips", "finished", "bestSession", "sessions", "viaPlaylists"] as const) out[key] = num(s[key]);
  for (const [key, value] of Object.entries(rec(s.days))) if (/^\d{4}-\d{2}-\d{2}$/.test(key) && num(value)) out.days[key] = num(value);
  const hours = Array.isArray(s.hours) ? s.hours : [], weekdays = Array.isArray(s.weekdays) ? s.weekdays : [];
  out.hours = out.hours.map((_, i) => num(hours[i]));
  out.weekdays = out.weekdays.map((_, i) => num(weekdays[i]));
  for (const group of ["artists", "genres"] as const) for (const [key, value] of Object.entries(rec(s[group]))) if (num(value)) out[group][key] = num(value);
  for (const [key, value] of Object.entries(rec(s.albums))) {
    const a = rec(value);
    out.albums[key] = { title: text(a.title), artist: text(a.artist), sec: num(a.sec), plays: num(a.plays), genres: strings(a.genres) };
  }
  for (const [key, value] of Object.entries(rec(s.tracks))) {
    const t = rec(value);
    out.tracks[key] = { title: text(t.title), artist: text(t.artist), album: text(t.album), albumId: text(t.albumId), sec: num(t.sec), plays: num(t.plays), skips: num(t.skips) };
  }
  for (const [key, value] of Object.entries(rec(s.playlists))) {
    const p = rec(value);
    out.playlists[key] = { title: text(p.title), sec: num(p.sec), plays: num(p.plays) };
  }
  return out;
}
async function read(): Promise<StatsData> {
  try {
    const saved = isTauri() ? await (await store()).get<StatsData>("stats") : JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (saved && typeof saved === "object") return sanitize(saved);
  } catch { /* nothing kept yet, or unreadable: start again */ }
  return empty();
}

/** `extra` added onto `base` (what was counted before the stored file had been read). */
function merge(base: StatsData, extra: StatsData): StatsData {
  const out: StatsData = structuredClone(base);
  out.since = Math.min(base.since, extra.since);
  out.total += extra.total; out.plays += extra.plays; out.skips += extra.skips; out.finished += extra.finished;
  out.sessions += extra.sessions; out.bestSession = Math.max(base.bestSession, extra.bestSession); out.viaPlaylists += extra.viaPlaylists;
  for (const [key, sec] of Object.entries(extra.days)) bump(out.days, key, sec);
  extra.hours.forEach((sec, i) => { out.hours[i] += sec; });
  extra.weekdays.forEach((sec, i) => { out.weekdays[i] += sec; });
  for (const [key, sec] of Object.entries(extra.artists)) bump(out.artists, key, sec);
  for (const [key, sec] of Object.entries(extra.genres)) bump(out.genres, key, sec);
  for (const [key, a] of Object.entries(extra.albums)) { const o = out.albums[key]; out.albums[key] = o ? { ...a, sec: o.sec + a.sec, plays: o.plays + a.plays } : a; }
  for (const [key, t] of Object.entries(extra.tracks)) { const o = out.tracks[key]; out.tracks[key] = o ? { ...t, sec: o.sec + t.sec, plays: o.plays + t.plays, skips: o.skips + t.skips } : t; }
  for (const [key, p] of Object.entries(extra.playlists)) { const o = out.playlists[key]; out.playlists[key] = o ? { ...p, sec: o.sec + p.sec, plays: o.plays + p.plays } : p; }
  return out;
}

/* ---------------------------------------------------------------- counting */
interface Run { key: string; sec: number; counted: boolean; lastPosition: number; duration: number }
let run: Run | null = null;
let lastTick = 0, lastActive = 0, sessionSec = 0;

/** `skippable`: the run ended because the listener moved on (not because the record was stopped or put back). */
function endRun(skippable = true): void {
  if (!run) return;
  const stat = data.tracks[run.key];
  const heardToTheEnd = run.duration > 0 && run.lastPosition >= run.duration - 3;
  if (stat) {
    if (heardToTheEnd) data.finished++;
    // left within the first half-minute, and not because it ended: a skip
    else if (skippable && run.sec >= 1 && run.sec < Math.min(30, run.duration * .5 || 30)) { stat.skips++; data.skips++; }
    dirty = true;
  }
  run = null;
}

function bump(map: Record<string, number>, key: string, seconds: number): void { map[key] = (map[key] ?? 0) + seconds; }

function count(seconds: number): void {
  const state = useApp.getState();
  const album = activeAlbum();
  const track = album?.tracks[state.trackIndex];
  if (!album || !track) return;
  const sourceId = track.sourceAlbumId ?? album.id;
  const source: Album = state.albums.find((item) => item.id === sourceId) ?? album;
  const artist = track.artist ?? album.artist, albumTitle = track.albumTitle ?? album.title;
  const key = sourceId + "/" + track.id;
  const now = new Date();

  // a new run: another track, or the same one started over (repeat, or a wind back to the start)
  const restarted = run && run.key === key && state.position < run.lastPosition - 5;
  if (!run || run.key !== key || restarted) { endRun(); run = { key, sec: 0, counted: false, lastPosition: state.position, duration: track.duration || state.duration }; }
  run.sec += seconds; run.lastPosition = state.position; run.duration = state.duration || track.duration;

  // sessions: ten quiet minutes end one
  if (!lastActive || Date.now() - lastActive > 10 * 60 * 1000) { data.sessions++; sessionSec = 0; }
  lastActive = Date.now(); sessionSec += seconds;
  data.bestSession = Math.max(data.bestSession, sessionSec);

  data.total += seconds;
  bump(data.days, dayKey(now), seconds);
  data.hours[now.getHours()] += seconds;
  data.weekdays[(now.getDay() + 6) % 7] += seconds;
  bump(data.artists, artist, seconds);
  for (const genre of source.genres ?? []) bump(data.genres, genre, seconds);

  const albumStat = data.albums[sourceId] ??= { title: source.title, artist: source.artist, sec: 0, plays: 0, genres: source.genres ?? [] };
  albumStat.title = source.title; albumStat.artist = source.artist; albumStat.genres = source.genres ?? []; albumStat.sec += seconds;
  const trackStat = data.tracks[key] ??= { title: track.title, artist, album: albumTitle, albumId: sourceId, sec: 0, plays: 0, skips: 0 };
  trackStat.title = track.title; trackStat.sec += seconds;
  let playlistStat: StatsData["playlists"][string] | null = null;
  if (album.kind === "playlist") {
    data.viaPlaylists += seconds;
    playlistStat = data.playlists[album.id] ??= { title: album.title, sec: 0, plays: 0 };
    playlistStat.title = album.title; playlistStat.sec += seconds;
  }
  if (!run.counted && run.sec >= Math.min(30, (run.duration || 60) * .5)) {
    run.counted = true; data.plays++; albumStat.plays++; trackStat.plays++;
    if (playlistStat) playlistStat.plays++;
  }
  dirty = true;
}

function tick(): void {
  const now = performance.now(), elapsed = lastTick ? Math.min(2.5, (now - lastTick) / 1000) : 1;
  lastTick = now;
  const state = useApp.getState();
  // really listening: the record is playing, the needle is down, nobody is scratching it
  const listening = state.phase === "PLAYING" && !state.cueLifted && !audio.handOn && audio.speed > .6;
  if (listening) count(elapsed);
  else if (run && state.phase !== "CUEING_IN" && state.phase !== "LEAD_IN" && state.phase !== "PAUSED") { endRun(false); }
  if (dirty && Date.now() - lastSave > 20000) void save();
  if (useApp.getState().section === "stats") publish();
}

/** Loads what was kept and starts counting. Called once by the main window; returns the stop function. */
export function startStats(): () => void {
  let timer = 0, stopped = false;
  void read().then((saved) => {
    if (stopped) return;
    // anything counted before the file answered is added on top
    if (data.total > 0) { data = merge(saved, data); dirty = true; } else data = saved;
    publish(true);
  });
  lastTick = performance.now();
  timer = window.setInterval(tick, 1000);
  // leaving the playing state writes what is counted so far
  const stopStore = useApp.subscribe((state, before) => { if (before.phase === "PLAYING" && state.phase !== "PLAYING") void save(); });
  const unload = () => { void save(); };
  addEventListener("beforeunload", unload);
  const openStats = useApp.subscribe((state, before) => { if (state.section === "stats" && before.section !== "stats") publish(true); });
  return () => { stopped = true; clearInterval(timer); stopStore(); openStats(); removeEventListener("beforeunload", unload); void save(); };
}
/** dev: what the counter is holding right now */
export const debugRun = () => ({ run: run && { ...run }, finished: data.finished, skips: data.skips, plays: data.plays });

export function resetStats(): void {
  data = empty(); dirty = true; run = null; void save(); publish(true);
}

/* ---------------------------------------------------------------- numbers the screen shows */
export const NEEDLE_M_PER_S = .42;       // 33⅓ rpm at the middle of a 12-inch record: 3.49 rad/s × ~12 cm
export const REVOLUTIONS_PER_S = 100 / 3 / 60;
export const LP_SIDE_SECONDS = 22 * 60;

/** Consecutive days with listening, counting back from today (or from yesterday if today is still empty), and the best ever. */
export function streaks(days: Record<string, number>): { current: number; best: number } {
  const keys = Object.keys(days).filter((key) => days[key] > 30).sort();
  let best = 0, run = 0, previous: Date | null = null;
  for (const key of keys) {
    const [y, m, d] = key.split("-").map(Number), date = new Date(y, m - 1, d);
    run = previous && Math.round((date.getTime() - previous.getTime()) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run); previous = date;
  }
  let current = 0;
  const cursor = new Date();
  if (!(days[dayKey(cursor)] > 30)) cursor.setDate(cursor.getDate() - 1);
  while (days[dayKey(cursor)] > 30) { current++; cursor.setDate(cursor.getDate() - 1); }
  return { current, best };
}

/** A made-up but plausible history, for the dev screenshots (the build leaves it out). */
export function demoStats(albums: Album[]): StatsData {
  const d = empty();
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  const now = new Date();
  d.since = now.getTime() - 120 * 86400000;
  const weight = albums.map((_, i) => Math.pow(1 / (i + 1), .85) * (.6 + rnd()));
  for (let back = 119; back >= 0; back--) {
    const date = new Date(now); date.setDate(now.getDate() - back);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    if (rnd() < (weekend ? .12 : .22)) continue;
    const seconds = (weekend ? 5400 : 3000) * (.3 + rnd() * 1.6);
    d.days[dayKey(date)] = seconds; d.total += seconds;
    d.weekdays[(date.getDay() + 6) % 7] += seconds;
    // evenings and late nights
    for (let slice = 0; slice < 8; slice++) { const hour = rnd() < .62 ? 19 + Math.floor(rnd() * 6) : 9 + Math.floor(rnd() * 10); d.hours[hour % 24] += seconds / 8; }
  }
  const sum = weight.reduce((a, b) => a + b, 0);
  albums.forEach((album, i) => {
    const sec = d.total * .86 * weight[i] / sum;
    if (sec < 60) return;
    d.albums[album.id] = { title: album.title, artist: album.artist, sec, plays: Math.round(sec / 190), genres: album.genres ?? [] };
    d.artists[album.artist] = (d.artists[album.artist] ?? 0) + sec;
    for (const genre of album.genres ?? []) d.genres[genre] = (d.genres[genre] ?? 0) + sec;
    const tracks = album.tracks.length ? album.tracks : [];
    tracks.forEach((track, t) => {
      const share = Math.pow(1 / (t + 1), .7) * (.5 + rnd());
      const tsec = sec * share / tracks.reduce((a, _, k) => a + Math.pow(1 / (k + 1), .7), 0) / .9;
      d.tracks[album.id + "/" + track.id] = { title: track.title, artist: album.artist, album: album.title, albumId: album.id, sec: tsec, plays: Math.round(tsec / 170), skips: Math.floor(rnd() * 6) };
    });
  });
  d.plays = Object.values(d.tracks).reduce((a, t) => a + t.plays, 0);
  d.skips = Object.values(d.tracks).reduce((a, t) => a + t.skips, 0);
  d.finished = Math.round(d.plays * .7);
  d.sessions = 140; d.bestSession = 5.5 * 3600;
  d.viaPlaylists = d.total * .12;
  return d;
}
export function seedDemoStats(albums: Album[]): void { data = demoStats(albums); publish(true); }

/* "Downloads": a SoundCloud link (track, album or playlist) is read and fetched with yt-dlp, which Turntable keeps
   in its own folder (no account, no keys, no server of ours), and pressed into the library like any imported album.
   The Rust side runs yt-dlp (`ytdlp_*`); the tracks come as m4a/mp3 straight from SoundCloud. The queue and the
   screen live in downloads.ts / DownloadsScreen.tsx. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { neutralProfile, prepareCover } from "./color";
import { credit, trustSplits } from "./credit";
import { runPool } from "./pool";
import { parseTrack, saveAlbum } from "./library";
import { savePlaylist, storePlaylistFiles } from "./playlists";
import { useApp } from "./state";
import { t } from "./lang";
import type { Album, DraftTrack } from "./types";

const SOUNDCLOUD = /^https:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i;
/** tracks of one set fetched at the same time: looking a track up takes about as long as the file itself */
const PARALLEL = 4;
/** SoundCloud answers 403/429 when it is asked for too much too fast (a long playlist does that): the downloader
    then slows down, waits, and asks again instead of giving the track up */
const RATE_LIMIT = /HTTP Error (403|429)|Too Many Requests|Forbidden/i;

export interface FoundTrack { url: string; title: string; author: string }
export interface Found {
  kind: "track" | "set"; title: string; author: string; cover: string; year?: number; tracks: FoundTrack[];
  /** yt-dlp's lookup of a single track, handed back so the download does not repeat it */
  info?: string;
}
export type TrackState = "wait" | "run" | "done" | "fail";
export interface TrackHooks {
  start(index: number): void;
  finish(index: number, state: "done" | "fail", reason?: string): void;
  /** the track goes back to the line (SoundCloud asked to slow down) */
  retry(index: number, reason: string): void;
  /** nothing is asked of SoundCloud until this moment (ms since epoch) */
  pause(until: number): void;
  cancelled(): boolean;
}

interface Thumb { url: string; width?: number }
interface Entry { url?: string; webpage_url?: string; title?: string; uploader?: string }
interface Info { _type?: string; title?: string; uploader?: string; artist?: string; track?: string; thumbnail?: string; thumbnails?: Thumb[]; entries?: Entry[]; webpage_url?: string; release_year?: number }
interface Fetched { _filename: string; title?: string; uploader?: string; artist?: string; track?: string; duration?: number; thumbnail?: string; thumbnails?: Thumb[]; release_year?: number }

export class ServiceError extends Error {}

/** An error message for the screen: errors that end in a detail ("…: <system text>") are translated by their start. */
export function say(message: string): string {
  const head = ["Could not start the downloader", "Could not get the downloader"].find((start) => message.startsWith(start));
  return t(head ?? message);
}

/** invoke() rejects with a plain string */
async function run<T>(command: string, args: Record<string, unknown>): Promise<{ value: T; raw: string }> {
  try { const raw = await invoke<string>(command, args); return { value: JSON.parse(raw) as T, raw }; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // a long playlist can make SoundCloud turn the lookup away: say so, instead of printing the raw HTTP error
    throw new ServiceError(command === "ytdlp_info" && RATE_LIMIT.test(message) ? "SoundCloud is limiting requests right now. Try again in a minute." : message);
  }
}

/** SoundCloud art comes as a huge "original"; the 500 px one is plenty for a sleeve. */
function artwork(info: { thumbnail?: string; thumbnails?: Thumb[] }): string {
  const sized = (info.thumbnails ?? []).filter((t) => t.url && (t.width ?? 0) > 0 && (t.width ?? 0) <= 1000).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return sized?.url || (info.thumbnail ?? "").replace("-original.", "-t500x500.");
}

export async function findLink(link: string): Promise<Found> {
  const url = link.trim();
  if (!SOUNDCLOUD.test(url)) throw new ServiceError("That isn't a soundcloud.com link");
  // dev in a plain browser (no Tauri): a staged answer (the promo videos set `__found`), or a sample set so the screen can be laid out
  if (import.meta.env.DEV && !isTauri()) { const staged = (globalThis as { __found?: Record<string, Found> }).__found?.[url]; if (staged) return staged; }
  if (import.meta.env.DEV && !isTauri() && !url.includes("/sets/")) return { kind: "track", title: "bologna 2", author: "boolymon", cover: "", tracks: [{ url, title: "bologna 2", author: "boolymon" }] };
  if (import.meta.env.DEV && !isTauri()) return { kind: "set", title: "Avant Nova", author: "slayr", cover: "", tracks: ["promise", "Whats Happening", "yes, you may", "Money Hungry", "24/7", "On my way!", "Love Blur"].map((title) => ({ url: url + "/" + title, title, author: "slayr" })) };
  const { value: info, raw } = await run<Info>("ytdlp_info", { url });
  const entries = (info.entries ?? []).filter((entry) => entry.url || entry.webpage_url);
  if (info._type === "playlist") {
    if (!entries.length) throw new ServiceError("Nothing to download at this link.");
    return {
      kind: "set", title: info.title || "SoundCloud", author: info.uploader || "SoundCloud", cover: artwork(info), year: info.release_year,
      tracks: entries.map((entry) => ({ url: (entry.url || entry.webpage_url)!, title: entry.title || "", author: entry.uploader || info.uploader || "" }))
    };
  }
  const who = credit(info.title || "SoundCloud", info.uploader || "SoundCloud", info);
  return { kind: "track", title: who.title, author: who.artist, cover: artwork(info), year: info.release_year, info: raw,
    tracks: [{ url: info.webpage_url || url, title: who.title, author: who.artist }] };
}

async function coverBlob(url: string): Promise<Blob | null> {
  if (!url) return null;
  try { const response = await tauriFetch(url); return response.ok ? await response.blob() : null; } catch { return null; }
}

interface Got {
  draft: DraftTrack; artist: string; cover: string; year?: number;
  /** who uploaded it, and the title as it was posted: what the track keeps when the "Artist - Title" split is not trusted */
  uploader: string; plain: { artist: string; title: string };
}

/** Fetches track `index` of `found` with yt-dlp and reads its tags: the file, the artist and the title it should carry. */
async function fetchGot(found: Found, index: number, batch: string): Promise<Got> {
  const item = found.tracks[index];
  const { value: got } = await run<Fetched>("ytdlp_fetch", { url: item.url, info: found.kind === "track" ? found.info ?? null : null, batch });
  const parsed = await parseTrack(got._filename);
  const posted = got.title?.trim() || item.title || parsed.track.title, uploader = got.uploader?.trim() || item.author || found.author;
  const who = credit(posted, uploader, got);
  return { artist: who.artist, cover: artwork(got), year: got.release_year, uploader, plain: { artist: uploader, title: posted },
    draft: { ...parsed.track, title: who.title || item.title, duration: parsed.track.duration || got.duration || 0 } };
}
/** Downloads every track of `found` (a few at a time), keeps the ones that came through and presses them into one album. */
export async function downloadTracks(found: Found, hooks: TrackHooks): Promise<{ album: Album; skipped: number }> {
  const results: (Got | null)[] = new Array(found.tracks.length).fill(null);
  let reason = "";
  const batch = crypto.randomUUID();     // this job's own folder: other downloads running now must not lose their files
  try {
    await runPool({
      count: found.tracks.length, parallel: PARALLEL, isRate: (message) => RATE_LIMIT.test(message), cancelled: () => hooks.cancelled(),
      start: (index) => hooks.start(index), done: (index) => hooks.finish(index, "done"), pause: (until) => hooks.pause(until),
      retry: (index) => hooks.retry(index, "SoundCloud asked to slow down"),
      fail: (index, message, refused) => { reason ||= message; hooks.finish(index, "fail", refused ? "SoundCloud kept refusing this track" : message); },
      work: async (index) => { results[index] = await fetchGot(found, index, batch); }

    });
    if (hooks.cancelled()) throw new ServiceError("Cancelled");
    const got = trustSplits(found.kind === "set", results.filter((entry): entry is Got => !!entry));
    if (!got.length) throw new ServiceError(reason || "Nothing could be downloaded.");
    // one artist across the record: the record carries it; several: the record is "Various artists" and every track
    // keeps its own artist (the deck shows it, and the lyrics are looked up by it)
    const artists = new Set(got.map((entry) => entry.artist.toLowerCase()));
    const mixed = artists.size > 1;
    const drafts = got.map((entry, i) => ({ ...entry.draft, artist: mixed ? entry.artist : undefined, trackNumber: i + 1 }));
    const cover = found.cover || got.find((entry) => entry.cover)?.cover || "";
    const blob = await coverBlob(cover);
    const prepared = blob ? await prepareCover(blob).catch(() => undefined) : undefined;
    const album = await saveAlbum({
      id: crypto.randomUUID(), title: found.kind === "track" ? got[0].draft.title : found.title,
      artist: mixed ? "Various artists" : got[0].artist, year: found.year ?? got.find((entry) => entry.year)?.year,
      colors: prepared?.colors || neutralProfile, tracks: drafts, coverBytes: prepared?.cover, thumbBytes: prepared?.thumb
    });
    if (prepared) URL.revokeObjectURL(prepared.url);
    return { album, skipped: found.tracks.length - got.length };
  } finally {
    void invoke("clear_downloads", { batch }).catch(() => undefined);
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One SoundCloud track appended to an album (pressed again with the track on it) or to a playlist (kept as a file of its
    own). Returns the saved album, or null for a playlist (the crate rebuilds the resolved copy by itself). */
export async function addToAlbum(album: Album, found: Found, beforeSave?: () => Promise<void>): Promise<Album | null> {
  if (found.kind !== "track") throw new ServiceError("That's a playlist or an album — paste a link to one track.");
  let got: Got | null = null, failure = "";
  const batch = crypto.randomUUID();
  try {
    await runPool({
      count: 1, parallel: 1, firstPause: 10_000, maxTries: 4, isRate: (message) => RATE_LIMIT.test(message), cancelled: () => false,
      start() {}, done() {}, retry() {}, pause() {},
      fail: (_index, message, refused) => { failure = refused ? "SoundCloud kept refusing this track" : message; },
      work: async () => { got = await fetchGot(found, 0, batch); }
    });
    if (!got) throw new ServiceError(failure || "Nothing could be downloaded.");
    const track: Got = got;
    if (album.kind === "playlist") {
      const playlist = useApp.getState().playlists.find((item) => item.id === album.id);
      if (!playlist) throw new ServiceError("This playlist is gone.");
      const stored = await storePlaylistFiles(playlist.id, [{ id: track.draft.id, sourcePath: track.draft.sourcePath }]);
      const filePath = stored[track.draft.id];
      if (!filePath) throw new ServiceError("The track could not be stored.");
      await savePlaylist({ ...playlist,
        files: [...(playlist.files ?? []), { id: track.draft.id, title: track.draft.title, artist: track.artist, duration: track.draft.duration, filePath }],
        refs: [...playlist.refs, { albumId: playlist.id, trackId: track.draft.id }] });
      return null;
    }
    // an album: its tracks go back in as they are (their own .lrc and artist travel with them) and the new one joins the end
    const kept: DraftTrack[] = album.tracks.map((item) => ({ id: item.id, title: item.title, duration: item.duration, sourcePath: item.filePath, lyricsSource: item.lyricsPath, artist: item.artist }));
    // the new track keeps its own artist when it is not the record's
    const mine: DraftTrack = { ...track.draft, artist: sameName(track.artist, album.artist) ? undefined : track.artist };
    const blob = album.coverPath ? null : await coverBlob(track.cover);
    const prepared = blob ? await prepareCover(blob).catch(() => undefined) : undefined;
    await beforeSave?.();                  // the album's files are replaced now: whatever plays from them stops first
    const saved = await saveAlbum({
      id: album.id, title: album.title, artist: album.artist, year: album.year, genres: album.genres,
      colors: prepared?.colors || album.colors, tracks: [...kept, mine],
      coverBytes: prepared?.cover, thumbBytes: prepared?.thumb, existingCover: prepared ? undefined : album.coverPath || undefined
    });
    if (prepared) URL.revokeObjectURL(prepared.url);
    return saved;
  } finally {
    void invoke("clear_downloads", { batch }).catch(() => undefined);
  }
}
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { load } from "@tauri-apps/plugin-store";
import type { Album, Track } from "./types";

type Lyrics = { syncedLyrics?: string; plainLyrics?: string };
type Found = Lyrics & { trackName?: string; artistName?: string; duration?: number; instrumental?: boolean };

/* LRCLIB's /get only answers an exact match, and file tags rarely are one: "made in italy prod 177p pop north",
   "Kelly K (music vid on yt)", an album typed with a Cyrillic "С". So the lookup tries, in order: the tags as
   they are; cleaned tags; cleaned without the album; then a search, accepting a hit only when the artist,
   the title and the length (±4 s) agree. Found lyrics are kept on disk (lyrics.json) and work offline; a miss
   is remembered for three days, then asked again (LRCLIB grows). */

const HOMOGLYPHS: Record<string, string> = { А: "A", В: "B", С: "C", Е: "E", Н: "H", К: "K", М: "M", О: "O", Р: "P", Т: "T", Х: "X", а: "a", с: "c", е: "e", о: "o", р: "p", х: "x", у: "y" };
/** Cyrillic look-alikes inside a Latin name ("Сheetah") become Latin; a Cyrillic name stays as it is. */
const latin = (text: string) => /[a-z]/i.test(text) ? text.replace(/[А-Яа-я]/g, (c) => HOMOGLYPHS[c] ?? c) : text;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "lucy bedroque - yes, you may prod catiobel" → "yes, you may"; "once again (outro)" → "once again" */
export function cleanTrackTitle(title: string, artist: string): string {
  return latin(title)
    .replace(/\s*[([][^)\]]*(?:bonus|music vid|video|official|audio|visuali[sz]er|lyric|outro|intro|remaster|explicit|clean|prod|ft\.?|feat)[^)\]]*[)\]]/gi, "")
    .replace(new RegExp("^\\s*" + escape(artist) + "\\s*[-–—]\\s*", "i"), "")
    .replace(/\s+[([]?(?:prod\.?|produced by|ft\.?|feat\.?|featuring|with)\s.*$/i, "")
    .replace(/\s{2,}/g, " ").trim() || title;
}
const norm = (text: string) => latin(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9а-яё]+/g, " ").trim();
const has = (found: Found | null | undefined): found is Found => !!found && !!(found.syncedLyrics || found.plainLyrics);

async function request<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const response = await tauriFetch("https://lrclib.net/api/" + path + "?" + new URLSearchParams(params), { method: "GET", signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Lyrics request failed (" + response.status + ")");
  return response.json() as Promise<T>;
}

function best(list: Found[] | null, title: string, artist: string, duration: number): Found | undefined {
  const t = norm(title), a = norm(artist).split(" ")[0];
  return (list ?? [])
    .filter((x) => has(x) && !x.instrumental && Math.abs((x.duration ?? 0) - duration) <= 4 && norm(x.artistName ?? "").includes(a)
      && (norm(x.trackName ?? "").includes(t) || t.includes(norm(x.trackName ?? ""))))
    .sort((x, y) => Number(!!y.syncedLyrics) - Number(!!x.syncedLyrics) || Math.abs((x.duration ?? 0) - duration) - Math.abs((y.duration ?? 0) - duration))[0];
}

const cache = new Map<string, Lyrics>();
type Kept = Lyrics & { at: number };
const MISS_TTL = 3 * 24 * 3600 * 1000;
let disk: Promise<Awaited<ReturnType<typeof load>> | null> | null = null;
const lyricsStore = () => disk ??= isTauri() ? load("lyrics.json", { autoSave: 2000 }).catch(() => null) : Promise.resolve(null);

export async function fetchLyrics(track: Track, listed: Album): Promise<Lyrics> {
  // a playlist track asks for lyrics as the track of its own album (its artist and record, and the same cache entry)
  const album = { id: track.sourceAlbumId ?? listed.id, artist: track.artist ?? listed.artist, title: track.albumTitle ?? listed.title };
  const key = album.id + "/" + track.id;
  const kept = cache.get(key);
  if (kept) return kept;
  const store = await lyricsStore();
  const saved = await store?.get<Kept>(key).catch(() => undefined);
  if (saved && (saved.syncedLyrics || saved.plainLyrics || Date.now() - saved.at < MISS_TTL)) {
    const result = { syncedLyrics: saved.syncedLyrics, plainLyrics: saved.plainLyrics };
    cache.set(key, result);
    return result;
  }
  const duration = String(Math.round(track.duration));
  const title = cleanTrackTitle(track.title, album.artist), artist = latin(album.artist), albumName = latin(album.title);
  let found: Found | undefined;
  const attempts: Record<string, string>[] = [
    { artist_name: album.artist, album_name: album.title, track_name: track.title, duration },
    { artist_name: artist, album_name: albumName, track_name: title, duration },
    { artist_name: artist, track_name: title, duration }
  ];
  for (const params of attempts) {
    const answer = await request<Found>("get", params);
    if (has(answer)) { found = answer; break; }
  }
  found ??= best(await request<Found[]>("search", { track_name: title, artist_name: artist }), title, artist, track.duration)
    ?? best(await request<Found[]>("search", { q: artist + " " + title }), title, artist, track.duration);
  const result: Lyrics = found ? { syncedLyrics: found.syncedLyrics, plainLyrics: found.plainLyrics } : {};
  cache.set(key, result);
  void store?.set(key, { ...result, at: Date.now() }).catch(() => {});
  return result;
}

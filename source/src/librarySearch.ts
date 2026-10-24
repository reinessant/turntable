/* Library search, shared by the full-screen search and the mini player's tape picker.
   Matching forgives what people actually type: any case, accents ("beyonce" finds "Beyoncé"), ё = е, a
   Latin look-alike inside a Cyrillic word, the wrong keyboard layout ("ghbdtn" finds "привет", "руддщ"
   finds "hello"), words in any order, and a few skipped letters ("frnd foe" finds "friend or foe"). */
import type { Album, Track } from "./types";

const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const RU = "ёйцукенгшщзхъфывапролджэячсмитьбю.";
const swap = (text: string, from: string, to: string) => [...text].map((c) => { const i = from.indexOf(c); return i >= 0 ? to[i] : c; }).join("");
export const norm = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** the same titles are normalised on every keystroke: remembered (a library of 100 000 tracks spent most of the search here) */
const normalised = new Map<string, string>();
function cachedNorm(text: string): string {
  let out = normalised.get(text);
  if (out === undefined) { if (normalised.size > 400_000) normalised.clear(); out = norm(text); normalised.set(text, out); }
  return out;
}

/** 0 (no match) … 1000: how well `query` (already normalised) matches `text`. */
function score(text: string, query: string): number {
  const t = cachedNorm(text);
  if (!query || !t) return 0;
  if (t === query) return 1000;
  if (t.startsWith(query)) return 800 - Math.min(200, t.length - query.length);
  const at = t.indexOf(query);
  if (at > 0 && t[at - 1] === " ") return 650 - Math.min(150, at);
  if (at > 0) return 450 - Math.min(150, at);
  // every word of the query starts a word of the text, in any order
  const words = t.split(" "), parts = query.split(" ");
  if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 520;
  // letters in order with gaps (a typo-ish abbreviation); only for queries long enough to mean it
  if (query.length >= 3) {
    let i = 0, gaps = 0, prev = -1;
    for (let j = 0; j < t.length && i < query.length; j++) if (t[j] === query[i]) { if (prev >= 0 && j > prev + 1) gaps++; prev = j; i++; }
    if (i === query.length && gaps <= Math.max(2, query.length / 3)) return 200 - gaps * 20;
  }
  return 0;
}

export type Hit =
  | { kind: "album"; album: Album; score: number }
  | { kind: "artist"; artist: string; albums: Album[]; score: number }
  | { kind: "track"; album: Album; track: Track; index: number; score: number };

export interface Results { top: Hit | null; albums: Hit[]; artists: Hit[]; tracks: Hit[] }

export function searchLibrary(albums: Album[], raw: string, limits = { albums: 6, artists: 4, tracks: 8 }): Results {
  const base = norm(raw);
  if (!base) return { top: null, albums: [], artists: [], tracks: [] };
  // the same keys typed in the other layout
  const queries = [...new Set([base, norm(swap(raw.toLowerCase(), EN, RU)), norm(swap(raw.toLowerCase(), RU, EN))])].filter(Boolean);
  const best = (text: string) => Math.max(...queries.map((q) => score(text, q) * (q === base ? 1 : .9)));
  const albumHits: Hit[] = [], trackHits: Hit[] = [];
  const artists = new Map<string, Album[]>();
  for (const album of albums) {
    const a = best(album.title), b = best(album.artist) * .85;
    // a genre tag finds the record too ("jazz" lists the jazz albums), a little below a name match
    const g = Math.max(0, ...(album.genres ?? []).map((genre) => best(genre) * .6));
    if (a || b || g) albumHits.push({ kind: "album", album, score: Math.max(a, b, g) + (a && b ? 50 : 0) });
    const name = album.artist.trim();
    if (name && album.kind !== "playlist") artists.set(name, [...(artists.get(name) ?? []), album]);
    // the tracks of a mixed record ("Various artists") have artists of their own: they are found, and listed, by them too
    if (album.kind !== "playlist") for (const who of new Set(album.tracks.map((track) => track.artist?.trim()).filter((x): x is string => !!x && x !== name))) artists.set(who, [...(artists.get(who) ?? []), album]);
    // a playlist's tracks are already found under their own albums
    if (album.kind !== "playlist") album.tracks.forEach((track, index) => { const s = Math.max(best(track.title), track.artist ? best(track.artist) * .85 : 0); if (s) trackHits.push({ kind: "track", album, track, index, score: s - 30 }); });
  }
  const artistHits: Hit[] = [];
  for (const [artist, list] of artists) { const s = best(artist); if (s) artistHits.push({ kind: "artist", artist, albums: list, score: s + 20 }); }
  const sort = (list: Hit[]) => list.sort((x, y) => y.score - x.score);
  const all = sort([...albumHits, ...artistHits, ...trackHits]);
  const top = all[0] ?? null;
  const without = (list: Hit[]) => list.filter((h) => h !== top);
  return {
    top,
    albums: without(sort(albumHits)).slice(0, limits.albums),
    artists: without(sort(artistHits)).slice(0, limits.artists),
    tracks: without(sort(trackHits)).slice(0, limits.tracks)
  };
}

/** Where a query matched inside a text, for highlighting: [start, end) in the original string, or null. */
export function matchRange(text: string, raw: string): [number, number] | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  const candidates = [q, swap(q, EN, RU), swap(q, RU, EN)];
  const plain = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ё/g, "е");
  // the NFKD strip keeps one char per char for the scripts we show, so indices line up with the original
  if (plain.length !== text.length) return null;
  for (const c of candidates) { const at = plain.indexOf(c.replace(/ё/g, "е")); if (at >= 0) return [at, at + c.length]; }
  return null;
}

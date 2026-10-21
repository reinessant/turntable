/* Genre tags: every album and playlist can carry up to three. A suggestion list for the picker, helpers to
   tidy what is typed (or read from file tags), and the library-wide list with counts for the crate filter. */
import type { Album } from "./types";

export const MAX_GENRES = 3;
export const SUGGESTED_GENRES = [
  // the big ones
  "Hip-hop", "Rap", "Trap", "R&B", "Pop", "Rock", "Indie", "Electronic", "House", "Techno", "Jazz", "Metal", "Punk", "Soul", "Funk",
  // underground rap
  "Rage", "Plugg", "Pluggnb", "Jerk", "Cloud rap", "Phonk", "Drift phonk", "Memphis", "Boom bap", "Underground", "Experimental hip-hop", "Trap metal",
  "Emo rap", "SoundCloud rap", "Mumble rap", "Drill", "UK drill", "Grime", "Chopped & screwed", "Lo-fi hip-hop", "Russian rap", "Russian underground",
  // internet and club
  "Hyperpop", "Digicore", "Glitchcore", "Dariacore", "Nightcore", "Breakcore", "Jersey club", "Footwork", "Jungle", "Drum & bass", "Dubstep", "Garage",
  "Hardstyle", "Gabber", "Hardcore", "Rave", "Trance", "Psytrance", "Minimal", "IDM", "Glitch", "PC Music", "Dance", "Synthwave", "Vaporwave", "Witch house",
  // dark and noisy
  "Industrial", "Noise", "Dark ambient", "Darkwave", "Goth", "Post-punk", "Shoegaze", "Emo", "Screamo", "Grunge", "Alternative", "Slowcore", "Dream pop",
  // quiet and warm
  "Ambient", "Lo-fi", "Bedroom pop", "Alt R&B", "Art pop", "Folk", "Blues", "Disco", "Reggae", "Country", "Latin", "Reggaeton", "Afrobeats",
  "K-pop", "J-pop", "Classical", "Soundtrack", "Experimental"
];

/** "hip hop" → "Hip hop": the first letter up, the rest as typed; at most 32 characters. */
export const tidyGenre = (raw: string) => {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 32);
  return text ? text[0].toUpperCase() + text.slice(1) : "";
};
const key = (genre: string) => genre.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");

/** Adds a genre if it is new and there is room; returns the new list (the same one when nothing changed). */
export function withGenre(list: string[], raw: string): string[] {
  const genre = tidyGenre(raw);
  if (!genre || list.length >= MAX_GENRES || list.some((g) => key(g) === key(genre))) return list;
  return [...list, genre];
}
/** File tags put several genres in one string: "Hip-Hop; Rap / Trap". */
export function genresFromTags(tags: string[] | undefined): string[] {
  let out: string[] = [];
  for (const tag of tags ?? []) for (const part of tag.split(/[;/,\\|]+/)) out = withGenre(out, part);
  return out;
}

export interface GenreCount { genre: string; count: number }
/** Every genre in use across the albums and playlists, the most used first. Spelling variants merge ("hip hop" = "Hip-hop"). */
export function libraryGenres(albums: Album[]): GenreCount[] {
  const counts = new Map<string, GenreCount>();
  for (const album of albums) for (const genre of album.genres ?? []) {
    const entry = counts.get(key(genre));
    if (entry) entry.count++; else counts.set(key(genre), { genre, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}
export const hasGenre = (album: Album, genre: string) => (album.genres ?? []).some((g) => key(g) === key(genre));

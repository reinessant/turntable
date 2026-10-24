/* Lookups that must stay fast when a record or a playlist holds tens of thousands of tracks (no I/O: tests/downloads.test.mjs
   runs them with a million). */
import type { Album, Track } from "./types";

/** A track of the library by its album's id and its own, found in constant time: the lookup tables are built as they
    are first needed (a playlist can point at tens of thousands of tracks; a linear search for each would never end). */
export function trackLookup(albums: Album[]): (albumId: string, trackId: string) => { album: Album; track: Track } | undefined {
  const byId = new Map<string, Album>();
  for (const album of albums) if (!byId.has(album.id)) byId.set(album.id, album);
  const tables = new Map<string, Map<string, Track>>();
  return (albumId, trackId) => {
    const album = byId.get(albumId);
    if (!album) return undefined;
    let table = tables.get(albumId);
    if (!table) { table = new Map(); for (const track of album.tracks) if (!table.has(track.id)) table.set(track.id, track); tables.set(albumId, table); }
    const track = table.get(trackId);
    return track ? { album, track } : undefined;
  };
}

const prefixSums = new WeakMap<Album, Float64Array>();
/** Seconds before each track of the record, and the whole length at the end. Asked for on every frame (the deck's arm,
    the mini player's bar), so it is added up once per record, not once per frame. */
export function albumTimes(album: Album): Float64Array {
  let sums = prefixSums.get(album);
  if (!sums) {
    const made = new Float64Array(album.tracks.length + 1);
    for (let i = 0; i < album.tracks.length; i++) made[i + 1] = made[i] + Math.max(album.tracks[i].duration, 1);
    prefixSums.set(album, sums = made);
  }
  return sums;
}
/** How far into the record (0..1) track `index` at `position` seconds is. */
export function albumProgress(album: Album, index: number, position: number): number {
  const sums = albumTimes(album), total = sums[sums.length - 1];
  return total ? Math.min(1, (sums[Math.min(Math.max(index, 0), album.tracks.length)] + position) / total) : 0;
}

/** Where the music really ends: the end of the last stretch that is not near-silence. Tracks often carry seconds of silence
    after the last note; a crossfade counted from the file's end would then fade into nothing. Only the last `lookBack`
    seconds are scanned, and a tail shorter than half a second is not worth moving for (the file's end is returned). */
export function audibleEnd(channels: ArrayLike<number>[], sampleRate: number, lookBack = 30, floor = .002): number {
  const length = channels.length ? channels[0].length : 0, duration = length / sampleRate;
  if (!length) return 0;
  const block = Math.max(1, Math.round(sampleRate * .05)), stop = Math.max(0, length - Math.round(sampleRate * lookBack));
  for (let end = length; end > stop; end -= block) {
    const from = Math.max(stop, end - block);
    for (const data of channels) for (let i = from; i < end; i++) if (data[i] > floor || data[i] < -floor) {
      const heard = end / sampleRate;
      return duration - heard < .5 ? duration : heard;
    }
  }
  return duration;                     // all of what was scanned is silent: nothing to go by, keep the file's end
}

/** Where the music really begins: after digital silence at the start of a track (encoder padding, a gap). A quiet intro is
    music and is not skipped; a silence shorter than half a second is not worth moving for (returns 0). A short run-in
    is kept so the first note is not clipped. */
export function audibleStart(channels: ArrayLike<number>[], sampleRate: number, lookAhead = 10, floor = .002): number {
  const length = channels.length ? channels[0].length : 0;
  if (!length) return 0;
  const block = Math.max(1, Math.round(sampleRate * .05)), stop = Math.min(length, Math.round(sampleRate * lookAhead));
  for (let at = 0; at < stop; at += block) {
    const to = Math.min(stop, at + block);
    for (const data of channels) for (let i = at; i < to; i++) if (data[i] > floor || data[i] < -floor) {
      const heard = Math.max(0, at / sampleRate - .05);
      return heard < .5 ? 0 : heard;
    }
  }
  return 0;                              // nothing audible in what was scanned: no verdict
}

/** Root-mean-square level of the stretch [from, to) seconds, over all channels (0 when empty). */
export function rmsOf(channels: ArrayLike<number>[], sampleRate: number, from: number, to: number): number {
  let sum = 0, count = 0;
  for (const data of channels) {
    const a = Math.max(0, Math.round(from * sampleRate)), b = Math.min(data.length, Math.round(to * sampleRate));
    for (let i = a; i < b; i++) { sum += data[i] * data[i]; count++; }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/** How much the track coming in is turned down so that it does not arrive louder than the one going out: a gain of 0.4-1
    (about -8 dB at most), 1 when it is not louder by more than a dB or when either level is unknown. It is meant to glide
    back to 1 after the crossfade, never to be left on. */
export function entryTrim(outLevel: number, inLevel: number): number {
  if (!(outLevel > 1e-4) || !(inLevel > 1e-4)) return 1;
  const ratio = outLevel / inLevel;
  return ratio >= .89 ? 1 : Math.max(.4, ratio);
}

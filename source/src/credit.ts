const VERSION_ONLY = /^[(\[]?\s*(?:(?:official|original|extended|radio|club|clean|explicit|bonus|sped[ -]?up|slowed|reverb(?:ed)?|nightcore|instrumental|acoustic|live|remix(?:ed)?|edit|vip|flip|bootleg|mashup|mix|cover|demo|remaster(?:ed)?|version|snippet|preview|leak(?:ed)?|unreleased|audio|video|lyrics?|visuali[sz]er|\d{4})\b[\s,+&/.\-)\]]*)+$/i;
/** Who made a track and what it is called. Re-uploads often carry the artist in the title ("boolymon - bologna 2",
    posted by some archive account): that artist is the one to show, not the uploader. */
export function credit(title: string, uploader: string, meta: { artist?: string; track?: string } = {}): { artist: string; title: string } {
  const named = meta.artist?.trim(), track = meta.track?.trim();
  if (named && track) return { artist: named, title: track };
  const fallback = { artist: uploader.trim(), title: title.trim() };
  // a spaced hyphen or dash: "Artist - Title", "Artist – Title", "Artist — Title"
  const cut = /\s+[-–—]\s+/.exec(title);
  if (!cut) return fallback;
  const artist = title.slice(0, cut.index).trim(), rest = title.slice(cut.index + cut[0].length).trim();
  // "01 - Intro" is a number, not an artist; and neither side may be empty or absurdly long
  if (!artist || !rest || artist.length > 70 || /^\d{1,3}[.)]?$/.test(artist)) return fallback;
  // "Song - Remix", "Song - Live", "Song - Slowed + Reverb": the right side only names a version of the song
  if (VERSION_ONLY.test(rest)) return fallback;
  return { artist, title: rest };
}

/** What `trustSplits` needs of a downloaded track. */
export interface Credited { artist: string; uploader: string; plain: { artist: string; title: string }; draft: { title: string } }

/** "Artist - Title" in a title is only trusted inside a set when something backs it up: the tracks come from different
    uploaders (a playlist of re-uploads), the artist is the uploader, or the same artist shows up on more than one track.
    One uploader with "Intro - Part 2", "Song - feat. X" and the like is not a list of artists: those tracks stay as posted. */
export function trustSplits<T extends Credited>(isSet: boolean, got: T[]): T[] {
  if (!isSet) return got;
  const key = (text: string) => text.trim().toLowerCase();
  const varied = new Set(got.map((entry) => key(entry.uploader))).size > 1;
  const lefts = new Map<string, number>();
  for (const entry of got) lefts.set(key(entry.artist), (lefts.get(key(entry.artist)) ?? 0) + 1);
  return got.map((entry) => {
    if (key(entry.artist) === key(entry.plain.artist) || varied || (lefts.get(key(entry.artist)) ?? 0) >= 2) return entry;
    return { ...entry, artist: entry.plain.artist, draft: { ...entry.draft, title: entry.plain.title } } as T;
  });
}
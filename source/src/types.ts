export interface ColorProfile {
  lMean: number;
  lMedian: number;
  cMean: number;
  cP90: number;
  hDominant: number;
  hSpread: number;
  key: "light" | "dark";
  temperature: "warm" | "cool" | "neutral";
}
export interface Track {
  id: string;
  albumId: string;
  index: number;
  title: string;
  duration: number;
  filePath: string;
  lyricsPath?: string;
  /** a playlist track keeps where it came from: its own artist and record, and the ids stats and lyrics key on */
  artist?: string;
  albumTitle?: string;
  sourceAlbumId?: string;
}
export interface Album {
  id: string;
  title: string;
  artist: string;
  year?: number;
  coverPath: string;
  coverThumbPath: string;
  colors: ColorProfile;
  tracks: Track[];
  addedAt: number;
  liked: boolean;
  /** "playlist": a list of tracks from other albums, not files of its own (see playlists.ts) */
  kind?: "album" | "playlist";
  /** up to three genre tags */
  genres?: string[];
  description?: string;}
export interface DraftTrack {
  id: string;
  title: string;
  duration: number;
  sourcePath: string;
  lyricsSource?: string;
  lyricsText?: string;
  trackNumber?: number;
  embeddedCover?: Blob;
  /** who made it, when that is not the album's artist (a mix pressed from many artists) */
  artist?: string;
}
export interface PlaylistFile {
  id: string;
  title: string;
  artist: string;
  duration: number;
  filePath: string;
  /** a small data: URL of the picture embedded in the file, if any (it feeds the playlist's collage) */
  cover?: string;
}
/** A playlist as it is stored: the tracks are references (album + track), so editing or re-importing an album
    cannot break it. `cover`/`thumb` are data: URLs (a collage of the albums, or a picture the user chose). */
export interface Playlist {
  id: string;
  title: string;
  description: string;
  genres: string[];
  cover: string;
  thumb: string;
  colors: ColorProfile;
  /** a track of the library is (album id, track id); a file of the playlist's own has the playlist's id as the album id */
  refs: { albumId: string; trackId: string }[];
  /** audio files added straight to the playlist: copied into Turntable's folder, not part of any album */
  files?: PlaylistFile[];
  addedAt: number;
  liked: boolean;
}
export interface LyricLine { time: number; text: string }
export type LyricsState =
  | { mode: "loading" | "none"; lines: LyricLine[]; plain: string; source?: string }
  | { mode: "synced" | "plain"; lines: LyricLine[]; plain: string; source: string };
/** shuffle: off, inside the record on the deck, or across every record in the library (mini player and tray) */
export type ShuffleMode = "off" | "album" | "all";
export type RepeatMode = "off" | "all" | "one";
export type Screen = "crate" | "player" | "import" | "playlist";
export type TransportPhase =
  | "STOPPED" | "SPINNING_UP" | "CUEING_IN" | "LEAD_IN" | "PLAYING"
  | "PAUSED" | "LEAD_OUT" | "CUEING_OUT" | "SPINNING_DOWN";

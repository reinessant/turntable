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
  /** albums that live on a streaming service rather than in the local library */
  source?: { kind: "soundcloud"; url: string };
}
export interface DraftTrack {
  id: string;
  title: string;
  duration: number;
  sourcePath: string;
  lyricsSource?: string;
  lyricsText?: string;
  trackNumber?: number;
  embeddedCover?: Blob;
}
export interface LyricLine { time: number; text: string }
export type LyricsState =
  | { mode: "loading" | "none"; lines: LyricLine[]; plain: string; source?: string }
  | { mode: "synced" | "plain"; lines: LyricLine[]; plain: string; source: string };
export type Screen = "crate" | "player" | "import";
export type TransportPhase =
  | "STOPPED" | "SPINNING_UP" | "CUEING_IN" | "LEAD_IN" | "PLAYING"
  | "PAUSED" | "LEAD_OUT" | "CUEING_OUT" | "SPINNING_DOWN";

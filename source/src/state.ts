import { create } from "zustand";
import { hasGenre } from "./genres";
import type { Album, LyricsState, Playlist, RepeatMode, Screen, ShuffleMode, TransportPhase } from "./types";
export type Section = "albums" | "downloads" | "stats" | "plugins" | "settings";
interface AppState {
  /** top tab: the record player (crate/player screens) or the plugin rack */
  section: Section;
  screen: Screen;
  /** every record in the library — albums and (resolved) playlists; the crate shows `crateAlbums()` of it */
  albums: Album[];
  playlists: Playlist[];
  /** the crate shows only this genre (null: everything) */
  genre: string | null;
  /** the record in front, as an index into `crateAlbums()` */
  focused: number;
  activeAlbumId: string | null;
  trackIndex: number;
  phase: TransportPhase;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  previewsEnabled: boolean;
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  previewTrack: { albumId: string; title: string } | null;
  cueLifted: boolean;
  lyrics: LyricsState;
  message: string;
  transition: number;
  transitionBusy: boolean;
  debug: boolean;
  fps: number;
  /** the "Download" sheet (paste a link): `true` queues what the link points at; an album id adds one track to that album */
  download: boolean | string;
  /** compact cassette-recorder window instead of the full screens; the same audio engine keeps playing */
  mini: boolean;
  /** the search over the whole library (Ctrl+K) */
  search: boolean;
  /** the welcome screen (first launch, or "Show" in Settings → About) */
  welcome: boolean;
  /** the quick guide (from the welcome screen, or Settings → About) */
  guide: boolean;
}
export const useApp = create<AppState>(() => ({
  section: "albums", screen: "crate", albums: [], playlists: [], genre: null, focused: 0, activeAlbumId: null,
  trackIndex: 0, phase: "STOPPED", playing: false, position: 0,
  duration: 0, volume: 0.78, previewsEnabled: true, shuffle: "off", repeat: "off", previewTrack: null, cueLifted: false,
  lyrics: { mode: "none", lines: [], plain: "" },
  message: "", transition: 0, transitionBusy: false, debug: false, fps: 0,
  download: false, mini: false, search: false, welcome: false, guide: false
}));
/** What the crate shows: the whole library, or the records of the chosen genre. */
export function crateAlbums(state: { albums: Album[]; genre: string | null } = useApp.getState()): Album[] {
  const genre = state.genre;
  return genre ? state.albums.filter((album) => hasGenre(album, genre)) : state.albums;
}
/** Filters the crate by a genre (null: all), keeping the record in front when it is still there. */
export function setCrateGenre(genre: string | null): void {
  const state = useApp.getState();
  const current = crateAlbums(state)[state.focused]?.id;
  const next = crateAlbums({ albums: state.albums, genre });
  const at = next.findIndex((album) => album.id === current);
  useApp.setState({ genre, focused: at >= 0 ? at : 0 });
}
export function activeAlbum(): Album | undefined {
  const state = useApp.getState();
  return state.albums.find((album) => album.id === state.activeAlbumId);
}

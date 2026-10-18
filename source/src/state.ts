import { create } from "zustand";
import type { Album, LyricsState, Screen, TransportPhase } from "./types";
export type Section = "albums" | "plugins" | "settings";
interface AppState {
  /** top tab: the record player (crate/player screens) or the plugin rack */
  section: Section;
  screen: Screen;
  albums: Album[];
  focused: number;
  activeAlbumId: string | null;
  trackIndex: number;
  phase: TransportPhase;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  previewsEnabled: boolean;
  previewTrack: { albumId: string; title: string } | null;
  cueLifted: boolean;
  lyrics: LyricsState;
  message: string;
  transition: number;
  transitionBusy: boolean;
  debug: boolean;
  fps: number;
  /** signed-in SoundCloud account, and whether its library is being fetched */
  scUser: { id: number; username: string; avatar: string; url: string } | null;
  scBusy: boolean;
  /** the "Add from SoundCloud" sheet over the crate */
  scSheet: boolean;
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
  section: "albums", screen: "crate", albums: [], focused: 0, activeAlbumId: null,
  trackIndex: 0, phase: "STOPPED", playing: false, position: 0,
  duration: 0, volume: 0.78, previewsEnabled: true, previewTrack: null, cueLifted: false,
  lyrics: { mode: "none", lines: [], plain: "" },
  message: "", transition: 0, transitionBusy: false, debug: false, fps: 0,
  scUser: null, scBusy: false, scSheet: false, mini: false, search: false, welcome: false, guide: false
}));
/** A new record from SoundCloud goes into the crate and comes to the front. */
export function addRemoteAlbum(album: Album): void {
  const state = useApp.getState();
  const next = [album, ...state.albums.filter((item) => item.id !== album.id)].sort((a, b) => b.addedAt - a.addedAt);
  useApp.setState({ albums: next, focused: next.findIndex((item) => item.id === album.id) });
}
/** Puts the streaming records into the crate next to the local ones, keeping the album in front where it was. */
export function mergeRemoteAlbums(remote: Album[]): void {
  const state = useApp.getState();
  const current = state.albums[state.focused]?.id;
  const next = [...state.albums.filter((album) => !album.source), ...remote].sort((a, b) => b.addedAt - a.addedAt);
  const focused = next.findIndex((album) => album.id === current);
  useApp.setState({ albums: next, focused: focused >= 0 ? focused : 0 });
}
export function activeAlbum(): Album | undefined {
  const state = useApp.getState();
  return state.albums.find((album) => album.id === state.activeAlbumId);
}

/* Remote control of the player from outside the main window: the tray quick menu (its own little window)
   and the global keys (media keys, Right Alt + arrows), both arriving as "tray" events from Rust or the menu.
   The main window answers with "now" events: what's playing, so the menu can show it. */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { audio } from "./audio";
import { enterMini, exitMini } from "./mini";
import { coverSrc } from "./PlayerScreen";
import { nextTrack, pauseOrResume, previousTrack, seek } from "./player";
import { useApp } from "./state";

export interface NowPlaying {
  album: string; artist: string; track: string; cover: string; index: number; count: number;
  playing: boolean; position: number; duration: number; volume: number; mini: boolean; loaded: boolean;
  /** the album's colour, for the menu's "album colour" theme (null: none, or a colourless cover) */
  hue: number | null;
}
const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function nowPlaying(): NowPlaying {
  const s = useApp.getState();
  const album = s.albums.find((a) => a.id === s.activeAlbumId);
  const track = album?.tracks[s.trackIndex];
  return {
    album: album?.title ?? "", artist: album?.artist ?? "", track: track?.title ?? "", cover: album ? coverSrc(album) : "",
    index: s.trackIndex, count: album?.tracks.length ?? 0, playing: s.phase === "PLAYING", position: s.position,
    duration: s.duration, volume: s.volume, mini: s.mini, loaded: !!album,
    hue: album && album.colors.cMean >= .05 ? album.colors.hDominant : null
  };
}

async function showMain(): Promise<void> {
  const window = getCurrentWindow();
  await window.show(); await window.unminimize(); await window.setFocus();
}

export function handleRemote(action: string): void {
  const s = useApp.getState();
  if (action === "play-pause") { if (s.activeAlbumId) pauseOrResume(); }
  else if (action === "next") nextTrack();
  else if (action === "prev") previousTrack();
  else if (action === "vol-up") audio.setVolume(clamp(s.volume + .05));
  else if (action === "vol-down") audio.setVolume(clamp(s.volume - .05));
  else if (action.startsWith("vol:")) audio.setVolume(clamp(Number(action.slice(4))));
  else if (action.startsWith("seek:")) seek(Number(action.slice(5)));
  else if (action === "mini") void showMain().then(enterMini);
  else if (action === "full") void showMain().then(exitMini);
  else if (action === "show") void showMain();
  // global keys from the settings
  else if (action === "mini-toggle") void showMain().then(s.mini ? exitMini : enterMini);
  else if (action === "window-toggle") void (async () => {
    const window = getCurrentWindow();
    if (await window.isVisible() && !(await window.isMinimized()) && await window.isFocused()) await window.hide();
    else await showMain();
  })();
  else if (action === "quit") void invoke("quit_app");
  else if (action === "hello") void emit("now", nowPlaying());
}

/** Listens for remote actions and keeps the quick menu up to date (a few times a second at most). */
export function startRemote(): () => void {
  const stopListen = listen<string>("tray", (event) => handleRemote(event.payload));
  let last = "", timer = 0;
  const push = () => {
    timer = 0;
    const now = nowPlaying(), key = JSON.stringify({ ...now, position: Math.floor(now.position) });
    if (key !== last) { last = key; void emit("now", now); }
  };
  const stopStore = useApp.subscribe(() => { if (!timer) timer = window.setTimeout(push, 250); });
  return () => { void stopListen.then((u) => u()); stopStore(); clearTimeout(timer); };
}

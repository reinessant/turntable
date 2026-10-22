import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import gsap from "gsap";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { audio } from "./audio";
import { CrateScreen } from "./CrateScreen";
import { ErrorBoundary } from "./ErrorBoundary";
import { ImportScreen } from "./ImportScreen";
import { loadAlbums } from "./library";
import { PlayerScreen, coverSrc } from "./PlayerScreen";
import { TitleBar } from "./TitleBar";
import { TabBar } from "./TabBar";
import { PluginsScreen } from "./PluginsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { Particles } from "./Particles";
import { Search } from "./Search";
import { DownloadSheet, DownloadsScreen } from "./DownloadsScreen";
import { loadDownloads, seedDemoDownloads } from "./downloads";
import { loadSettings, settings, useSettings } from "./settings";
import { referenceAlbum, referenceLightAlbum } from "./referenceDemo";
import { seedDemoCrate } from "./demo";
import { cueTrack, pauseOrResume, nextTrack, previousTrack, startAlbumNow, stopAlbum } from "./player";
import { RecordTransition } from "./RecordTransition";
import { REVEAL } from "./transitionTiming";
import { crateAlbums, setCrateGenre, useApp } from "./state";
import { PlaylistScreen } from "./PlaylistScreen";
import { StatsScreen } from "./StatsScreen";
import { loadPlaylists, startPlaylistSync } from "./playlists";
import { debugRun, seedDemoStats, startStats, useStats } from "./stats";
import * as player from "./player";
import * as mini from "./mini";
import { t, useLang } from "./lang";
import { MiniPlayer } from "./MiniPlayer";
import { Intro } from "./Intro";
import { enterMini, exitMini } from "./mini";
import { nowPlaying, startRemote } from "./remote";
import { Welcome } from "./Welcome";
import { Guide } from "./Guide";
import type { Album } from "./types";

function Backdrop({ album, screen }: { album?: Album; screen: string }) {
  const cover = album ? coverSrc(album) : "";
  const hue = album?.colors.hDominant ?? 260;
  const reference = import.meta.env.DEV && new URLSearchParams(location.search).get("reference");
  const neutral = album && album.colors.cMean < .05;
  const style = {
    "--base": reference === "player" ? "#1b1a22" : "oklch(20% .04 " + hue + ")",
    "--glow": neutral ? "rgba(255,255,255,.95)" : reference === "player" ? "rgba(58,86,255,.55)" : "hsla(" + hue + ",75%,55%,.48)",
    "--glow-x": "50%", "--glow-y": "50%"
  } as CSSProperties;
  return <><div className="backdrop" style={style}>
    {cover && <img className="blur" src={cover} alt="" />}
    <div className="tone" /><div className="glow" /><Particles /><div className="vignette" />
  </div><div className="grain" /></>;
}

function Debug({ timeline }: { timeline: React.MutableRefObject<gsap.core.Timeline | null> }) {
  const visible = useApp((state) => state.debug);
  const busy = useApp((state) => state.transitionBusy);
  const phase = useApp((state) => state.phase);
  const position = useApp((state) => state.position);
  const fps = useApp((state) => state.fps);
  const [readout, setReadout] = useState(() => audio.readout());
  useEffect(() => { if (!visible) return; const timer = setInterval(() => setReadout(audio.readout()), 100); return () => clearInterval(timer); }, [visible]);
  if (!visible) return null;
  return <div className="debug">
    <strong>DEBUG · D</strong>
    <span>phase {phase}</span><span>platter {(audio.speed * 33.333).toFixed(1)} rpm</span>
    <span>playback rate {audio.speed.toFixed(3)}</span><span>position {position.toFixed(2)} s</span>
    <span>FPS {fps}</span><span>AudioContext {readout.state}</span>
    <span>music RMS {readout.musicRms.toFixed(4)}</span><span>preview RMS {readout.previewRms.toFixed(4)}</span>
    <span>S: {gsap.globalTimeline.timeScale() < .5 ? "20%" : "normal"} · O: outlines</span>
    <label>Flight speed <input aria-label="Flight speed" type="range" min="0.5" max="1.5" step="0.05" defaultValue="1" onChange={(event) => gsap.globalTimeline.timeScale(Number(event.target.value))} /></label>
    {busy && <label>Flight scrub <input aria-label="Flight scrub" type="range" min="0" max="1" step=".01" defaultValue="0" onChange={(event) => timeline.current?.progress(Number(event.target.value))} /></label>}
    <button onClick={() => { audio.stopMusic(); useApp.setState({ albums: seedDemoCrate(), focused: 0, screen: "crate", phase: "STOPPED", playing: false, activeAlbumId: null }); }}>Seed demo crate (40 albums)</button>
  </div>;
}

/** dev only: lets the browser tests drive the app (the build leaves it out) */
if (import.meta.env.DEV) Object.assign(window, { __app: { useApp, useStats, player, audio, mini, setCrateGenre, nowPlaying, debugRun } });

export default function App() {
  const screen = useApp((state) => state.screen);
  const section = useApp((state) => state.section);
  const albums = useApp((state) => state.albums);
  const genre = useApp((state) => state.genre);
  const playlists = useApp((state) => state.playlists);
  const focused = useApp((state) => state.focused);
  const activeId = useApp((state) => state.activeAlbumId);
  const busy = useApp((state) => state.transitionBusy);
  const previewsEnabled = useApp((state) => state.previewsEnabled);
  const message = useApp((state) => state.message);
  const mini = useApp((state) => state.mini);
  // a language change rebuilds the screens (every text is read once, when it is drawn)
  const lang = useLang((state) => state.lang);
  const searchOpen = useApp((state) => state.search);
  const downloadOpen = useApp((state) => state.download);
  const welcomeOpen = useApp((state) => state.welcome), guideOpen = useApp((state) => state.guide);
  const welcomeForced = useRef(false);
  const settingsLoaded = useSettings((state) => state.loaded), welcomed = useSettings((state) => state.welcomed);
  // the launch intro (skipped in the dev reference views and under automation)
  const [intro, setIntro] = useState(true);
  // the launch wave plays unless in the dev reference views or under automation (?intro forces it in dev)
  const [skipIntro] = useState(() => !(import.meta.env.DEV && new URLSearchParams(location.search).has("intro"))
    && (navigator.webdriver || !settings().intro || (import.meta.env.DEV && new URLSearchParams(location.search).has("reference"))));
  // the welcome screen opens by itself the first time, once the intro is over and the saved settings are in
  // (dev: ?welcome forces it; automation and the dev reference views never get it in the way)
  useEffect(() => {
    if (intro) return;
    const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
    if (dev?.has("guide") && !welcomeForced.current) { welcomeForced.current = true; useApp.setState({ guide: true }); return; }
    if (dev?.has("welcome")) { if (!welcomeForced.current) { welcomeForced.current = true; useApp.setState({ welcome: true }); } return; }
    if (!settingsLoaded && isTauri()) return;
    if (!welcomed && !navigator.webdriver && !dev?.has("reference")) useApp.setState({ welcome: true });
  }, [intro, settingsLoaded, welcomed]);
  // the tray menu (Rust) sends its picks here; Ctrl+M folds the app into the cassette recorder
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyM") { event.preventDefault(); void (useApp.getState().mini ? exitMini() : enterMini()); }
    };
    addEventListener("keydown", key);
    // playlists keep their resolved copies inside `albums` up to date; the listening stats start counting
    const stopSync = startPlaylistSync(), stopStats = startStats();
    if (!isTauri()) return () => { removeEventListener("keydown", key); stopSync(); stopStats(); };
    // the tray quick menu and the global keys (media keys, Right Alt + arrows)
    const stop = startRemote();
    return () => { removeEventListener("keydown", key); stop(); stopSync(); stopStats(); };
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** the playlist being edited ("new": a fresh one) */
  const [editingPlaylist, setEditingPlaylist] = useState<string | null>(null);
  const [droppedPaths, setDroppedPaths] = useState<string[]>([]);
  const [transition, setTransition] = useState<"to-player" | "to-crate" | null>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const crate = crateAlbums({ albums, genre });
  const selected = crate[focused];
  const active = albums.find((album) => album.id === activeId);
  const reference = import.meta.env.DEV ? new URLSearchParams(location.search).get("reference") : null;
  const visualDemo = reference === "player" || reference === "light";
  const roomAlbum = screen === "crate" ? selected : active || selected;
  // coming back from Plugins, the record player rises in again
  const [tabIn, setTabIn] = useState(false);
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) { firstSection.current = false; return; }
    // leaving Albums mid-rise must drop the class too, or its animation keeps the hidden screen opaque
    if (section !== "albums") { setTabIn(false); return; }
    setTabIn(true);
    const timer = setTimeout(() => setTabIn(false), 450);
    return () => { clearTimeout(timer); setTabIn(false); };
  }, [section]);
  useEffect(() => {
    document.body.classList.toggle("room-light", !!roomAlbum && roomAlbum.colors.lMean > .62);
    return () => document.body.classList.remove("room-light");
  }, [roomAlbum?.id, roomAlbum?.colors.lMean]);
  useEffect(() => {
    if (isTauri()) {
      void loadPlaylists();
      void loadDownloads();
      void loadAlbums().then((value) => useApp.setState({ albums: value.sort((a, b) => b.addedAt - a.addedAt) }))
        .catch((error) => useApp.setState({ message: String(error) }));
      void loadSettings();
    } else if (import.meta.env.DEV) {
      void loadPlaylists();
      // dev views of the library screens: ?reference=stats | playlist | crate-genre
      if (reference === "stats" || reference === "playlist" || reference === "crate-genre" || reference === "settings" || reference === "demo") {
        const demo = seedDemoCrate();
        useApp.setState({ albums: demo, section: reference === "stats" ? "stats" : reference === "settings" ? "settings" : "albums", screen: reference === "playlist" ? "playlist" : "crate", genre: reference === "crate-genre" ? "Hip-hop" : null, focused: 0 });
        if (reference === "stats") seedDemoStats(demo);
        if (reference === "playlist" || reference === "demo") {
          const pick = demo.slice(0, 4), refs = pick.flatMap((item) => item.tracks.slice(0, 2).map((track) => ({ albumId: item.id, trackId: track.id })));
          useApp.setState({ playlists: [{ id: "demo-playlist", title: "Late night drive", description: "For the empty roads", genres: ["Electronic", "Ambient"], cover: pick[0].coverPath, thumb: pick[0].coverPath, colors: pick[0].colors, refs, addedAt: Date.now(), liked: false }] });
          if (reference === "playlist") setEditingPlaylist("demo-playlist");
        }
        return;
      }
      const album = reference === "light" || reference === "light-crate" ? referenceLightAlbum() : referenceAlbum();
      const index = reference === "light" ? 13 : 2;
      useApp.setState({
        albums: [album], activeAlbumId: visualDemo ? album.id : null,
        screen: visualDemo ? "player" : "crate", trackIndex: visualDemo ? index : 0,
        position: visualDemo ? reference === "light" ? 20 : 41 : 0,
        duration: visualDemo ? album.tracks[index].duration : 0,
        phase: visualDemo ? "PLAYING" : "STOPPED", playing: visualDemo,
        section: reference === "downloads" ? "downloads" : "albums"
      });
      if (reference === "downloads") seedDemoDownloads();
      if (reference === "mini" || reference === "mini-play") void enterMini().then(() => { if (reference === "mini-play") { useApp.setState({ screen: "player" }); void startAlbumNow(album, .2, 3); } });
      // dev: a long synced line on the mini strip (the demo tones have no lyrics of their own)
      if (reference === "mini-play") setTimeout(() => useApp.setState({ lyrics: { mode: "synced", source: "dev", plain: "", lines: [
        { time: 0, text: "I wanna be the one you want forever" },
        { time: 3, text: "I can see, I can see, that you found another person to love" },
        { time: 7, text: "But I can't be without my lover" }] } }), 1200);
    }
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop" || useApp.getState().screen !== "crate" || useApp.getState().section !== "albums") return;
      setDroppedPaths(event.payload.paths); setEditingId(null); useApp.setState({ screen: "import" });
    });
    return () => { void unlisten.then((stop) => stop()).catch((error) => useApp.setState({ message: String(error) })); };
  }, []);
  useEffect(() => {
    const unlock = () => { void audio.unlock().catch((error) => useApp.setState({ message: String(error) })); };
    addEventListener("pointerdown", unlock, { once: true, capture: true });
    addEventListener("keydown", unlock, { once: true, capture: true });
  }, []);
  useEffect(() => {
    let handle = 0, last = performance.now(), frames = 0, elapsed = 0;
    const frame = (now: number) => {
      const delta = Math.min(.05, (now - last) / 1000); last = now;
      audio.tick(delta);
      frames++; elapsed += delta;
      if (elapsed >= 1 && !useApp.getState().transitionBusy) { useApp.setState({ fps: Math.round(frames / elapsed) }); frames = 0; elapsed = 0; }
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, []);
  useEffect(() => {
    if (mini || screen !== "crate" || section !== "albums" || busy || !selected || !previewsEnabled) return;
    const timer = setTimeout(() => { void audio.preview(selected); }, 650);
    return () => { clearTimeout(timer); audio.stopPreview(false); };
  }, [mini, screen, section, focused, busy, selected?.id, previewsEnabled]);
  const back = useCallback(() => {
    const { transitionBusy, activeAlbumId, focused } = useApp.getState();
    const albums = crateAlbums();
    if (transitionBusy) return;
    // the record flies into the sleeve of the album that is ON the deck: a tape swapped in the mini player (or
    // the search) leaves `focused` on the album the deck was first opened with
    const at = albums.findIndex((album) => album.id === activeAlbumId);
    useApp.setState({ transitionBusy: true, ...(at >= 0 && at !== focused ? { focused: at } : {}) });
    void stopAlbum().catch((error) => useApp.setState({ message: String(error) }));
    setTransition("to-crate");
  }, []);
  /** the track the record starts on when it lands (a track picked in the search) */
  const startIndex = useRef(0);
  const select = useCallback((album: Album, index = 0) => {
    if (useApp.getState().transitionBusy) return;
    // a playlist whose albums are gone has nothing to play: say so (it can still be edited from the crate)
    if (!album.tracks.length) { useApp.setState({ message: t("This record has no tracks to play — add some with Edit playlist.") }); return; }
    startIndex.current = index;
    audio.stopPreview(true);
    audio.stopMusic();
    // decode the first track while the record flies, so the tap can start it at once
    if (album.tracks[index]) void audio.preload(album.tracks[index].filePath);
    useApp.setState({ activeAlbumId: album.id, transitionBusy: true, duration: album.tracks[index]?.duration || 0, position: 0, trackIndex: index, phase: "STOPPED", playing: false });
    setTransition("to-player");
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const state = useApp.getState();
      if (import.meta.env.DEV && event.key.toLowerCase() === "s") { gsap.globalTimeline.timeScale(gsap.globalTimeline.timeScale() < 1 ? 1 : .2); return; }
      if (import.meta.env.DEV && event.key.toLowerCase() === "o") { document.querySelector(".app")?.classList.toggle("flight-outline"); return; }
      if (state.transitionBusy || state.download || state.mini || state.search || state.welcome || state.guide) return;
      // search: Ctrl+K / Ctrl+F (by key position, so a Cyrillic layout works too) or "/"
      if (((event.ctrlKey || event.metaKey) && (event.code === "KeyK" || event.code === "KeyF")) || (event.key === "/" && !event.ctrlKey && !event.altKey)) {
        if (state.screen !== "import") { event.preventDefault(); useApp.setState({ search: true }); }
        return;
      }
      if (import.meta.env.DEV && event.key.toLowerCase() === "d") useApp.setState({ debug: !state.debug });
      if (state.section === "settings" || state.section === "downloads") return;
      if (state.section === "plugins") {
        // the rack owns the keyboard (knobs take arrows); only play/pause passes through
        if (event.code === "Space" && !(event.target instanceof HTMLElement && event.target.closest(".fx-knob-body, button"))) { event.preventDefault(); if (state.activeAlbumId) pauseOrResume(); }
        return;
      }
      if (event.key === "Escape") {
        if (state.screen === "player") back();
        else if (state.screen === "import" || state.screen === "playlist") { useApp.setState({ screen: state.activeAlbumId ? "player" : "crate" }); setEditingPlaylist(null); }
      }
      if (state.screen === "crate") {
        const list = crateAlbums(state);
        if (event.key === "ArrowRight" || event.key === "ArrowDown") useApp.setState({ focused: Math.min(list.length - 1, state.focused + 1) });
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") useApp.setState({ focused: Math.max(0, state.focused - 1) });
        if (event.key === "Enter" && list[state.focused]) select(list[state.focused]);
      } else if (state.screen === "player") {
        if (event.code === "Space") { event.preventDefault(); pauseOrResume(); }
        if (event.key === "ArrowRight") nextTrack();
        if (event.key === "ArrowLeft") previousTrack();
      }
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyI") { event.preventDefault(); setEditingId(null); useApp.setState({ screen: "import" }); }
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [back, select]);
  /** From the search: play an album (from a track). In the crate the record flies as usual; on the player the
      record is swapped in place (same album: the arm just moves to the track). */
  const playFrom = (album: Album, index: number) => {
    const state = useApp.getState();
    if (state.transitionBusy) return;
    // a record outside the genre filter: the filter goes, so it can be found
    if (state.genre && !crateAlbums(state).some((item) => item.id === album.id)) setCrateGenre(null);
    const at = crateAlbums().findIndex((item) => item.id === album.id);
    useApp.setState({ section: "albums", ...(at >= 0 ? { focused: at } : {}) });
    if (state.screen === "player") {
      if (state.activeAlbumId === album.id && state.phase !== "STOPPED") void cueTrack(index);
      else { audio.stopMusic(); void startAlbumNow(album, .3, index); }
      return;
    }
    if (state.screen !== "crate") return;
    // let the crate settle on the album first, so the record leaves the right sleeve
    const far = at >= 0 && at !== state.focused, away = state.section !== "albums";
    setTimeout(() => select(album, index), far || away ? 620 : 120);
  };
  const showInCrate = (album: Album) => {
    const state = useApp.getState();
    if (state.genre && !crateAlbums(state).some((item) => item.id === album.id)) setCrateGenre(null);
    const at = crateAlbums().findIndex((item) => item.id === album.id);
    if (at < 0) return;
    useApp.setState({ section: "albums", focused: at });
    if (state.screen === "player") back();
  };
  if (mini) return <div className="app" key={lang}><ErrorBoundary name="Mini"><MiniPlayer /></ErrorBoundary></div>;
  return <div key={lang} className={"app section-" + section + (tabIn ? " tab-in" : "") + (transition ? " " + transition + " flight-active" : "") }>
    <Backdrop album={roomAlbum} screen={screen} />
    <TitleBar />
    {screen !== "import" && screen !== "playlist" && <TabBar disabled={busy} />}
    {section === "downloads" && screen !== "import" && screen !== "playlist" && <ErrorBoundary name="Downloads"><DownloadsScreen /></ErrorBoundary>}
    {section === "stats" && screen !== "import" && screen !== "playlist" && <ErrorBoundary name="Stats"><StatsScreen /></ErrorBoundary>}
    {section === "plugins" && screen !== "import" && screen !== "playlist" && <ErrorBoundary name="Plugins"><PluginsScreen /></ErrorBoundary>}
    {section === "settings" && screen !== "import" && screen !== "playlist" && <ErrorBoundary name="Settings"><SettingsScreen /></ErrorBoundary>}
    {(screen === "crate" || transition !== null) && <ErrorBoundary name="Crate"><CrateScreen onImport={() => { setDroppedPaths([]); setEditingId(null); useApp.setState({ screen: "import" }); }} onNewPlaylist={() => { setEditingPlaylist("new"); useApp.setState({ screen: "playlist" }); }} onEditPlaylist={(id) => { setEditingPlaylist(id); useApp.setState({ screen: "playlist" }); }} onSelect={select} /></ErrorBoundary>}
    {screen === "player" && !active && <div className="error-screen" role="alert">{t("Album not found.")} <button onClick={() => useApp.setState({ screen: "crate", activeAlbumId: null })}>{t("Back to crate")}</button></div>}
    {(screen === "player" || transition !== null) && active && <ErrorBoundary name="Player"><PlayerScreen album={active} onBack={back} onEdit={() => {
      if (active.kind === "playlist") { setEditingPlaylist(active.id); useApp.setState({ screen: "playlist" }); }
      else { setEditingId(active.id); useApp.setState({ screen: "import" }); }
    }} demo={visualDemo} /></ErrorBoundary>}
    {transition && active && <RecordTransition album={active} direction={transition === "to-player" ? "in" : "out"} focused={focused} timeline={timeline}
      onError={(error) => useApp.setState({ message: error.message })}
      onTap={() => {
        useApp.setState({ screen: "player" });
        if (isTauri() || import.meta.env.DEV) void startAlbumNow(active, REVEAL.tap.musicFadeIn, startIndex.current);
      }}
      onCancel={() => {
        useApp.setState({ screen: "crate", activeAlbumId: null, transitionBusy: false, phase: "STOPPED", playing: false });
        setTransition(null);
      }}
      onComplete={() => {
        if (transition === "to-player") useApp.setState({ transitionBusy: false });
        else useApp.setState({ screen: "crate", activeAlbumId: null, transitionBusy: false });
        setTransition(null);
      }} />}
    {screen === "import" && <ErrorBoundary name="Import"><ImportScreen album={albums.find((album) => album.id === editingId)} initialPaths={droppedPaths} onClose={(saved, deleted) => {
      // saving or deleting drops the deck (activeAlbumId goes null below): the music must stop with it, or it
      // keeps playing under the crate with nothing on the deck
      if ((saved || (deleted && editingId)) && useApp.getState().activeAlbumId) void stopAlbum().catch((error) => useApp.setState({ message: String(error) }));
      if (saved) {
        const next = [...useApp.getState().albums.filter((item) => item.id !== saved.id), saved].sort((a, b) => b.addedAt - a.addedAt);
        useApp.setState({ albums: next, focused: next.findIndex((item) => item.id === saved.id), screen: "crate", activeAlbumId: null });
      } else if (deleted && editingId) {
        const next = useApp.getState().albums.filter((item) => item.id !== editingId);
        useApp.setState({ albums: next, focused: 0, activeAlbumId: null, screen: "crate" });
      } else useApp.setState({ screen: editingId || useApp.getState().activeAlbumId ? "player" : "crate" });
      setEditingId(null); setDroppedPaths([]);
    }} /></ErrorBoundary>}
    {screen === "playlist" && <ErrorBoundary name="Playlist"><PlaylistScreen playlist={playlists.find((item) => item.id === editingPlaylist)} onClose={(saved, deleted) => {
      const wasActive = !!useApp.getState().activeAlbumId && (saved?.id === useApp.getState().activeAlbumId || (deleted && editingPlaylist === useApp.getState().activeAlbumId));
      if (deleted && wasActive) void stopAlbum().catch((error) => useApp.setState({ message: String(error) }));
      const next = useApp.getState();
      if (saved && !wasActive) {
        setCrateGenre(null);
        useApp.setState({ focused: Math.max(0, next.albums.findIndex((item) => item.id === saved.id)), screen: "crate" });
      } else if (deleted) useApp.setState({ screen: "crate", activeAlbumId: wasActive ? null : next.activeAlbumId, focused: 0 });
      else useApp.setState({ screen: next.activeAlbumId ? "player" : "crate" });
      setEditingPlaylist(null);
    }} /></ErrorBoundary>}
    {downloadOpen && screen !== "import" && screen !== "playlist" && <ErrorBoundary name="Download"><DownloadSheet key={String(downloadOpen)} albumId={typeof downloadOpen === "string" ? downloadOpen : undefined} /></ErrorBoundary>}
    {searchOpen && !transition && <ErrorBoundary name="Search"><Search onPlay={playFrom} onShow={showInCrate} /></ErrorBoundary>}
    {message && <button className="message" onClick={() => useApp.setState({ message: "" })}>{message} ×</button>}
    {import.meta.env.DEV && <Debug timeline={timeline} />}
    {intro && <Intro skip={skipIntro} onDone={() => setIntro(false)} />}
    {welcomeOpen && <ErrorBoundary name="Welcome"><Welcome /></ErrorBoundary>}
    {guideOpen && <ErrorBoundary name="Guide"><Guide /></ErrorBoundary>}
  </div>;
}

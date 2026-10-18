import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { handleRemote, nowPlaying } from "./remote";
import type { NowPlaying } from "./remote";
import { quickSettings, useSettings } from "./settings";
import type { Settings } from "./settings";
import { useApp } from "./state";
import { useScrub } from "./scrub";
import "./traymenu.css";

const sendEvent = (action: string) => { if (isTauri()) void emit("tray", action); };
const time = (s: number) => { const v = Math.max(0, Math.floor(s || 0)); return Math.floor(v / 60) + ":" + String(v % 60).padStart(2, "0"); };
const clean = (t: string) => t.replace(/\s+\(?(?:prod\.?|ft\.?|feat\.?)\s.*$/i, "").replace(/^[^-—]{1,30}\s[-—]\s(?=\S)/, "");
const EMPTY: NowPlaying = { album: "", artist: "", track: "", cover: "", index: 0, count: 0, playing: false, position: 0, duration: 0, volume: .78, mini: false, loaded: false, hue: null };

/** The menu's look from the settings. Its own window reads the saved copy and follows changes made in the
    main window (the `storage` event); the settings screen's live preview reads the store directly. */
function useLook(preview: boolean): Pick<Settings, "trayTheme" | "trayAccent"> {
  const trayTheme = useSettings((s) => s.trayTheme), trayAccent = useSettings((s) => s.trayAccent);
  const [saved, setSaved] = useState(() => quickSettings());
  useEffect(() => {
    if (preview) return;
    const sync = () => setSaved(quickSettings());
    addEventListener("storage", sync); return () => removeEventListener("storage", sync);
  }, [preview]);
  return preview ? { trayTheme, trayAccent } : { trayTheme: saved.trayTheme, trayAccent: saved.trayAccent };
}

/** The tray's quick menu: what's on, transport, volume, and the full ↔ mini swap. Lives in its own small
    window; reads the player through "now" events and drives it through "tray" events. `preview`: drawn
    inside the settings screen, wired straight to the player. */
export function TrayMenu({ preview = false }: { preview?: boolean }) {
  const send = preview ? (action: string) => { if (!["full", "mini", "show", "quit"].includes(action)) handleRemote(action); } : sendEvent;
  const [now, setNow] = useState<NowPlaying>(EMPTY);
  const look = useLook(preview);
  // the menu folds away after a pick (not the preview: that would hide the main window)
  const dismiss = () => { if (!preview && isTauri()) void getCurrentWindow().hide(); };
  const [opened, setOpened] = useState(0);
  // position runs on between the main window's updates while playing
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (preview) {
      const sync = () => { setNow(nowPlaying()); setTick(performance.now()); };
      sync(); return useApp.subscribe(sync);
    }
    if (!isTauri()) {
      // dev in a plain browser: a sample of what the main window would send
      setNow({ album: "Unmusique", artist: "Lucy Bedroque", track: "2010 justin bieber prod m8i", cover: "", index: 0, count: 17, playing: true, position: 42, duration: 112, volume: .78, mini: false, loaded: true, hue: 20 });
      setTick(performance.now());
      return;
    }
    const window = getCurrentWindow();
    const subs = [
      listen<NowPlaying>("now", (event) => { setNow(event.payload); setTick(performance.now()); }),
      listen("traymenu-open", () => { setOpened(Date.now()); send("hello"); }),
      window.onFocusChanged(({ payload }) => { if (!payload) void window.hide(); })
    ];
    send("hello");
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") void window.hide(); };
    addEventListener("keydown", key);
    return () => { subs.forEach((p) => void p.then((u) => u())); removeEventListener("keydown", key); };
  }, []);
  const [, force] = useState(0);
  useEffect(() => { if (!now.playing) return; const id = setInterval(() => force((n) => n + 1), 250); return () => clearInterval(id); }, [now.playing]);
  const position = Math.min(now.duration, now.position + (now.playing ? (performance.now() - tick) / 1000 : 0));
  const scrub = useScrub(now.duration, (seconds) => send("seek:" + seconds.toFixed(2)));
  const shown = now.duration ? (scrub.preview ?? position) / now.duration : 0;

  const hue = now.hue;
  const theme = look.trayTheme === "album" && hue === null ? "dark" : look.trayTheme;
  const accent = look.trayAccent === "album" && hue === null ? "ink" : look.trayAccent;
  return <div className={"tm tm-" + theme + " accent-" + accent} key={opened} style={{ "--h": hue ?? 0 } as React.CSSProperties}>
    <header className="tm-now">
      <div className="tm-cover">{now.cover ? <img src={now.cover} alt="" /> : <i />}</div>
      <div className="tm-text">
        <b>{now.loaded ? clean(now.track) : "Nothing playing"}</b>
        <span>{now.loaded ? `${now.artist} · ${now.album}` : "Pick a record in Turntable"}</span>
      </div>
    </header>

    <div className={"tm-seek" + (scrub.dragging ? " dragging" : "") + (now.loaded ? "" : " off")} {...scrub.handlers}>
      <div className="tm-line"><i style={{ width: shown * 100 + "%" }} /><b style={{ left: shown * 100 + "%" }} /></div>
    </div>
    <div className="tm-times"><span>{time(scrub.preview ?? position)}</span><span>{now.count ? `${now.index + 1} / ${now.count}` : ""}</span><span>{time(now.duration)}</span></div>

    <div className="tm-transport">
      <button aria-label="Previous track" onClick={() => send("prev")}><svg viewBox="0 0 16 16"><path d="M4 3v10M13 3.5v9L6 8z" /></svg></button>
      <button className="tm-play" aria-label={now.playing ? "Pause" : "Play"} onClick={() => send("play-pause")}>
        {now.playing ? <svg viewBox="0 0 16 16"><rect x="4" y="3" width="2.8" height="10" rx=".6" /><rect x="9.2" y="3" width="2.8" height="10" rx=".6" /></svg>
          : <svg viewBox="0 0 16 16"><path d="M5 3v10l8.5-5z" /></svg>}
      </button>
      <button aria-label="Next track" onClick={() => send("next")}><svg viewBox="0 0 16 16"><path d="M12 3v10M3 3.5v9L10 8z" /></svg></button>
    </div>

    <label className="tm-volume">
      <svg viewBox="0 0 16 16"><path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" /></svg>
      <input type="range" min="0" max="1" step=".01" value={now.volume} style={{ "--v": now.volume * 100 + "%" } as React.CSSProperties}
        onChange={(event) => { const v = Number(event.target.value); setNow((n) => ({ ...n, volume: v })); send("vol:" + v); }} />
      <span>{Math.round(now.volume * 100)}</span>
    </label>

    {/* the swap: which face of Turntable is on the desk */}
    <div className="tm-swap" role="tablist">
      <span className="tm-swap-pill" style={{ transform: `translateX(${now.mini ? 100 : 0}%)` }} />
      <button role="tab" aria-selected={!now.mini} className={now.mini ? "" : "on"} onClick={() => { send("full"); dismiss(); }}>
        <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="1.4" /></svg>Full player</button>
      <button role="tab" aria-selected={now.mini} className={now.mini ? "on" : ""} onClick={() => { send("mini"); dismiss(); }}>
        <svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><circle cx="5.5" cy="8" r="1.2" /><circle cx="10.5" cy="8" r="1.2" /></svg>Mini player</button>
    </div>

    <footer className="tm-foot">
      <button onClick={() => { send("show"); dismiss(); }}>Open Turntable</button>
      <button className="quit" onClick={() => send("quit")}>Quit</button>
    </footer>
  </div>;
}

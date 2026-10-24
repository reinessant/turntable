import { useEffect, useMemo, useRef, useState } from "react";
import { audio } from "./audio";
import { Blend, coverSrc, fadeProgress, time } from "./PlayerScreen";
import { asset } from "./library";
import { albumProgress, cycleRepeat, nextTrack, pauseOrResume, previousTrack, seek, startAlbumNow, cycleShuffle } from "./player";
import { useApp } from "./state";
import { MINI_SCALE, exitMini, hideToTray, setMiniScale } from "./mini";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import type { Album } from "./types";
import { useScrub } from "./scrub";
import { searchLibrary } from "./librarySearch";
import { useSettings } from "./settings";
import { count, t } from "./lang";
import "./mini.css";

/** "lucy bedroque - yes, you may prod catiobel" → "yes, you may" (credits go, an artist prefix goes) */
const cleanTitle = (title: string) => title.replace(/\s+\(?(?:prod\.?|ft\.?|feat\.?)\s.*$/i, "").replace(/^[^-—]{1,30}\s[-—]\s(?=\S)/, "");

/** Portable cassette recorder: speaker grille, a tape behind the door, six piano keys. `preview`: drawn inside
    the settings screen (no window dragging, no keyboard, the window buttons do nothing). */
export function MiniPlayer({ preview = false }: { preview?: boolean }) {
  const shell = useSettings((s) => s.miniShell), lcd = useSettings((s) => s.miniLcd), tape = useSettings((s) => s.miniTape);
  const drag = preview ? undefined : true;
  const albums = useApp((s) => s.albums);
  const activeId = useApp((s) => s.activeAlbumId);
  const trackIndex = useApp((s) => s.trackIndex);
  const position = useApp((s) => s.position);
  const duration = useApp((s) => s.duration);
  const phase = useApp((s) => s.phase);
  const volume = useApp((s) => s.volume);
  const shuffle = useApp((s) => s.shuffle);
  const repeat = useApp((s) => s.repeat);
  const lyrics = useApp((s) => s.lyrics);
  const fade = useApp((s) => s.fade);
  const album = albums.find((a) => a.id === activeId);
  const track = album?.tracks[trackIndex];
  const playing = phase === "PLAYING";
  const paused = phase === "PAUSED";
  const [picker, setPicker] = useState(false);
  const [volumeShown, setVolumeShown] = useState(0);
  const [volumeDrag, setVolumeDrag] = useState(false);
  useEffect(() => { if (!volumeShown || volumeDrag) return; const t = setTimeout(() => setVolumeShown(0), 1600); return () => clearTimeout(t); }, [volumeShown, volumeDrag]);
  // volume goes by 1% (Shift: 5%) from the wheel and ↑/↓; the strip on the LCD can be dragged to any value
  const setVolume = (v: number) => { audio.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100) / 100); setVolumeShown(Date.now()); };
  const nudgeVolume = (direction: number, coarse: boolean) => setVolume(useApp.getState().volume + direction * (coarse ? .05 : .01));
  const volumeAt = (event: React.PointerEvent<HTMLElement>) => {
    const box = (event.currentTarget.querySelector(".cr-volume-slot") ?? event.currentTarget).getBoundingClientRect();
    setVolume((event.clientX - box.left) / box.width);
  };

  // tape packs: the supply reel empties across the album, the take-up reel fills; thinner pack turns faster
  const p = album ? albumProgress(album, trackIndex, position) : 0;
  const pack = (fill: number) => Math.sqrt(.12 + .88 * fill);             // area-true radius, 0.35..1
  const leftR = pack(1 - p), rightR = pack(p);
  const scrub = useScrub(duration, (seconds) => seek(seconds));
  const ownSeek = duration ? Math.min(1, (scrub.preview ?? position) / duration) : 0;
  // in a crossfade the line and the clock run on from the track going out into the new one, not back to the start
  const fu = fadeProgress(fade), fe = fu * fu * (3 - 2 * fu), blending = !!fade && fu < 1 && fade.to === trackIndex && scrub.preview === null;
  const oldElapsed = fade ? fade.fromPos + fu * fade.length : 0;
  const seekShown = blending && fade ? (1 - fe) * Math.min(1, oldElapsed / Math.max(1, fade.fromDur)) + fe * ownSeek : ownSeek;
  // the line being sung, and when the next one starts (the strip slides through a long line while it's sung)
  // blank timestamps (an instrumental gap) keep the last sung line on the strip
  const lineIndex = lyrics.mode === "synced" ? lyrics.lines.reduce((k, l, i) => (l.time <= position && l.text.trim() ? i : k), -1) : -1;
  const line = lineIndex >= 0 && lyrics.mode === "synced" ? lyrics.lines[lineIndex] : undefined;
  const lineEnd = lyrics.mode === "synced" ? lyrics.lines[lineIndex + 1]?.time ?? (line ? line.time + 5 : 0) : 0;

  const keys = {
    eject: () => setPicker(true),
    play: () => { if (!album) { setPicker(true); return; } if (phase === "PLAYING") return; pauseOrResume(); },
    rew: () => previousTrack(),
    ff: () => nextTrack(),
    stop: () => { if (phase === "PLAYING") pauseOrResume(); if (album) seek(0); },
    pause: () => { if (phase === "PLAYING" || phase === "PAUSED") pauseOrResume(); }
  };
  useEffect(() => {
    if (preview) return;
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); setPicker(true); return; }
      // Ctrl + / Ctrl − : bigger and smaller (Ctrl 0: back to normal)
      if (event.ctrlKey && (event.code === "Equal" || event.code === "NumpadAdd" || event.code === "Minus" || event.code === "NumpadSubtract" || event.code === "Digit0")) {
        event.preventDefault();
        const now = useSettings.getState().miniScale;
        void setMiniScale(event.code === "Digit0" ? 1 : now + (event.code === "Equal" || event.code === "NumpadAdd" ? MINI_SCALE.step : -MINI_SCALE.step));
        return;
      }
      if (event.code === "Space") { event.preventDefault(); if (album) pauseOrResume(); else setPicker(true); }
      if (event.key === "ArrowRight") nextTrack();
      if (event.key === "ArrowLeft") previousTrack();
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); nudgeVolume(event.key === "ArrowUp" ? 1 : -1, event.shiftKey); }
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [album?.id, preview]);

  return <div className={`cr shell-${shell} lcd-${lcd} tape-${tape}` + (playing ? " is-playing" : "") + (preview ? " cr-preview" : "")} data-tauri-drag-region={drag}
    onWheel={(event) => {
      // Ctrl + wheel: the size of the recorder; the wheel alone: the volume
      if (event.ctrlKey) { if (event.deltaY && !preview) void setMiniScale(useSettings.getState().miniScale - Math.sign(event.deltaY) * MINI_SCALE.step); return; }
      if (event.deltaY) nudgeVolume(-Math.sign(event.deltaY), event.shiftKey);
    }}>
    {/* speaker grille + top controls */}
    <div className="cr-top" data-tauri-drag-region={drag}>
      <div className="cr-grille" data-tauri-drag-region={drag} />
      {/* slide volume set into the grille: drag the knob, click the slot, or wheel anywhere (1%, Shift 5%) */}
      <div className={"cr-volume" + (volumeDrag ? " dragging" : "")} title={`${t("Volume")} ${Math.round(volume * 100)}%`}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setVolumeDrag(true); volumeAt(event); }}
        onPointerMove={(event) => { if (volumeDrag) volumeAt(event); }}
        onPointerUp={() => setVolumeDrag(false)} onPointerCancel={() => setVolumeDrag(false)}>
        <span className="cr-volume-slot"><i style={{ width: volume * 100 + "%" }} /></span>
        <b style={{ "--p": volume } as React.CSSProperties} />
      </div>
      <div className="cr-badge" data-tauri-drag-region={drag}><span className="cr-logo">turntable</span><span className="cr-model">TT-1 · portable</span></div>
      <div className="cr-round">
        <button className="cr-dot" title={t("Full player")} aria-label={t("Full player")} onClick={() => { if (!preview) void exitMini(); }}><svg viewBox="0 0 12 12"><path d="M2 5V2h3M10 7v3H7M2 2l3.2 3.2M10 10 6.8 6.8" /></svg></button>
        <button className="cr-dot" title={t("Hide to tray")} aria-label={t("Hide to tray")} onClick={() => { if (!preview) void hideToTray(); }}><svg viewBox="0 0 12 12"><path d="M2.5 7.5 6 10l3.5-2.5M6 10V2" /></svg></button>
      </div>
      {isTauri() && !preview && <button className="cr-close" aria-label={t("Quit")} title={t("Quit")} onClick={() => void getCurrentWindow().close()}><svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2 2 8" /></svg></button>}
      <div className="cr-leds"><i className={"led" + (playing ? " on" : "")} /><span>{t("PLAY")}</span><i className={"led red" + (paused ? " on" : "")} /><span>{t("PAUSE")}</span></div>
    </div>

    {/* the strip over the door: what's on the tape */}
    <div className="cr-lcd" data-tauri-drag-region={drag}>
      {volumeShown ? <div className="cr-lcd-row"><span>{t("VOLUME")}</span><span className={"cr-vol" + (volumeDrag ? " dragging" : "")}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setVolumeDrag(true); volumeAt(event); }}
        onPointerMove={(event) => { if (volumeDrag) volumeAt(event); }}
        onPointerUp={() => setVolumeDrag(false)} onPointerCancel={() => setVolumeDrag(false)}>
        <i style={{ width: volume * 100 + "%" }} /></span><span>{Math.round(volume * 100)}</span></div>
        : <>
          <div className="cr-lcd-row"><Marquee text={track ? `${String(trackIndex + 1).padStart(2, "0")} · ${cleanTitle(track.title)} — ${track.artist ?? album!.artist}` : t("No tape · press ⏏ to load an album")} />
            <span className="cr-time">{track ? (blending && fade ? <Blend u={fe} from={`${time(oldElapsed)} / ${time(fade.fromDur)}`} to={`${time(position)} / ${time(duration)}`} /> : `${time(scrub.preview ?? position)} / ${time(duration)}`) : "--:--"}</span></div>
          {line?.text ? <LyricLine text={line.text} start={line.time} end={lineEnd} position={position} />
            : <div className="cr-lyric dim"><span>{album?.title || " "}</span></div>}
        </>}
      {/* the tape position: click or drag to wind to a moment */}
      <div className={"cr-seek" + (scrub.dragging ? " dragging" : "") + (track ? "" : " off")} {...scrub.handlers} title={t("Drag to wind the tape")}>
        <span className="cr-seek-line"><i style={{ width: seekShown * 100 + "%" }} /></span><b style={{ left: seekShown * 100 + "%" }} />
      </div>
    </div>

    {/* cassette door */}
    <div className="cr-door">
      {album ? <Cassette album={album} leftR={leftR} rightR={rightR} playing={playing} />
        : <button className="cr-empty" onClick={() => setPicker(true)}>{t("Load a tape")}</button>}
      <div className="cr-glass" />
    </div>

    {/* piano keys */}
    <div className="cr-keys">
      <Key label={t("Eject — load an album")} glyph="eject" onPress={keys.eject} />
      <Key label={t("Play")} glyph="play" down={playing} onPress={keys.play} />
      <Key label={t("Rewind — previous track")} glyph="rew" onPress={keys.rew} />
      <Key label={t("Fast forward — next track")} glyph="ff" onPress={keys.ff} />
      <Key label={t("Stop")} glyph="stop" onPress={keys.stop} />
      <Key label={t("Pause")} glyph="pause" down={paused} onPress={keys.pause} />
      {/* latching switches: shuffle goes off → this album (ALB) → every track in the library (ALL); repeat loops the album, then one track */}
      <Key label={shuffle === "off" ? t("Shuffle: off — press for this album") : shuffle === "album" ? t("Shuffle: this album — press for all albums") : t("Shuffle: all albums — press to turn off")}
        glyph="shuffle" latched={shuffle !== "off"} badge={shuffle === "album" ? t("ALB") : shuffle === "all" ? t("ALL") : undefined} onPress={() => cycleShuffle()} />
      <Key label={repeat === "off" ? t("Repeat: off") : repeat === "all" ? t("Repeat: loop") : t("Repeat: this track")} glyph={repeat === "one" ? "repeat-one" : "repeat"} latched={repeat !== "off"} onPress={() => cycleRepeat()} />
    </div>

    {picker && <TapePicker albums={albums} onClose={() => setPicker(false)} onPick={(a, index) => {
      if (!a.tracks.length) { useApp.setState({ message: t("This record has no tracks to play — add some with Edit playlist.") }); return; }
      setPicker(false);
      useApp.setState({ screen: "player" });
      void startAlbumNow(a, .25, index);
    }} />}
  </div>;
}

function Cassette({ album, leftR, rightR, playing }: { album: Album; leftR: number; rightR: number; playing: boolean }) {
  const cover = coverSrc(album);
  // angular speed ∝ 1 / pack radius (the tape runs past the head at constant speed)
  const reel = (r: number) => ({ "--pack": r, animationDuration: (2.4 * r).toFixed(2) + "s", animationPlayState: playing ? "running" : "paused" }) as React.CSSProperties;
  return <div className="cr-tape">
    <div className="cr-label">
      {cover && <img src={cover} alt="" />}
      <div className="cr-label-text"><b>{album.title}</b><span>{album.artist}</span></div>
      <span className="cr-side">A</span>
    </div>
    <div className="cr-window">
      <div className="cr-reel is-left" style={reel(leftR)}><i /><i /><i /><i /><i /><i /></div>
      <div className="cr-reel is-right" style={reel(rightR)}><i /><i /><i /><i /><i /><i /></div>
      <div className="cr-ribbon" />
    </div>
  </div>;
}

function Key({ glyph, label, down = false, latched = false, badge, onPress }: { glyph: "eject" | "play" | "rew" | "ff" | "stop" | "pause" | "shuffle" | "repeat" | "repeat-one"; label: string; down?: boolean; latched?: boolean; badge?: string; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  const line = glyph === "shuffle" || glyph === "repeat" || glyph === "repeat-one";
  const path = {
    eject: <><path d="M3 9h10L8 3.5z" /><rect x="3" y="11" width="10" height="1.8" rx=".4" /></>,
    play: <path d="M5 3.5v9l7.5-4.5z" />,
    rew: <><path d="M8 4v8L2.5 8zM14 4v8L8.5 8z" /></>,
    ff: <><path d="M2 4v8l5.5-4zM8 4v8l5.5-4z" /></>,
    stop: <rect x="4" y="4" width="8" height="8" rx=".6" />,
    pause: <><rect x="4" y="3.5" width="2.8" height="9" rx=".5" /><rect x="9.2" y="3.5" width="2.8" height="9" rx=".5" /></>,
    shuffle: <><path d="M1.8 4.6h2.1c3.3 0 4.3 6.8 7.6 6.8h2.7M11.6 9.4l2.6 2-2.6 2" /><path d="M1.8 11.4h2.1c1 0 1.8-.7 2.5-1.8M8.5 6.6c.7-1.2 1.5-2 3-2h2.7M11.6 2.6l2.6 2-2.6 2" /></>,
    repeat: <><path d="M3 7.2v-.4a2.3 2.3 0 0 1 2.3-2.3H13M11 2.5l2 2-2 2" /><path d="M13 8.8v.4a2.3 2.3 0 0 1-2.3 2.3H3M5 9.5l-2 2 2 2" /></>,
    "repeat-one": <><path d="M3 7.2v-.4a2.3 2.3 0 0 1 2.3-2.3H13M11 2.5l2 2-2 2" /><path d="M13 8.8v.4a2.3 2.3 0 0 1-2.3 2.3H3M5 9.5l-2 2 2 2" /><path d="M7.2 7l1.1-.7v3.5" /></>
  }[glyph];
  const on = down || latched;
  return <button className={"cr-key" + (line ? " line" : "") + (on || pressed ? " down" : "") + (on ? " latched" : "")} aria-label={label} aria-pressed={line ? latched : undefined} title={label} data-badge={badge}
    onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onPointerLeave={() => setPressed(false)}
    onClick={onPress}><svg viewBox="0 0 16 16">{path}</svg></button>;
}

function Marquee({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null), inner = useRef<HTMLSpanElement>(null);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const over = (inner.current?.scrollWidth ?? 0) - (box.current?.clientWidth ?? 0);
    setRun(over > 4 ? over : 0);
  }, [text]);
  return <div className="cr-marquee" ref={box}><span ref={inner} className={run ? "run" : ""} style={{ "--run": -run - 16 + "px", animationDuration: Math.max(6, run / 18) + "s" } as React.CSSProperties}>{text}</span></div>;
}

/** The sung line on the strip, readable: a line that doesn't fit is split into pieces that do, and the pieces
    take turns as it's sung (each one stands still while it's read; the change is a short lift). */
const LYRIC_FONT = '500 13px "Inter Tight", system-ui, sans-serif';
let measure: CanvasRenderingContext2D | null = null;
function pieces(text: string, width: number): string[] {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure || width <= 0) return [text];
  measure.font = LYRIC_FONT;
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? line + " " + word : word;
    if (measure.measureText(next).width <= width || !line) line = next;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}
function LyricLine({ text, start, end, position }: { text: string; start: number; end: number; position: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => { setWidth(box.current?.clientWidth ?? 0); }, []);
  const parts = useMemo(() => pieces(text, width - 2), [text, width]);
  // pieces share the line's time; each turns over a little before its share runs out
  const span = Math.max(1, end - start);
  const index = Math.min(parts.length - 1, Math.max(0, Math.floor((position - start + .25) / span * parts.length)));
  return <div className="cr-lyric" ref={box}><span key={text + "|" + index}>{parts[index]}</span></div>;
}

/** Eject → load a tape: search albums, artists and track titles. */
function TapePicker({ albums, onClose, onPick }: { albums: Album[]; onClose: () => void; onPick: (album: Album, index: number) => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    type Row = { album: Album; index: number; kind: "album" | "track"; title: string; sub: string };
    const albumRow = (a: Album): Row => ({ album: a, index: 0, kind: "album", title: a.title, sub: `${a.artist} · ${count(a.tracks.length, "track")}` });
    if (!query.trim()) return albums.slice(0, 60).map(albumRow);
    // the same forgiving search as the full screen (layout, accents, word order); an artist lists their tapes
    const found = searchLibrary(albums, query, { albums: 20, artists: 6, tracks: 30 });
    const out: Row[] = [], seen = new Set<string>();
    for (const hit of [found.top, ...found.albums, ...found.artists, ...found.tracks]) {
      if (!hit) continue;
      const rows = hit.kind === "artist" ? hit.albums.map(albumRow) : hit.kind === "album" ? [albumRow(hit.album)]
        : [{ album: hit.album, index: hit.index, kind: "track" as const, title: cleanTitle(hit.track.title), sub: `${hit.album.title} · ${hit.album.artist}` }];
      for (const row of rows) { const key = row.album.id + "/" + row.kind + row.index; if (!seen.has(key)) { seen.add(key); out.push(row); } }
    }
    return out.slice(0, 60);
  }, [albums, query]);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(".on")?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  return <div className="cr-picker" onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "ArrowDown") { event.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    if (event.key === "Enter" && results[cursor]) onPick(results[cursor].album, results[cursor].index);
  }}>
    <div className="cr-search">
      <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search albums, artists, tracks")} spellCheck={false} />
      <button aria-label={t("Close")} onClick={onClose}><svg viewBox="0 0 10 10"><path d="M2 2l6 6M8 2 2 8" /></svg></button>
    </div>
    <div className="cr-results" ref={list}>
      {results.map((r, i) => <button key={r.album.id + "-" + r.kind + "-" + r.index} className={"cr-result" + (i === cursor ? " on" : "")} onMouseEnter={() => setCursor(i)} onClick={() => onPick(r.album, r.index)}>
        <img src={r.album.coverThumbPath ? (r.album.coverThumbPath.startsWith("data:") ? r.album.coverThumbPath : asset(r.album.coverThumbPath)) : coverSrc(r.album)} alt="" />
        <span className="t"><b>{r.title}</b><span>{r.kind === "track" ? t("Track") + " · " : ""}{r.sub}</span></span>
      </button>)}
      {!results.length && <p className="cr-none">{t("Nothing on the shelf matches")} “{query}”</p>}
    </div>
  </div>;
}

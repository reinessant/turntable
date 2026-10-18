import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { audio } from "./audio";
import { asset, setAlbumLiked } from "./library";
import { cueTrack, nextTrack, pauseOrResume, previousTrack, seek } from "./player";
import { useApp } from "./state";
import { DECK_GEOMETRY, DeckView } from "./DeckView";
import { ArrowOut, ScLogo } from "./ScParts";
import { openOnSoundCloud } from "./soundcloud";
import { useScrub } from "./scrub";
import type { Album } from "./types";

declare global { interface Window { icon: (name: string, size?: number) => string } }
export const time = (seconds: number) => {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
};
export function splitTitle(title: string, artist: string): [string, string] {
  let text = title.trim();
  if (artist && text.toLowerCase().startsWith(artist.toLowerCase() + " - ")) text = text.slice(artist.length + 3);
  const credit = text.match(/\s(\(?(?:prod\.?|ft\.?|feat\.?|with)\s.*)$/i);
  return credit ? [text.slice(0, credit.index), credit[1]] : [text, ""];
}
/** Deck forms. "classic": the landscape deck centred in the stage. "portrait": the deck turned a quarter
    turn (record on top, arm and controls below) — the record sits centred across the plinth, so the
    whole deck and the record share the screen's centre line and the columns stay where they were.
    Pick one in dev with ?layout=classic|portrait|wide. */
const LAYOUTS = {
  classic: { form: "landscape", width: 680, centred: false, rotate: 0 },
  portrait: { form: "portrait", width: 372 * 1.0, centred: true, rotate: 0 },   // 1 px/mm: plinth 344 → 934, 46 px above the capsule
  // symmetric plinth, record at its centre; record as big as classic; turned a little left around the spindle
  wide: { form: "wide", width: 684 * 1.15, centred: true, rotate: -15 }
} as const;
type LayoutName = keyof typeof LAYOUTS;
export const DEFAULT_LAYOUT: LayoutName = "wide";
const STAGE_CENTRE_Y = 545;
function deckLayout() {
  const asked = import.meta.env.DEV ? new URLSearchParams(location.search).get("layout") : null;
  const name = asked && asked in LAYOUTS ? asked as LayoutName : DEFAULT_LAYOUT;
  const { form, width, centred, rotate } = LAYOUTS[name];
  const g = DECK_GEOMETRY[form], k = width / g.w;
  // put the spindle on (960, 540): offsets of the spindle from the plinth's centre, in px
  const group = centred ? { transform: `translate(calc(-50% + ${((g.w / 2 - g.sx) * k).toFixed(1)}px), calc(-50% + ${(540 - STAGE_CENTRE_Y + (g.h / 2 - g.sy) * k).toFixed(1)}px))` } : undefined;
  return { name, form, width, group, rotate };
}export const coverSrc = (album: Album) => album.coverPath.startsWith("data:") || album.coverPath.startsWith("/") ? album.coverPath : asset(album.coverPath);
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <span dangerouslySetInnerHTML={{ __html: window.icon(name, size) }} />;
}
const demoLines = [
  "Placeholder line for the lyric before",
  "Another line that already went by",
  "The active line sits here, larger and bright",
  "The next line waits a little dimmer",
  "Further lines fade and soften",
  "Softer still, almost gone",
  "And the last one barely there",
  "—"
];

function TrackCarousel({ album, cover, demo }: { album: Album; cover: string; demo: boolean }) {
  const trackIndex = useApp((state) => state.trackIndex);
  const ring = useRef<HTMLDivElement>(null);
  const line = useRef<SVGSVGElement>(null);
  const count = album.tracks.length;
  /** the window of five slides along with the active track, clamped at the ends (track 01 sits at the left) */
  const windowCentre = (index: number) => count <= 5 ? (count - 1) / 2 : Math.min(count - 3, Math.max(2, index));
  const motion = useRef({ pos: windowCentre(trackIndex), target: windowCentre(trackIndex), velocity: 0, active: trackIndex });
  const wheel = useRef(0);
  useEffect(() => { motion.current.target = windowCentre(trackIndex); motion.current.active = trackIndex; }, [trackIndex, count]);
  useEffect(() => {
    let handle = 0;
    let last = performance.now();
    const SPACING = 84, ARC = 7;                         // px between tracks; the rail sags ARC px at its ends
    const at = (d: number) => [d * SPACING, ARC * (d / 2.5) * (d / 2.5)] as const;
    const frame = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const m = motion.current;
      const w = 12;
      m.velocity += (-w * w * (m.pos - m.target) - 2 * w * m.velocity) * dt; m.pos += m.velocity * dt;
      ring.current?.querySelectorAll<HTMLElement>(".rail-mark").forEach((element, index) => {
        const d = index - m.pos, [x, y] = at(d);
        const opacity = Math.max(0, Math.min(1, 1 - (Math.abs(d) - 2.15) / .6));
        element.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        element.style.opacity = opacity.toFixed(3);
        element.style.visibility = opacity <= .01 ? "hidden" : "visible";
      });
      // the groove: a faint arc through the markers, a touch brighter up to the active track
      const svg = line.current;
      if (svg) {
        const points = (from: number, to: number) => {
          const out: string[] = [];
          for (let d = from; d <= to + .001; d += .25) { const [x, y] = at(d); out.push((out.length ? "L" : "M") + (x + 300).toFixed(1) + " " + (y + 20).toFixed(1)); }
          return out.join(" ");
        };
        const activeD = Math.max(-2.8, Math.min(2.8, m.active - m.pos));
        svg.querySelector(".todo")!.setAttribute("d", points(-2.8, 2.8));
        svg.querySelector(".done")!.setAttribute("d", points(-2.8, activeD));
      }
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [album.id]);
  const choose = (index: number) => {
    if (demo) useApp.setState({ trackIndex: index, position: 0, duration: album.tracks[index].duration });
    else void cueTrack(index);
  };
  // "one record, several tracks": markers on a single groove, not a row of records
  return <>
    <div className="carousel track-rail" onWheel={(event) => {
      wheel.current += event.deltaY + event.deltaX;
      if (Math.abs(wheel.current) >= 50) {
        choose(Math.max(0, Math.min(count - 1, trackIndex + Math.sign(wheel.current))));
        wheel.current = 0;
      }
    }}>
      <svg className="rail-line" ref={line} viewBox="0 0 600 40" aria-hidden="true">
        <defs><linearGradient id="rail-fade" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".18" stopColor="#fff" /><stop offset=".82" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <mask id="rail-mask"><rect width="600" height="40" fill="url(#rail-fade)" /></mask></defs>
        <g mask="url(#rail-mask)"><path className="todo" /><path className="done" /></g>
      </svg>
      <div className="ring" ref={ring}>
        {album.tracks.map((track, index) => <button className={"rail-mark" + (index === trackIndex ? " on" : "")} key={track.id}
          title={String(index + 1).padStart(2, "0") + " · " + track.title} aria-label={"Track " + (index + 1) + ": " + track.title} onClick={() => choose(index)}>
          <span className="num mono">{String(index + 1).padStart(2, "0")}</span>
          <span className="dot">{index === trackIndex && <img src={cover} alt="" />}</span>
        </button>)}
      </div>
    </div>
    <div className="carousel-caption rail-caption"><span className="mono">{String(trackIndex + 1).padStart(2, "0")}</span>{splitTitle(album.tracks[trackIndex]?.title || "", album.artist)[0]}</div>
  </>;
}
function LyricsColumn({ demo }: { demo: boolean }) {
  const lyrics = useApp((state) => state.lyrics);
  const position = useApp((state) => state.position);
  const inner = useRef<HTMLDivElement>(null);
  const lines = demo ? demoLines.map((text, index) => ({ text, time: index * 20 })) :
    lyrics.mode === "synced" ? lyrics.lines :
    lyrics.mode === "plain" ? lyrics.plain.split(/\r?\n/).filter(Boolean).map((text, index) => ({ text, time: index })) : [];
  let active = demo ? 2 : lyrics.mode === "synced" ? 0 : -1;
  if (!demo && lyrics.mode === "synced") {
    for (let i = 0; i < lines.length; i++) if (lines[i].time <= position) active = i;
  }
  useEffect(() => {
    const element = inner.current;
    const current = element?.querySelector<HTMLElement>(".ly.on");
    // keep the active line on the middle of the lyrics box (column or band)
    if (element && current) element.style.transform = "translateY(" + ((element.parentElement?.clientHeight ?? 400) * .5 - current.offsetTop - current.offsetHeight / 2) + "px)";
  }, [active, lines.length]);
  if (!lines.length) return <section className="lyrics"><span className="micro" style={{ position: "absolute", top: "38%" }}>{lyrics.mode === "loading" ? "Loading lyrics…" : "No lyrics"}</span></section>;
  return <section className="lyrics"><div className="inner" ref={inner}>
    {lines.map((line, index) => {
      const distance = Math.abs(index - active);
      const opacity = [1, .46, .28, .16, .09, .05][Math.min(distance, 5)];
      const blur = [0, 0, 0, .6, 1.2, 1.6][Math.min(distance, 5)];
      return <div key={index} className={"ly" + (index === active ? " on" : "")}
        style={{ opacity, filter: blur ? "blur(" + blur + "px)" : "none" }}
        onClick={() => { if (!demo && lyrics.mode === "synced") seek(line.time); }}>{line.text}</div>;
    })}
  </div></section>;
}

export function PlayerScreen({ album, onBack, onEdit, demo = false }: {
  album: Album; onBack: () => void; onEdit: () => void; demo?: boolean;
}) {
  const trackIndex = useApp((state) => state.trackIndex);
  const position = useApp((state) => state.position);
  const duration = useApp((state) => state.duration);
  const phase = useApp((state) => state.phase);
  const volume = useApp((state) => state.volume);
  const [muted, setMuted] = useState(false);
  const lastVolume = useRef(.78);
  const tracks = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = tracks.current, current = list?.querySelector<HTMLElement>(".trk.on");
    if (list && current) list.scrollTop = current.offsetTop - list.clientHeight * .30;
  }, [trackIndex, album.id]);
  const cover = coverSrc(album);
  const total = album.tracks.reduce((sum, track) => sum + track.duration, 0);
  const playing = phase === "PLAYING";
  const progress = duration ? Math.min(100, position / duration * 100) : 0;
  const scrub = useScrub(duration, (seconds) => seek(seconds));
  const shown = scrub.preview !== null && duration ? Math.min(100, scrub.preview / duration * 100) : progress;
  const layout = deckLayout();
  return <div className={"screen player-screen layout-" + layout.name + (playing ? " playing" : "")}>
    <header className="header">
      <button className="pill-btn" onClick={onBack}><Icon name="caret-left" size={14} />Crate</button>
      {album.source?.kind === "soundcloud"
        ? <button className="pill-btn sc-source" title="Open on SoundCloud" onClick={() => void openOnSoundCloud(album.source!.url).catch((error) => useApp.setState({ message: String(error) }))}><ScLogo size={8} />SoundCloud<ArrowOut size={10} /></button>
        : <div className="hright"><button className="pill-btn search-btn" aria-label="Search the library" title="Search (Ctrl+K)" onClick={() => useApp.setState({ search: true })}><Icon name="magnifying-glass" size={14} />Search<kbd>Ctrl K</kbd></button>
          <button className="pill-btn" onClick={onEdit}><Icon name="pencil-simple" size={14} />Edit album</button></div>}
    </header>
    <TrackCarousel album={album} cover={cover} demo={demo} />
    <section className="left">
      <div className="album-cover"><img src={cover} alt={album.title} /></div>
      <h1 className="album-title">{album.title}</h1>
      <div className="album-artist">{album.artist}</div>
      <div className="album-meta"><span className="mono">{album.year || ""}</span><span className="mono">{album.tracks.length} {album.tracks.length === 1 ? "track" : "tracks"}</span><span className="mono">{time(total)}</span></div>
      <div className="tracks" ref={tracks}>{album.tracks.map((track, index) =>
        <button className={"trk" + (index === trackIndex ? " on" : "")} key={track.id}
          onClick={() => demo ? useApp.setState({ trackIndex: index, position: 0, duration: track.duration }) : void cueTrack(index)}>
          {index === trackIndex ? <span className="dot" /> : <span className="mono">{String(index + 1).padStart(2, "0")}</span>}
          <span className="t">{splitTitle(track.title, album.artist)[0]}<span className="x">{splitTitle(track.title, album.artist)[1]}</span></span><span className="mono">{time(track.duration)}</span>
        </button>)}</div>
    </section>
    <div className="stage"><div className="group" style={layout.group}>
      <div className="tilt"><DeckView album={album} cover={cover} visualDemo={demo} form={layout.form} width={layout.width} rotate={layout.rotate} /></div>
    </div></div>
    <LyricsColumn demo={demo} />
    <div className="capsule">
      <button className="icon-btn" aria-label="Previous track" onClick={previousTrack}><Icon name="skip-back" /></button>
      <button className="play" aria-label={playing ? "Pause" : "Play"} onClick={pauseOrResume}><Icon name={playing ? "pause-fill" : "play-fill"} /></button>
      <button className="icon-btn" aria-label="Next track" onClick={nextTrack}><Icon name="skip-forward" /></button>
      <span className="time mono">{time(scrub.preview ?? position)}</span>
      <div className={"bar" + (scrub.dragging ? " dragging" : "")} role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={position}
        {...scrub.handlers}
        onKeyDown={(event) => { if (event.key === "ArrowRight") { event.stopPropagation(); seek(position + 5); } if (event.key === "ArrowLeft") { event.stopPropagation(); seek(position - 5); } }}>
        <div className="track"><div className="fill" style={{ width: shown + "%" }} /><div className="thumb" style={{ left: shown + "%" }} /></div>
        {scrub.hover && duration > 0 && <span className="bar-tip mono" style={{ left: scrub.hover.x * 100 + "%" }}>{time(scrub.preview ?? scrub.hover.seconds)}</span>}
      </div>
      <span className="time mono">{time(duration)}</span><span className="sep" />
      <button className="icon-btn" aria-label="Like album" onClick={async () => {
        // flip locally, keeping the crate's order (the backend returns albums in storage order)
        const flip = (liked: boolean) => useApp.setState({ albums: useApp.getState().albums.map((item) => item.id === album.id ? { ...item, liked } : item) });
        const liked = !album.liked;
        flip(liked);
        if (!isTauri() || album.source) return;   // streaming records keep the heart in this session only
        try { await setAlbumLiked(album.id, liked); }
        catch (error) { flip(!liked); useApp.setState({ message: String(error) }); }
      }}><Icon name={album.liked ? "heart-fill" : "heart"} /></button>
      <div className={"volume-control" + (muted || volume === 0 ? " muted" : "")}><button className="icon-btn" aria-label={muted ? "Unmute" : "Mute"} onClick={() => {
        if (muted) audio.setVolume(lastVolume.current);
        else { lastVolume.current = volume || lastVolume.current; audio.setVolume(0); }
        setMuted(!muted);
      }}><Icon name="speaker-high" /></button>
        <div className="volume-pop"><input aria-label="Volume" type="range" min="0" max="1" step=".01" value={muted ? 0 : volume}
          style={{ "--v": (muted ? 0 : volume) * 100 + "%" } as React.CSSProperties}
          onChange={(event) => { setMuted(false); audio.setVolume(Number(event.target.value)); }} /></div></div>
    </div>
  </div>;
}


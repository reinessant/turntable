import { useEffect, useRef, useState } from "react";
import { audio } from "./audio";
import { updateSettings } from "./settings";
import { useApp } from "./state";
import { Icon, coverSrc } from "./PlayerScreen";
import { LabelCanvas } from "./labelArt";
import { ScLogo } from "./ScParts";
import { scRemoveRecord } from "./soundcloud";
import type { Album } from "./types";

export function CrateScreen({ onImport, onSelect }: { onImport: () => void; onSelect: (album: Album) => void }) {
  const albums = useApp((state) => state.albums);
  const focused = useApp((state) => state.focused);
  const previews = useApp((state) => state.previewsEnabled);
  const previewTrack = useApp((state) => state.previewTrack);
  const album = albums[focused];
  const stack = useRef<HTMLDivElement>(null);
  const motion = useRef({ pos: focused, target: focused, velocity: 0 });
  const wheel = useRef(0);
  const [sort, setSort] = useState<"added" | "title" | "artist">("added");
  const [peekOut, setPeekOut] = useState(false);
  useEffect(() => { motion.current.target = focused; setPeekOut(false); const timer = window.setTimeout(() => setPeekOut(true), 520); return () => clearTimeout(timer); }, [focused]);
  useEffect(() => {
    let handle = 0, last = performance.now();
    let drift = useApp.getState().transitionBusy ? 0 : 1;
    const frame = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const m = motion.current;
      const w = 13, acc = -w * w * (m.pos - m.target) - 2 * w * m.velocity;
      m.velocity += acc * dt; m.pos += m.velocity * dt;
      // a slow float: the chosen sleeve bobs and sways a little, the stack behind breathes; it eases out
      // during transitions so measurements and flights stay steady
      const t = now / 1000;
      drift += ((useApp.getState().transitionBusy ? 0 : 1) - drift) * Math.min(1, dt * 3);
      const bob = Math.sin(t * 1.05) * 5 * drift, sway = Math.sin(t * .72 + .8) * .45 * drift;
      stack.current?.querySelectorAll<HTMLElement>(".sleeve").forEach((element, index) => {
        const d = index - m.pos;
        let y: number, scale: number, scaleY: number, dim: number, opacity: number, z: number;
        if (d >= 0) {
          const k = Math.min(d, 8);
          y = -k * 36; scale = 1 - k * .045; scaleY = 1;
          dim = Math.min(.75, k * .13); opacity = d > 7 ? Math.max(0, 8 - d) : 1; z = 100 - k;
        } else {
          const t = Math.min(1, -d), ease = t * t * (3 - 2 * t);
          y = 26 * ease; scale = 1 + .03 * ease; scaleY = Math.cos(ease * 1.3);
          dim = ease * .7; opacity = 1 - Math.min(1, Math.max(0, (-d - .3) / .5)); z = 101 + t;
        }
        const focusWeight = Math.max(0, 1 - Math.abs(d));
        const breathe = d > .5 && d < 4 ? Math.sin(t * .9 + index * 1.7) * 1.4 * drift : 0;
        element.style.transform = "translateY(" + (y + bob * focusWeight + breathe) + "px) rotate(" + (sway * focusWeight).toFixed(3) + "deg) scale(" + scale + "," + scale * scaleY + ")";
        element.style.opacity = String(Math.max(0, opacity));
        element.style.zIndex = String(Math.round(z * 10));
        element.style.display = d < -1.05 || d > 9 ? "none" : "";
        const shade = element.querySelector<HTMLElement>(".dim");
        if (shade) shade.style.opacity = String(dim);
      });
      const peek = stack.current?.querySelector<HTMLElement>(".peek");
      const front = stack.current?.querySelectorAll<HTMLElement>(".sleeve")[focused];
      if (peek && front) peek.style.zIndex = String((Number(front.style.zIndex) || 1000) - 1);
      // the record rides with its sleeve
      if (peek) peek.style.marginTop = (bob * Math.max(0, 1 - Math.abs(focused - m.pos))).toFixed(2) + "px";
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [albums.length, focused]);
  const move = (delta: number) => useApp.setState({ focused: Math.max(0, Math.min(albums.length - 1, useApp.getState().focused + delta)) });
  const sortAlbums = (next: "added" | "title" | "artist") => {
    const currentId = album?.id;
    const sorted = [...albums].sort((a, b) => next === "title" ? a.title.localeCompare(b.title) : next === "artist" ? a.artist.localeCompare(b.artist) : b.addedAt - a.addedAt);
    useApp.setState({ albums: sorted, focused: Math.max(0, sorted.findIndex((item) => item.id === currentId)) });
    setSort(next);
  };
  return <div className="screen crate-screen" onWheel={(event) => {
    // React's wheel listener is passive (preventDefault would only log an error); the screen never scrolls anyway
    wheel.current += event.deltaY + event.deltaX;
    if (Math.abs(wheel.current) > 40) { move(Math.sign(wheel.current)); wheel.current = 0; }
  }}>
    <header className="header">
      <div className="brand"><span className="h">Crate</span><span className="mono">{albums.length} {albums.length === 1 ? "album" : "albums"}</span></div>
      <div className="hright">
        <button className="pill-btn" onClick={() => sortAlbums(sort === "added" ? "title" : sort === "title" ? "artist" : "added")}>
          <Icon name="sort-ascending" size={14} />{sort === "added" ? "Recently added" : sort === "title" ? "Title" : "Artist"}</button>
        <button className="pill-btn search-btn" aria-label="Search the library" title="Search (Ctrl+K)" onClick={() => useApp.setState({ search: true })}><Icon name="magnifying-glass" size={14} />Search<kbd>Ctrl K</kbd></button>
        <button className="pill-btn solid" onClick={onImport}><Icon name="plus" size={14} />Import</button>
      </div>
    </header>
    {album ? <>
      <div className="crate" ref={stack} onClick={() => onSelect(album)}>
        <div className="peek" style={{ opacity: peekOut ? 1 : 0, transform: peekOut ? "translateX(150px)" : "translateX(0)" }}>
          <div className="v"><div className="peek-vinyl" /><LabelCanvas className="lbl" src={coverSrc(album)} size={146} /></div><div className="sh" />
        </div>
        {albums.map((item, index) => <div key={item.id} className="sleeve" data-i={index}>
          <div className="face"><img src={coverSrc(item)} alt={item.title} /></div><div className="top" /><div className="dim" />
        </div>)}
      </div>
      <div className="caption" key={album.id}><h2>{album.title}</h2><div className="sub">{album.source?.kind === "soundcloud" && <span className="sc-tag" title="From SoundCloud"><ScLogo size={6} /></span>}<span>{album.artist}</span><span className="mono">{album.year || ""} · {album.tracks.length} {album.tracks.length === 1 ? "track" : "tracks"}</span>
        {album.source?.kind === "soundcloud" && <button className="sc-remove mono" title="Remove this record from the crate (it stays on SoundCloud)" onClick={async (event) => {
          event.stopPropagation();
          try {
            await scRemoveRecord(album.id);
            const next = useApp.getState().albums.filter((item) => item.id !== album.id);
            useApp.setState({ albums: next, focused: Math.min(useApp.getState().focused, Math.max(0, next.length - 1)) });
          } catch (error) { useApp.setState({ message: String(error) }); }
        }}>Remove</button>}</div></div>
      <footer className="foot">
        <div className="preview"><button className="icon-btn" style={{ marginLeft: -10 }} aria-label={previews ? "Disable preview" : "Enable preview"}
          onClick={() => { if (previews) audio.stopPreview(false); void updateSettings({ previews: !previews }); }}>
          <Icon name="speaker-high" /></button>{previews && <span className="eq"><i /><i /><i /></span>}
          <span>{previews ? previewTrack?.albumId === album.id ? "Previewing · " + previewTrack.title : "Preview ready" : "Preview off"}</span>
        </div>
        <div className="hint">Scroll to flip · Enter to play</div>
        <div className="count mono">{String(focused + 1).padStart(2, "0")} / {String(albums.length).padStart(2, "0")}</div>
      </footer>
    </> : <div className="empty-crate"><h2>Crate is empty</h2><div className="empty-actions"><button className="pill-btn solid" onClick={onImport}><Icon name="plus" size={14} />Import an album</button></div></div>}
  </div>;
}


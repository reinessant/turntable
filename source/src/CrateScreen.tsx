import { useEffect, useMemo, useRef, useState } from "react";
import { audio } from "./audio";
import { updateSettings } from "./settings";
import { crateAlbums, setCrateGenre, useApp } from "./state";
import { libraryGenres } from "./genres";
import { count, t } from "./lang";
import { Icon, coverSrc } from "./PlayerScreen";
import { LabelCanvas } from "./labelArt";
import { DownloadIcon } from "./DownloadIcon";
import { useDownloads } from "./downloads";
import type { Album } from "./types";

/** The genre filter: a pill that opens the list of genres in the library, with how many records carry each. */
function GenreFilter({ all, genre }: { all: Album[]; genre: string | null }) {
  const [open, setOpen] = useState(false);
  const genres = useMemo(() => libraryGenres(all), [all]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest(".genre-filter")) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    addEventListener("pointerdown", away); addEventListener("keydown", key, true);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", key, true); };
  }, [open]);
  return <div className="genre-filter">
    <button className={"pill-btn" + (genre ? " active" : "")} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon name="music-notes-simple" size={14} />{genre ?? t("Genres")}
      {genre && <span className="gf-clear" role="button" aria-label={t("Show every genre")} onClick={(event) => { event.stopPropagation(); setCrateGenre(null); setOpen(false); }}><Icon name="x" size={10} /></span>}
    </button>
    {open && <div className="gf-menu" role="listbox" aria-label={t("Genres")}>
      {genres.length ? <>
        <button role="option" aria-selected={!genre} className={"gf-item" + (!genre ? " on" : "")} onClick={() => { setCrateGenre(null); setOpen(false); }}><span>{t("Everything")}</span><em>{all.length}</em></button>
        {genres.map(({ genre: name, count }) => <button role="option" aria-selected={genre === name} key={name} className={"gf-item" + (genre === name ? " on" : "")} onClick={() => { setCrateGenre(name); setOpen(false); }}><span>{name}</span><em>{count}</em></button>)}
      </> : <p>{t("No genres yet. Add up to three to an album or a playlist when you edit it.")}</p>}
    </div>}
  </div>;
}

export function CrateScreen({ onImport, onNewPlaylist, onEditPlaylist, onSelect }: { onImport: () => void; onNewPlaylist: () => void; onEditPlaylist: (id: string) => void; onSelect: (album: Album) => void }) {
  const all = useApp((state) => state.albums);
  const genre = useApp((state) => state.genre);
  const albums = useMemo(() => crateAlbums({ albums: all, genre }), [all, genre]);
  const focused = useApp((state) => state.focused);
  const previews = useApp((state) => state.previewsEnabled);
  const previewTrack = useApp((state) => state.previewTrack);
  const album = albums[focused];
  const windowed = albums.length > 150, from = windowed ? Math.max(0, focused - 6) : 0, to = windowed ? Math.min(albums.length, focused + 20) : albums.length;
  const stack = useRef<HTMLDivElement>(null);
  const motion = useRef({ pos: focused, target: focused, velocity: 0 });
  const wheel = useRef(0);
  const [sort, setSort] = useState<"added" | "title" | "artist">("added");
  const [peekOut, setPeekOut] = useState(false);
  // a genre nobody carries any more clears itself; the record in front stays inside the list
  useEffect(() => { if (genre && !albums.length) setCrateGenre(null); }, [genre, albums.length]);
  useEffect(() => { if (albums.length && focused > albums.length - 1) useApp.setState({ focused: albums.length - 1 }); }, [albums.length, focused]);
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
      stack.current?.querySelectorAll<HTMLElement>(".sleeve").forEach((element) => {
        const index = Number(element.dataset.i), d = index - m.pos;
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
      const front = stack.current?.querySelector<HTMLElement>(`.sleeve[data-i="${focused}"]`);
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
    const sorted = [...all].sort((a, b) => next === "title" ? a.title.localeCompare(b.title) : next === "artist" ? a.artist.localeCompare(b.artist) : b.addedAt - a.addedAt);
    useApp.setState({ albums: sorted, focused: Math.max(0, crateAlbums({ albums: sorted, genre }).findIndex((item) => item.id === currentId)) });
    setSort(next);
  };
  const playlistCount = all.filter((item) => item.kind === "playlist").length, albumCount = all.length - playlistCount;
  const active = useDownloads((state) => state.jobs.filter((job) => job.status === "running" || job.status === "queued").length);
  const counts = genre ? albums.length + " " + t("of") + " " + all.length : count(albumCount, "album") + (playlistCount ? " · " + count(playlistCount, "playlist") : "");
  return <div className="screen crate-screen" onWheel={(event) => {
    // React's wheel listener is passive (preventDefault would only log an error); the screen never scrolls anyway
    wheel.current += event.deltaY + event.deltaX;
    if (Math.abs(wheel.current) > 40) { move(Math.sign(wheel.current)); wheel.current = 0; }
  }}>
    <header className="header">
      {/* left: where you are and how the crate is filtered and ordered; right: finding and adding */}
      <div className="hleft">
        <div className="brand"><span className="h">{t("Crate")}</span><span className="mono">{counts}</span></div>
        <GenreFilter all={all} genre={genre} />
        <button className="pill-btn" onClick={() => sortAlbums(sort === "added" ? "title" : sort === "title" ? "artist" : "added")}>
          <Icon name="sort-ascending" size={14} />{sort === "added" ? t("Recently added") : sort === "title" ? t("Title") : t("Artist")}</button>
        <button className="pill-btn dl-open" onClick={() => useApp.setState({ section: "downloads" })}>
          <DownloadIcon />{t("Downloads")}{active > 0 && <span className="dl-badge">{active}</span>}</button>
      </div>
      <div className="hright">
        <button className="pill-btn search-btn" aria-label={t("Search the library")} title={t("Search (Ctrl+K)")} onClick={() => useApp.setState({ search: true })}><Icon name="magnifying-glass" size={14} />{t("Search")}<kbd>Ctrl K</kbd></button>
        <button className="pill-btn dl-open" onClick={() => useApp.setState({ download: true })}><DownloadIcon />{t("Download")}</button>
        <button className="pill-btn" onClick={onNewPlaylist}><Icon name="plus" size={14} />{t("Playlist")}</button>
        <button className="pill-btn solid" onClick={onImport}><Icon name="plus" size={14} />{t("Import")}</button>
      </div>
    </header>
    {album ? <>
      <div className="crate" ref={stack} onClick={() => onSelect(album)}>
        <div className="peek" style={{ opacity: peekOut ? 1 : 0, transform: peekOut ? "translateX(150px)" : "translateX(0)" }}>
          <div className="v"><div className="peek-vinyl" /><LabelCanvas className="lbl" src={coverSrc(album)} size={146} /></div><div className="sh" />
        </div>
        {/* a big library draws the sleeves around the one in front only: the rest would be thousands of covers and frame-by-frame work for nothing */}
        {albums.slice(from, to).map((item, k) => <div key={item.id} className="sleeve" data-i={from + k} style={windowed ? { display: "none" } : undefined}>
          <div className="face"><img src={coverSrc(item)} alt={item.title} /></div><div className="top" /><div className="dim" />
        </div>)}
      </div>
      <div className="caption" key={album.id}><h2>{album.title}</h2><div className="sub">{album.kind === "playlist" ? <span className="pl-tag" title={t("A playlist")}>{t("Playlist")}</span> : <span>{album.artist}</span>}<span className="mono">{album.year ? album.year + " · " : ""}{count(album.tracks.length, "track")}</span></div>
        {(album.genres?.length || album.description || album.kind === "playlist") ? <div className="caption-meta">
          {album.kind === "playlist" && <button className="pill-btn small" onClick={() => onEditPlaylist(album.id)}><Icon name="pencil-simple" size={12} />{t("Edit playlist")}</button>}
          {album.genres?.map((name) => <button key={name} className="gp-chip small" title={t("Show only") + " " + name} onClick={() => setCrateGenre(name)}>{name}</button>)}
          {album.description && <span className="caption-desc">{album.description}</span>}
        </div> : null}</div>
      <footer className="foot">
        <div className="preview"><button className="icon-btn" style={{ marginLeft: -10 }} aria-label={previews ? t("Disable preview") : t("Enable preview")}
          onClick={() => { if (previews) audio.stopPreview(false); void updateSettings({ previews: !previews }); }}>
          <Icon name="speaker-high" /></button>{previews && <span className="eq"><i /><i /><i /></span>}
          <span>{previews ? previewTrack?.albumId === album.id ? t("Previewing") + " · " + previewTrack.title : t("Preview ready") : t("Preview off")}</span>
        </div>
        <div className="hint">{t("Scroll to flip · Enter to play")}</div>
        <div className="count mono">{String(focused + 1).padStart(2, "0")} / {String(albums.length).padStart(2, "0")}</div>
      </footer>
    </> : <div className="empty-crate"><h2>{t("Crate is empty")}</h2><div className="empty-actions"><button className="pill-btn solid" onClick={onImport}><Icon name="plus" size={14} />{t("Import an album")}</button><button className="pill-btn" onClick={onNewPlaylist}><Icon name="plus" size={14} />{t("New playlist")}</button></div></div>}
  </div>;
}


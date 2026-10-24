import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { asset } from "./library";
import { coverSrc, Icon } from "./PlayerScreen";
import { matchRange, searchLibrary } from "./librarySearch";
import type { Hit } from "./librarySearch";
import { useApp } from "./state";
import { count, t } from "./lang";
import type { Album } from "./types";

/* Search the whole library (Ctrl+K, /, or the magnifier): albums, artists and tracks as you type, the best
   match on top. Enter plays (a track: its album from that track), Shift+Enter shows the album in the crate. */

const thumb = (album: Album) => album.coverThumbPath ? (album.coverThumbPath.startsWith("data:") ? album.coverThumbPath : asset(album.coverThumbPath)) : coverSrc(album);
const clock = (s: number) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const plural = (n: number, one: string) => count(n, one);

function Marked({ text, query }: { text: string; query: string }) {
  const range = matchRange(text, query);
  if (!range) return <>{text}</>;
  return <>{text.slice(0, range[0])}<mark>{text.slice(range[0], range[1])}</mark>{text.slice(range[1])}</>;
}

export function Search({ onPlay, onShow }: { onPlay: (album: Album, index: number) => void; onShow: (album: Album) => void }) {
  const albums = useApp((s) => s.albums);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [closing, setClosing] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const searched = useDeferredValue(query);          // typing stays instant on a huge library; the list follows a moment later
  const results = useMemo(() => searchLibrary(albums, searched), [albums, searched]);
  // with nothing typed: the newest albums
  const recent = useMemo<Hit[]>(() => [...albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, 6).map((album) => ({ kind: "album", album, score: 0 })), [albums]);
  const groups: { title: string; hits: Hit[] }[] = query.trim()
    ? [{ title: "Top result", hits: results.top ? [results.top] : [] }, { title: "Albums", hits: results.albums }, { title: "Artists", hits: results.artists }, { title: "Tracks", hits: results.tracks }]
    : [{ title: "Recently added", hits: recent }];
  const flat = groups.flatMap((g) => g.hits);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(".sr-hit.on")?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  const close = () => { setClosing(true); setTimeout(() => useApp.setState({ search: false }), 140); };
  const act = (hit: Hit | undefined, show = false) => {
    if (!hit || searched !== query) return;            // the list still shows the answer for the text before this key
    if (hit.kind === "artist") {
      // an artist: narrow to their records; with one record, go straight to it
      if (hit.albums.length > 1 && !show) { setQuery(hit.artist); return; }
      close(); show ? onShow(hit.albums[0]) : onPlay(hit.albums[0], 0); return;
    }
    close();
    if (show) onShow(hit.album);
    else onPlay(hit.album, hit.kind === "track" ? hit.index : 0);
  };
  let n = -1;
  return <div className={"sr-layer" + (closing ? " closing" : "")} onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="sr-panel" role="dialog" aria-label={t("Search the library")} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "ArrowDown") { event.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
      if (event.key === "ArrowUp") { event.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      if (event.key === "Enter") { event.preventDefault(); act(flat[cursor], event.shiftKey); }
      event.stopPropagation();
    }}>
      <div className="sr-field">
        <Icon name="magnifying-glass" size={20} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Albums, artists, tracks, genres")} spellCheck={false} aria-label={t("Search")} />
        {query ? <button className="sr-x" aria-label={t("Clear")} onClick={() => setQuery("")}><Icon name="x" size={14} /></button> : <kbd>Esc</kbd>}
      </div>
      <div className="sr-list" ref={list}>
        {groups.map((group) => group.hits.length > 0 && <div className="sr-group" key={group.title}>
          <div className="sr-title">{t(group.title)}</div>
          {group.hits.map((hit) => {
            const i = ++n, on = i === cursor, top = group.title === "Top result";
            const key = hit.kind === "artist" ? "ar-" + hit.artist : hit.kind === "track" ? "tr-" + hit.album.id + hit.index : "al-" + hit.album.id;
            return <button key={group.title + key} className={"sr-hit sr-" + hit.kind + (on ? " on" : "") + (top ? " top" : "")} onMouseMove={() => setCursor(i)} onClick={(event) => act(hit, event.shiftKey)}>
              {hit.kind === "artist"
                ? <span className="sr-stack">{hit.albums.slice(0, 3).map((a) => <img key={a.id} src={thumb(a)} alt="" />)}</span>
                : <span className={"sr-art" + (hit.kind === "track" ? " small" : "")}><img src={thumb(hit.album)} alt="" />{hit.kind === "album" && <i className="sr-disc" />}</span>}
              <span className="sr-text">
                {hit.kind === "album" && <><b><Marked text={hit.album.title} query={query} /></b><span><Marked text={hit.album.artist} query={query} /> · {hit.album.year ? hit.album.year + " · " : ""}{plural(hit.album.tracks.length, "track")}{hit.album.genres?.length ? " · " : ""}{hit.album.genres?.map((genre, i) => <span key={genre} className="sr-genre">{i ? ", " : ""}<Marked text={genre} query={query} /></span>)}</span></>}
                {hit.kind === "artist" && <><b><Marked text={hit.artist} query={query} /></b><span>{t("Artist")} · {plural(hit.albums.length, "album")}</span></>}
                {hit.kind === "track" && <><b><Marked text={hit.track.title} query={query} /></b><span>{hit.album.title} · {hit.track.artist ?? hit.album.artist}</span></>}
              </span>
              {hit.kind === "track" && <span className="sr-meta mono">{String(hit.index + 1).padStart(2, "0")} · {clock(hit.track.duration)}</span>}
              <span className="sr-go">{hit.kind === "artist" && hit.albums.length > 1 ? t("Show") : <><Icon name="play-fill" size={11} />{t("Play")}</>}</span>
            </button>;
          })}
        </div>)}
        {query.trim() && !flat.length && <div className="sr-none"><b>{t("Nothing on the shelf matches")} “{query.trim()}”</b><span>{t("Try part of a title, an artist, or a track name")}</span></div>}
        {!albums.length && <div className="sr-none"><b>{t("The crate is empty")}</b><span>{t("Import an album first — then everything in it is searchable")}</span></div>}
      </div>
      <div className="sr-foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t("Choose")}</span><span><kbd>Enter</kbd> {t("Play")}</span><span><kbd>Shift</kbd><kbd>Enter</kbd> {t("Show in crate")}</span><span><kbd>Esc</kbd> {t("Close")}</span></div>
    </div>
  </div>;
}

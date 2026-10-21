import { useEffect, useMemo, useRef, useState } from "react";
import { asset, chooseAudio, chooseCover, parseTrack, readBlob } from "./library";
import { neutralProfile } from "./color";
import { GenrePicker } from "./GenrePicker";
import { norm } from "./librarySearch";
import { makeCollage, placeholderCover, playlistCover, removePlaylist, savePlaylist, storePlaylistFiles, type CollageSource } from "./playlists";
import { Icon, coverSrc, time } from "./PlayerScreen";
import { useApp } from "./state";
import { count, t } from "./lang";
import type { Album, Playlist, PlaylistFile, Track } from "./types";

/* Make or edit a playlist: a name, up to three genres, a cover (a collage of its albums unless a picture is
   chosen), and tracks picked from the albums already in the library — those stay where they are, a playlist only
   points at them — or any audio files from the computer, which are copied into Turntable's folder when it is saved. */

type Ref = Playlist["refs"][number];
/** a file of the playlist's own; a fresh one is still where the user keeps it (and may carry its embedded picture) */
type OwnFile = PlaylistFile & { fresh?: boolean; picture?: Blob };
type Row = { ref: Ref; title: string; source: string; duration: number; art?: CollageSource; artKey: string };
const same = (a: Ref, b: Ref) => a.albumId === b.albumId && a.trackId === b.trackId;
const plural = (n: number, one: string) => count(n, one);

export function PlaylistScreen({ playlist, onClose }: { playlist?: Playlist; onClose: (saved?: Playlist, deleted?: boolean) => void }) {
  const albums = useApp((state) => state.albums);
  const library = useMemo(() => albums.filter((album) => album.kind !== "playlist" && !album.source), [albums]);
  const [title, setTitle] = useState(playlist?.title ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");
  const [genres, setGenres] = useState<string[]>(playlist?.genres ?? []);
  const [playlistId] = useState(() => playlist?.id ?? crypto.randomUUID());
  const [refs, setRefs] = useState<Ref[]>(playlist?.refs ?? []);
  const [files, setFiles] = useState<OwnFile[]>(playlist?.files ?? []);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"keep" | "auto" | "custom">(playlist ? "keep" : "auto");
  const [custom, setCustom] = useState<{ blob: Blob; url: string } | null>(null);
  const [auto, setAuto] = useState<{ blob: Blob; url: string } | null>(null);
  const [adding, setAdding] = useState(import.meta.env.DEV && new URLSearchParams(location.search).has("add"));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ index: number; y: number } | null>(null);

  const rows = useMemo<Row[]>(() => refs.flatMap((ref): Row[] => {
    if (ref.albumId === playlistId) {                       // a file of the playlist's own
      const file = files.find((item) => item.id === ref.trackId);
      return file ? [{ ref, title: file.title, source: (file.artist || t("Unknown artist")) + " · " + t("From a file"), duration: file.duration, art: file.picture ?? file.cover, artKey: "file:" + file.id }] : [];
    }
    const album = library.find((item) => item.id === ref.albumId), track = album?.tracks.find((item) => item.id === ref.trackId);
    return album && track ? [{ ref, title: track.title, source: album.artist + " · " + album.title, duration: track.duration, art: album, artKey: album.id }] : [];
  }), [refs, library, files, playlistId]);
  const totalSeconds = rows.reduce((sum, row) => sum + row.duration, 0);

  // the collage follows the first four different covers in the list (albums, and pictures inside added files)
  const withArt = new Map<string, CollageSource>();
  for (const row of rows) if (row.art && !withArt.has(row.artKey)) withArt.set(row.artKey, row.art);
  const collageKey = [...withArt.keys()].slice(0, 4).join("|");
  const collageSources = useRef(withArt);
  collageSources.current = withArt;
  useEffect(() => {
    if (mode !== "auto") return;
    let cancelled = false;
    const sources = collageKey.split("|").filter(Boolean).map((key) => collageSources.current.get(key)).filter((source): source is CollageSource => !!source);
    void makeCollage(sources).then((blob) => {
      if (cancelled) return;
      setAuto((previous) => { if (previous) URL.revokeObjectURL(previous.url); return blob ? { blob, url: URL.createObjectURL(blob) } : null; });
    });
    return () => { cancelled = true; };
  }, [collageKey, mode, library]);

  const coverUrl = mode === "custom" ? custom?.url : mode === "auto" ? auto?.url : playlist?.cover;
  async function pickCover() {
    const path = await chooseCover();
    if (!path) return;
    try {
      const blob = await readBlob(path);
      setCustom((previous) => { if (previous) URL.revokeObjectURL(previous.url); return { blob, url: URL.createObjectURL(blob) }; });
      setMode("custom");
    } catch (cause) { setError(String(cause)); }
  }

  /** Audio files from anywhere on the computer: read their tags now, copy them in when the playlist is saved. */
  async function addFiles() {
    let paths: string[] = [];
    try { paths = await chooseAudio("Add audio files"); } catch (cause) { setError(String(cause)); return; }
    if (!paths.length) return;
    setBusy(true); setError("");
    const added: OwnFile[] = [];
    let failed = 0;
    for (const path of paths) {
      if (files.some((file) => file.fresh && file.filePath === path) || added.some((file) => file.filePath === path)) continue;
      try {
        const parsed = await parseTrack(path);
        added.push({ id: parsed.track.id, title: parsed.track.title, artist: parsed.artist ?? "", duration: parsed.track.duration, filePath: path, fresh: true, picture: parsed.picture });
      } catch { failed++; }
    }
    setFiles((current) => [...current, ...added]);
    setRefs((current) => [...current, ...added.map((file) => ({ albumId: playlistId, trackId: file.id }))]);
    if (failed) setError(t("Some files could not be read"));
    setBusy(false);
  }

  async function save() {
    if (!title.trim()) { titleRef.current?.focus(); setError(t("Playlist name is required")); return; }
    if (!rows.length) { setError(t("Add at least one track")); return; }
    setSaving(true); setError("");
    try {
      let picture = mode === "custom" ? custom?.blob : mode === "auto" ? auto?.blob : undefined;
      // only files without artwork: no collage to make, but a record in the crate always has a cover
      if (!picture && !playlist?.cover) picture = await placeholderCover(title.trim());
      const art = picture ? await playlistCover(picture)
        : playlist ? { cover: playlist.cover, thumb: playlist.thumb, colors: playlist.colors }
        : { cover: "", thumb: "", colors: neutralProfile };
      // the files this playlist keeps: copy the fresh ones in, remember a small picture of each
      const used = files.filter((file) => rows.some((row) => row.ref.albumId === playlistId && row.ref.trackId === file.id));
      const stored = await storePlaylistFiles(playlistId, used.filter((file) => file.fresh).map((file) => ({ id: file.id, sourcePath: file.filePath })));
      const kept: PlaylistFile[] = [];
      for (const file of used) {
        const cover = file.picture ? (await playlistCover(file.picture).catch(() => null))?.thumb : file.cover;
        kept.push({ id: file.id, title: file.title, artist: file.artist, duration: file.duration, filePath: stored[file.id] ?? file.filePath, ...(cover ? { cover } : {}) });
      }
      const saved: Playlist = {
        id: playlistId, title: title.trim(), description: description.trim(), genres,
        refs: rows.map((row) => row.ref), files: kept, ...art, addedAt: playlist?.addedAt ?? Date.now(), liked: playlist?.liked ?? false
      };
      await savePlaylist(saved);
      onClose(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save the playlist")); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!playlist) return;
    try { await removePlaylist(playlist.id); onClose(undefined, true); }
    catch (cause) { setError(String(cause)); }
  }

  const onDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const change = Math.round((event.clientY - dragRef.current.y) / 44);
    if (!change) return;
    setRefs((current) => {
      const from = dragRef.current!.index;
      const to = Math.min(current.length - 1, Math.max(0, from + change));
      if (from === to) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      dragRef.current = { index: to, y: event.clientY };
      return next;
    });
  };

  return <div className="screen import-view playlist-view">
    <header className="header">
      <button className="pill-btn" onClick={() => onClose()}><Icon name="x" size={14} />{t("Cancel")}</button>
      <div className="right"><span className="status">{plural(rows.length, "track")} · {time(totalSeconds)} · {saving ? t("Saving") : rows.length && title.trim() ? t("Ready") : t("Incomplete")}</span>
        <button className="pill-btn solid" onClick={() => void save()} disabled={saving || busy || !title.trim() || !rows.length}>
          <Icon name="check" size={14} />{playlist ? t("Save changes") : t("Save playlist")}</button></div>
    </header>
    <div className="wrap">
      <h1 className="h1">{playlist ? t("Edit playlist") : t("New playlist")} <small>{t("Tracks from your albums or any audio files")}</small></h1>
      <aside>
        <div className={"cover" + (coverUrl ? "" : " empty")}>
          {coverUrl ? <img src={coverUrl} alt={t("Playlist cover")} /> : <div className="cover-placeholder"><Icon name="image" size={32} /><span>{mode === "auto" ? t("A collage appears once you add tracks") : t("No cover")}</span></div>}
          <button className="pill-btn replace" onClick={() => void pickCover()}><Icon name="image" size={14} />{coverUrl ? t("Replace") : t("Choose cover")}</button>
        </div>
        <div className="cover-note">{mode === "auto" ? t("Collage of the albums in it") : mode === "custom" ? t("Your picture") : t("Saved cover")}</div>
        <div className="side-actions">
          <button className="pill-btn" onClick={() => setAdding(true)}><Icon name="plus" size={14} />{t("Add tracks")}</button>
          <button className="pill-btn" onClick={() => void addFiles()} disabled={busy}><Icon name="upload-simple" size={14} />{busy ? t("Reading files") : t("Add files")}</button>
          {mode !== "auto" && <button className="pill-btn" onClick={() => setMode("auto")}><Icon name="image" size={14} />{t("Use the collage")}</button>}
          {playlist && (confirmDelete ? <div className="delete-choice">{t("Delete this playlist?")} <button className="pill-btn" onClick={() => void remove()}>{t("Delete")}</button><button className="pill-btn" onClick={() => setConfirmDelete(false)}>{t("Keep")}</button></div>
            : <button className="pill-btn" onClick={() => setConfirmDelete(true)}>{t("Delete playlist")}</button>)}
        </div>
        <p className="import-feedback">{t("Albums stay as they are — a playlist only points at them. Files you add are copied into Turntable's folder.")}</p>
        {error && <p className="import-feedback error">{error}</p>}
      </aside>
      <main>
        <div className="fields" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field"><label className="micro" htmlFor="pl-title">{t("Playlist name")}</label><input className="in" id="pl-title" ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("Playlist name")} maxLength={80} /></div>
          <div className="field"><label className="micro" htmlFor="pl-desc">{t("Description")}</label><input className="in" id="pl-desc" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("Optional")} maxLength={140} /></div>
        </div>
        <div className="field genre-field"><label className="micro">{t("Genres · up to three")}</label><GenrePicker value={genres} onChange={setGenres} /></div>
        <div className="list-head"><span className="micro">{t("Tracks")}</span><div className="right"><span className="micro" style={{ color: "var(--ink-4)" }}>{t("Drag to reorder")}</span></div></div>
        <div className="rows">
          {rows.map((row, index) => <div className="row" key={row.ref.albumId + "/" + row.ref.trackId}>
            <button className="drag" aria-label={t("Move track") + " " + (index + 1)}
              onPointerDown={(event) => { dragRef.current = { index, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={onDragMove} onPointerUp={() => { dragRef.current = null; }}><Icon name="dots-six-vertical" size={16} /></button>
            <span className="mono">{String(index + 1).padStart(2, "0")}</span>
            <span className="track-cell"><span className="t-static">{row.title}</span><span className="src">{row.source}</span></span>
            <span className="mono">{time(row.duration)}</span>
            <button className="icon-btn x" aria-label={t("Remove") + " " + row.title} style={{ width: 28, height: 28 }} onClick={() => setRefs((current) => current.filter((item) => !same(item, row.ref)))}><Icon name="x" size={14} /></button>
          </div>)}
        </div>
        <button className="drop" onClick={() => setAdding(true)}><Icon name="plus" />{rows.length ? t("Add more tracks") : t("Add tracks from your albums or files")}</button>
        {playlist && refs.length > rows.length && <p className="import-feedback">{plural(refs.length - rows.length, "track")} {t("no longer in the library — dropped when you save.")}</p>}
      </main>
    </div>
    {adding && <AddTracks library={library} chosen={refs} onChange={setRefs} onClose={() => setAdding(false)} onFiles={() => void addFiles()} busy={busy} />}
  </div>;
}

/** The library as a picker: albums (open one for its tracks), a search over titles and artists; a click adds or
    removes a track, "Add all" takes a whole album. The library is albums only: files from the computer go through "Add files". */
function AddTracks({ library, chosen, onChange, onClose, onFiles, busy }: { library: Album[]; chosen: Ref[]; onChange: (refs: Ref[]) => void; onClose: () => void; onFiles: () => void; busy: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = norm(query);
  const has = (album: Album, track: Track) => chosen.some((ref) => same(ref, { albumId: album.id, trackId: track.id }));
  const toggle = (album: Album, track: Track) => {
    const ref = { albumId: album.id, trackId: track.id };
    onChange(has(album, track) ? chosen.filter((item) => !same(item, ref)) : [...chosen, ref]);
  };
  const addAll = (album: Album, tracks: Track[]) => {
    const missing = tracks.filter((track) => !has(album, track)).map((track) => ({ albumId: album.id, trackId: track.id }));
    onChange(missing.length ? [...chosen, ...missing] : chosen.filter((ref) => !(ref.albumId === album.id && tracks.some((track) => track.id === ref.trackId))));
  };
  const sections = library.map((album) => {
    const albumMatch = !q || norm(album.title).includes(q) || norm(album.artist).includes(q) || (album.genres ?? []).some((genre) => norm(genre).includes(q));
    const tracks = albumMatch ? album.tracks : album.tracks.filter((track) => norm(track.title).includes(q));
    return { album, tracks };
  }).filter((section) => section.tracks.length);
  return <div className="paste-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="paste-dialog pl-add" role="dialog" aria-label={t("Add tracks")} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div className="pl-add-head"><h2>{t("Add tracks")}</h2><span className="micro">{plural(chosen.length, "track")} {t("in the playlist")}</span>
        <button className="pill-btn" onClick={onFiles} disabled={busy}><Icon name="upload-simple" size={14} />{busy ? t("Reading files") : t("Add files")}</button></div>
      <div className="pl-search"><Icon name="magnifying-glass" size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search albums, artists, genres, tracks")} spellCheck={false} aria-label={t("Search your albums")} /></div>
      <div className="pl-albums">
        {sections.map(({ album, tracks }) => {
          const expanded = !!q || open.has(album.id);
          const picked = tracks.filter((track) => has(album, track)).length;
          return <div className="pl-album" key={album.id}>
            <div className="pl-album-head">
              <button className="pl-album-open" aria-expanded={expanded} onClick={() => setOpen((current) => { const next = new Set(current); next.has(album.id) ? next.delete(album.id) : next.add(album.id); return next; })}>
                <img src={album.coverThumbPath ? (album.coverThumbPath.startsWith("data:") ? album.coverThumbPath : asset(album.coverThumbPath)) : coverSrc(album)} alt="" />
                <span className="pl-album-text"><b>{album.title}</b><span>{album.artist} · {plural(album.tracks.length, "track")}{picked ? " · " + picked + " " + t("added") : ""}</span></span>
              </button>
              <button className="pill-btn" onClick={() => addAll(album, tracks)}>{picked === tracks.length ? t("Remove all") : t("Add all")}</button>
            </div>
            {expanded && <div className="pl-tracks">{tracks.map((track) => {
              const on = has(album, track);
              return <button className={"pl-track" + (on ? " on" : "")} key={track.id} aria-pressed={on} onClick={() => toggle(album, track)}>
                <span className="pl-check">{on && <Icon name="check" size={12} />}</span><span className="t">{track.title}</span><span className="mono">{time(track.duration)}</span>
              </button>;
            })}</div>}
          </div>;
        })}
        {!sections.length && <p className="pl-none">{library.length ? t("Nothing matches") + " “" + query.trim() + "”" : t("No albums yet — add audio files from your computer, or import an album first")}</p>}
      </div>
      <div className="pl-add-foot"><button className="pill-btn solid" onClick={onClose}><Icon name="check" size={14} />{t("Done")}</button></div>
    </div>
  </div>;
}

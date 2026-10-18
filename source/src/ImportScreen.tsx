import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { cancelImport, chooseAudio, chooseCover, chooseFolder, cleanName, deleteAlbum,
  expandPaths, naturalCompare, parseTrack, readBlob, saveAlbum } from "./library";
import { neutralProfile, prepareCover } from "./color";
import { asset } from "./library";
import { useApp } from "./state";
import { Icon } from "./PlayerScreen";
import type { Album, DraftTrack } from "./types";

const time = (seconds: number) => Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
interface Props { album?: Album; initialPaths?: string[]; onClose: (album?: Album, deleted?: boolean) => void }
export function ImportScreen({ album, initialPaths, onClose }: Props) {
  const [title, setTitle] = useState(album?.title || "");
  const [artist, setArtist] = useState(album?.artist || "");
  const [year, setYear] = useState(album?.year?.toString() || "");
  const [tracks, setTracks] = useState<DraftTrack[]>(album?.tracks.map((track) => ({
    // the track's own .lrc travels with it, or saving the edit would drop the lyrics of every track
    id: track.id, title: track.title, duration: track.duration, sourcePath: track.filePath, lyricsSource: track.lyricsPath
  })) || []);
  const [cover, setCover] = useState<Blob | null>(null);
  const [coverUrl, setCoverUrl] = useState(album?.coverPath ? asset(album.coverPath) : "");
  const [coverSource, setCoverSource] = useState("");
  const [warning, setWarning] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removed, setRemoved] = useState<{ track: DraftTrack; index: number; at: number } | null>(null);
  const [error, setError] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const artistRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ index: number; y: number } | null>(null);
  const ingest = useCallback(async (paths: string[], coverOnly = false) => {
    try {
      const expanded = await expandPaths(paths);
      if (coverOnly || (!expanded.audio.length && expanded.cover)) {
        const path = expanded.cover || paths.find((item) => /\.(jpe?g|png|webp)$/i.test(item));
        if (path) {
          const blob = await readBlob(path);
          setCover(blob); setCoverUrl(URL.createObjectURL(blob)); setCoverSource("");
        }
        return;
      }
      if (expanded.cover && !cover && !album?.coverPath) {
        const blob = await readBlob(expanded.cover);
        setCover(blob); setCoverUrl(URL.createObjectURL(blob)); setCoverSource("cover found in folder");
      }
      const parsed = [];
      for (let i = 0; i < expanded.audio.length; i++) {
        const path = expanded.audio[i];
        const placeholder: DraftTrack = { id: crypto.randomUUID(), title: cleanName(path), duration: 0, sourcePath: path };
        setTracks((current) => [...current, placeholder]);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        try {
          const item = await parseTrack(path);
          parsed.push({ ...item, track: { ...item.track, id: placeholder.id } });
          setTracks((current) => current.map((track) => track.id === placeholder.id ? { ...item.track, id: placeholder.id } : track));
          if (!cover && !album?.coverPath && item.picture) {
            setCover((current) => current || item.picture!);
            setCoverUrl((current) => current || URL.createObjectURL(item.picture!));
            setCoverSource("cover taken from file tags");
          }
        } catch {
          setTracks((current) => current.filter((track) => track.id !== placeholder.id));
          setWarning((current) => current + " Could not read " + cleanName(path) + ".");
        }
      }
      const albumTags = parsed.map((item) => item.album).filter(Boolean);
      const artistTags = parsed.map((item) => item.artist).filter(Boolean);
      if (!title && albumTags.length && albumTags.every((value) => value === albumTags[0])) setTitle(albumTags[0]!);
      else if (!title && paths.length === 1 && expanded.audio.length) setTitle(cleanName(paths[0]));
      if (!artist && artistTags.length) {
        const counts = new Map<string, number>();
        for (const value of artistTags) counts.set(value!, (counts.get(value!) || 0) + 1);
        setArtist([...counts].sort((a, b) => b[1] - a[1])[0][0]);
      }
      if (!year) setYear(String(parsed.find((item) => item.year)?.year || ""));
      if (!album && parsed.length && parsed.every((item) => item.track.trackNumber)) {
        const numbers = new Map(parsed.map((item) => [item.track.id, item.track.trackNumber!]));
        setTracks((current) => [...current].sort((a, b) => (numbers.get(a.id) || 0) - (numbers.get(b.id) || 0)));
      } else if (!album) setTracks((current) => [...current].sort((a, b) => naturalCompare(a.sourcePath, b.sourcePath)));
      if (expanded.lyrics.length) {
        const map = new Map(expanded.lyrics.map((path) => [cleanName(path).toLowerCase(), path]));
        setTracks((current) => current.map((track) => ({
          ...track, lyricsSource: map.get(cleanName(track.sourcePath).toLowerCase()) || map.get(track.title.toLowerCase()) || track.lyricsSource
        })));
      }
      if (expanded.skipped) setWarning(expanded.skipped + " files skipped — unsupported format");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read files"); }
  }, [album?.coverPath, artist, cover, title, year]);
  useEffect(() => {
    if (initialPaths?.length) void ingest(initialPaths);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "drop" && payload.paths) {
        const target = document.elementFromPoint(payload.position?.x || 0, payload.position?.y || 0);
        void ingest(payload.paths, !!target?.closest(".cover-zone"));
      }
    });
    return () => { void unlisten.then((stop) => stop()).catch(() => undefined); };
  }, [ingest]);
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<{ done: number; total: number }>("import-progress", (event) => setProgress(event.payload));
    return () => { void unlisten.then((stop) => stop()); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && removed && Date.now() - removed.at < 10000) {
        event.preventDefault();
        setTracks((current) => { const next = [...current]; next.splice(removed.index, 0, removed.track); return next; });
        setRemoved(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removed]);
  async function save() {
    if (!title.trim()) { titleRef.current?.focus(); setError("Album title is required"); return; }
    if (!artist.trim()) { artistRef.current?.focus(); setError("Artist is required"); return; }
    if (!tracks.length) { setError("Add at least one track"); return; }
    setSaving(true); setError("");
    try {
      const prepared = cover ? await prepareCover(cover) : undefined;
      if (prepared?.small) setWarning("Cover is smaller than 400 px and may appear soft.");
      const saved = await saveAlbum({
        id: album?.id || crypto.randomUUID(), title, artist,
        year: year ? Number(year) : undefined, colors: prepared?.colors || album?.colors || neutralProfile,
        tracks, coverBytes: prepared?.cover, thumbBytes: prepared?.thumb,
        existingCover: prepared ? undefined : album?.coverPath || undefined
      });
      if (prepared) URL.revokeObjectURL(prepared.url);
      onClose(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save album"); }
    finally { setSaving(false); }
  }
  async function removeAlbum() {
    if (!album) return;
    try { await deleteAlbum(album.id); onClose(undefined, true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete album"); }
  }
  const onDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    const change = Math.round((event.clientY - dragRef.current.y) / 44);
    if (!change) return;
    setTracks((current) => {
      const from = dragRef.current!.index;
      const to = Math.min(current.length - 1, Math.max(0, from + change));
      if (from === to) return current;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      dragRef.current = { index: to, y: event.clientY };
      return next;
    });
  };
  return <div className="screen import-view">
    <header className="header">
      <button className="pill-btn" onClick={() => saving ? void cancelImport() : onClose()}><Icon name="x" size={14} />Cancel</button>
      <div className="right"><span className="status">{tracks.length} {tracks.length === 1 ? "track" : "tracks"} · {time(tracks.reduce((sum, track) => sum + track.duration, 0))} · {saving ? "saving" : tracks.length && title.trim() && artist.trim() ? "ready" : "incomplete"}</span>
        <button className="pill-btn solid" onClick={() => void save()} disabled={saving || !title.trim() || !artist.trim() || !tracks.length}>
          <Icon name="check" size={14} />{album ? "Save changes" : "Save album"}
        </button>
      </div>
    </header>
    <div className="wrap">
      <h1 className="h1">{album ? "Edit album" : "New album"} <small>{tracks.length ? tracks.length + " files dropped" : "Drop audio files to begin"}</small></h1>
      <aside>
        <div className={"cover cover-zone" + (coverUrl ? "" : " empty")}>
          {coverUrl ? <img src={coverUrl} alt="Album cover" /> : <div className="cover-placeholder"><Icon name="image" size={32} /><span>Drop cover artwork</span></div>}
          <button className="pill-btn replace" onClick={() => void chooseCover().then((path) => path ? ingest([path], true) : undefined)}>
            <Icon name="image" size={14} />{coverUrl ? "Replace" : "Choose cover"}
          </button>
        </div>
        {coverUrl && <div className="cover-note"><Icon name="check" size={14} />Applied to all {tracks.length} {tracks.length === 1 ? "track" : "tracks"}</div>}
        <div className="side-actions">
          <button className="pill-btn" onClick={() => setPasteOpen(true)}><Icon name="clipboard-text" size={14} />Paste track titles</button>
          <button className="pill-btn" onClick={() => void chooseAudio().then((paths) => ingest(paths))}><Icon name="plus" size={14} />Add more files</button>
          {album && (confirmDelete ? <div className="delete-choice">Delete permanently? <button className="pill-btn" onClick={() => void removeAlbum()}>Delete</button><button className="pill-btn" onClick={() => setConfirmDelete(false)}>Keep</button></div>
            : <button className="pill-btn" onClick={() => setConfirmDelete(true)}>Delete album</button>)}
        </div>
        {coverSource && <p className="import-feedback">{coverSource}</p>}
        {warning && <p className="import-feedback">{warning}</p>}
        {error && <p className="import-feedback error">{error}</p>}
        {saving && <p className="import-feedback">Copying {progress.done} of {progress.total} files…</p>}
      </aside>
      <main>
        <div className="fields">
          <div className="field"><label className="micro" htmlFor="album-title">Album title</label><input className="in" id="album-title" ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Album title" /></div>
          <div className="field"><label className="micro" htmlFor="album-artist">Artist</label><input className="in" id="album-artist" ref={artistRef} value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" /></div>
          <div className="field"><label className="micro" htmlFor="album-year">Year</label><input className="in" id="album-year" value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="—" /></div>
        </div>
        <div className="list-head"><span className="micro">Tracks</span><div className="right"><span className="micro" style={{ color: "var(--ink-4)" }}>Drag to reorder · click a title to rename</span></div></div>
        <div className="rows">
          {tracks.map((track, index) => <div className="row" key={track.id}>
            <button className="drag" aria-label={"Move track " + (index + 1)}
              onPointerDown={(event) => { dragRef.current = { index, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={onDragMove} onPointerUp={() => { dragRef.current = null; }}><Icon name="dots-six-vertical" size={16} /></button>
            <span className="mono">{String(index + 1).padStart(2, "0")}</span>
            <span className="track-cell"><input className="t" value={track.title} onChange={(event) => setTracks((current) => current.map((item) => item.id === track.id ? { ...item, title: event.target.value } : item))}
              onKeyDown={(event) => { if (event.key === "Enter") (event.currentTarget.closest(".row")?.nextElementSibling?.querySelector("input.t") as HTMLInputElement | null)?.focus(); }} />
              <span className="src">{track.sourcePath.split(/[\\/]/).pop()}</span></span>
            <span className="mono">{track.duration ? time(track.duration) : "—"}</span>
            <button className="icon-btn x" aria-label={"Remove " + track.title} style={{ width: 28, height: 28 }} onClick={() => {
              setTracks((current) => current.filter((item) => item.id !== track.id));
              setRemoved({ track, index, at: Date.now() });
            }}><Icon name="x" size={14} /></button>
          </div>)}
        </div>
        <button className="drop" onClick={() => void chooseAudio().then((paths) => ingest(paths))}><Icon name="upload-simple" />Drop more audio files here, or <u>browse</u></button>
        {removed && Date.now() - removed.at < 10000 && <p className="import-feedback">Track removed · Ctrl+Z to undo</p>}
      </main>
    </div>
    {pasteOpen && <div className="paste-overlay"><div className="paste-dialog">
      <h2>Paste track titles</h2><p>One title per line, in album order.</p>
      <textarea autoFocus value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={"First track\nSecond track"} />
      <div><button className="pill-btn" onClick={() => setPasteOpen(false)}>Cancel</button>
        <button className="pill-btn solid" onClick={() => {
          const lines = pasteText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (!lines.length) { setError("Paste at least one title"); return; }
          setTracks((current) => current.map((track, index) => lines[index] ? { ...track, title: lines[index] } : track));
          setPasteOpen(false); setPasteText("");
        }}>Apply titles</button></div>
    </div></div>}
  </div>;
}

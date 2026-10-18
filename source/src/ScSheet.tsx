import { useEffect, useMemo, useState } from "react";
import { addRemoteAlbum, useApp } from "./state";
import { scAddPlaylist, scAddTracks, scLikes, scPlaylists, scResolve } from "./soundcloud";
import type { ScPlaylistRow, ScTrackRow } from "./soundcloud";
import { ScLogo } from "./ScParts";
import { Icon, time } from "./PlayerScreen";

type Tab = "link" | "playlists" | "likes";
type Resolved = Awaited<ReturnType<typeof scResolve>>;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** "Add from SoundCloud": paste a link, pick a playlist / album, or gather liked tracks into a record. */
export function ScSheet() {
  const albums = useApp((state) => state.albums);
  const [tab, setTab] = useState<Tab>("link");
  const [busy, setBusy] = useState<string | null>(null);          // which action is running
  const [error, setError] = useState("");
  const inCrate = useMemo(() => new Set(albums.filter((a) => a.source?.kind === "soundcloud").map((a) => a.id)), [albums]);
  const close = () => useApp.setState({ scSheet: false });
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    addEventListener("keydown", key, true); return () => removeEventListener("keydown", key, true);
  }, []);
  const run = async (what: string, job: () => Promise<void>) => {
    setBusy(what); setError("");
    try { await job(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const added = (title: string) => useApp.setState({ message: `“${title}” is in the crate` });

  // ---- link
  const [link, setLink] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const resolve = () => run("resolve", async () => { setResolved(null); setResolved(await scResolve(link)); });

  // ---- playlists
  const [playlists, setPlaylists] = useState<ScPlaylistRow[] | null>(null);
  useEffect(() => { if (tab === "playlists" && !playlists) void run("load", async () => setPlaylists(await scPlaylists())); }, [tab]);

  // ---- likes
  const [likes, setLikes] = useState<ScTrackRow[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [name, setName] = useState("Likes");
  const [filter, setFilter] = useState("");
  useEffect(() => { if (tab === "likes" && !likes) void run("load", async () => setLikes(await scLikes())); }, [tab]);
  const shown = (likes ?? []).filter((t) => !filter || (t.title + " " + t.artist).toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: number) => setPicked((set) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const addPlaylist = (p: ScPlaylistRow) => run("pl-" + p.id, async () => { const album = await scAddPlaylist(p.id); addRemoteAlbum(album); added(album.title); });
  const addTracks = (title: string, rows: ScTrackRow[]) => run("tracks", async () => { const album = await scAddTracks(title, rows); addRemoteAlbum(album); added(album.title); setPicked(new Set()); });

  return <div className="sc-sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="sc-sheet" role="dialog" aria-label="Add from SoundCloud">
      <header>
        <div className="sc-title"><ScLogo size={10} /><h2>Add from SoundCloud</h2></div>
        <nav className="sc-tabs" role="tablist">
          {(["link", "playlists", "likes"] as Tab[]).map((id) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => { setTab(id); setError(""); }}>
            {id === "link" ? "Link" : id === "playlists" ? "Playlists & albums" : "Likes"}</button>)}
        </nav>
        <button className="icon-btn" aria-label="Close" onClick={close}><Icon name="x" /></button>
      </header>

      {tab === "link" && <section className="sc-body">
        <form className="sc-link" onSubmit={(event) => { event.preventDefault(); if (link.trim()) void resolve(); }}>
          <input autoFocus value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste a soundcloud.com link — track, album or playlist" />
          <button className="pill-btn solid" disabled={!link.trim() || busy === "resolve"}>{busy === "resolve" ? "Looking…" : "Find"}</button>
        </form>
        {resolved?.kind === "set" && <div className="sc-preview">
          <Art src={resolved.playlist.artwork} big />
          <div className="sc-preview-text">
            <span className="mono">{resolved.playlist.kind === "album" ? "Album" : "Playlist"} · {resolved.playlist.count} tracks</span>
            <h3>{resolved.playlist.title}</h3><span className="sub">{resolved.playlist.owner}</span>
            <ol>{resolved.tracks.slice(0, 6).map((t) => <li key={t.id} className={t.playable ? "" : "off"}>{t.title}<span className="mono">{time(t.duration)}</span></li>)}
              {resolved.tracks.length > 6 && <li className="more">+ {resolved.tracks.length - 6} more</li>}</ol>
          </div>
          <AddButton done={inCrate.has("sc-pl-" + resolved.playlist.id)} busy={busy === "pl-" + resolved.playlist.id} onClick={() => void addPlaylist(resolved.playlist)} />
        </div>}
        {resolved?.kind === "track" && <div className="sc-preview">
          <Art src={resolved.track.artwork} big />
          <div className="sc-preview-text"><span className="mono">Track · {time(resolved.track.duration)}</span><h3>{resolved.track.title}</h3><span className="sub">{resolved.track.artist}</span>
            {!resolved.track.playable && <p className="warn">This track can only be played on SoundCloud.</p>}</div>
          <AddButton done={inCrate.has("sc-mix-" + resolved.track.id)} busy={busy === "tracks"} disabled={!resolved.track.playable} label="Add as a single" onClick={() => void addTracks(resolved.track.title, [resolved.track])} />
        </div>}
        {!resolved && !error && <p className="sc-hint">A playlist or an album becomes one record. A single track becomes a 7″ of its own.</p>}
      </section>}

      {tab === "playlists" && <section className="sc-body"><div className="sc-list">
        {busy === "load" && <p className="sc-hint">Loading your playlists…</p>}
        {playlists?.length === 0 && <p className="sc-hint">No playlists or albums on this account yet.</p>}
        {playlists?.map((p) => <div className="sc-row" key={p.id}>
          <Art src={p.artwork} />
          <div className="sc-row-text"><b>{p.title}</b><span>{p.owner} · {p.count} {p.count === 1 ? "track" : "tracks"}{p.kind === "album" ? " · album" : ""}</span></div>
          <AddButton done={inCrate.has("sc-pl-" + p.id)} busy={busy === "pl-" + p.id} onClick={() => void addPlaylist(p)} />
        </div>)}
      </div></section>}

      {tab === "likes" && <section className="sc-body sc-likes">
        <div className="sc-likes-bar">
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter likes" />
          <button className="pill-btn" onClick={() => setPicked(new Set(shown.filter((t) => t.playable).map((t) => t.id)))}>Select all</button>
          {picked.size > 0 && <button className="pill-btn" onClick={() => setPicked(new Set())}>Clear</button>}
        </div>
        <div className="sc-list">
          {busy === "load" && <p className="sc-hint">Loading your likes…</p>}
          {shown.map((t) => <label className={"sc-row pick" + (t.playable ? "" : " off") + (picked.has(t.id) ? " on" : "")} key={t.id}>
            <input type="checkbox" disabled={!t.playable} checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
            <Art src={t.artwork} />
            <div className="sc-row-text"><b>{t.title}</b><span>{t.artist}{t.playable ? "" : " · SoundCloud only"}</span></div>
            <span className="mono">{time(t.duration)}</span>
          </label>)}
        </div>
        <footer className="sc-likes-foot">
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Record title" placeholder="Record title" />
          <button className="pill-btn solid" disabled={!picked.size || busy === "tracks"}
            onClick={() => void addTracks(name, (likes ?? []).filter((t) => picked.has(t.id)))}>
            {busy === "tracks" ? "Pressing…" : picked.size ? `Add ${picked.size} ${picked.size === 1 ? "track" : "tracks"} as a record` : "Pick tracks to press a record"}</button>
        </footer>
      </section>}

      {error && <p className="sc-error" role="alert">{error}</p>}
    </div>
  </div>;
}

function Art({ src, big = false }: { src: string; big?: boolean }) {
  return src ? <img className={"sc-art" + (big ? " big" : "")} src={src} alt="" /> : <span className={"sc-art empty" + (big ? " big" : "")}><ScLogo size={big ? 14 : 7} /></span>;
}
function AddButton({ done, busy, disabled, label = "Add to crate", onClick }: { done: boolean; busy: boolean; disabled?: boolean; label?: string; onClick: () => void }) {
  return <button className={"pill-btn" + (done ? " done" : " solid")} disabled={busy || disabled} onClick={onClick}>
    {busy ? "Adding…" : done ? <><Icon name="check" size={13} />In the crate</> : <><Icon name="plus" size={13} />{label}</>}</button>;
}

import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { crateAlbums, setCrateGenre, useApp } from "./state";
import { addToAlbum, findLink, say } from "./download";
import { readLink } from "./link";
import type { Found } from "./download";
import { cancel, clearFinished, enqueue, remove, retry, useDownloads } from "./downloads";
import type { Job } from "./downloads";
import { DownloadIcon } from "./DownloadIcon";
import { Icon } from "./PlayerScreen";
import { stopAlbum } from "./player";
import { count, t } from "./lang";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** "Download" (the button on the right of the crate header): paste a SoundCloud link, see what is behind it, put it on the queue.
    With `albumId` (the "Add to album" button on the deck): one track, pressed into that album or playlist right away. */
export function DownloadSheet({ albumId }: { albumId?: string }) {
  const [link, setLink] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const lookup = useRef(0);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const target = useApp((state) => albumId ? state.albums.find((album) => album.id === albumId) : undefined);
  const isPlaylist = target?.kind === "playlist";
  const close = () => { if (!adding) useApp.setState({ download: false }); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    addEventListener("keydown", key, true); return () => removeEventListener("keydown", key, true);
  }, [adding]);

  const find = async () => {
    setBusy(true); setError(""); setFound(null);
    // the first time, Turntable fetches its downloader (yt-dlp, ~17 MB) before it can look at the link
    if (isTauri() && !(await invoke<boolean>("ytdlp_ready").catch(() => true))) setNote(t("Getting the downloader (one time, about 17 MB)…"));
    const mine = ++lookup.current;       // the field may be edited while the lookup runs: an answer for old text is dropped
    try { const result = await findLink(link); if (mine === lookup.current) setFound(result); }
    catch (cause) { if (mine === lookup.current) setError(say(errorText(cause))); }
    finally { if (mine === lookup.current) { setBusy(false); setNote(""); } }
  };
  const add = async () => {
    if (!found) return;
    if (albumId && !target) { setError(t("This album is gone.")); return; }
    if (!target) {
      const checked = readLink(link);
      useApp.setState({ download: false, message: t(enqueue(checked.ok ? checked.url : link.trim(), found) ? "Added to Downloads" : "Already in Downloads") });
      return;
    }
    setAdding(true); setError("");
    try {
      // pressing the album again replaces its files: what is playing from it stops then, like after editing it (not before the download: it can fail)
      const stopIfPlaying = async () => { if (useApp.getState().activeAlbumId === target.id) await stopAlbum().catch(() => undefined); };
      const saved = await addToAlbum(target, found, isPlaylist ? undefined : stopIfPlaying);
      if (saved) {
        const next = [...useApp.getState().albums.filter((item) => item.id !== saved.id), saved].sort((a, b) => b.addedAt - a.addedAt);
        useApp.setState({ albums: next, focused: next.findIndex((item) => item.id === saved.id), screen: "crate", activeAlbumId: null });
      }
      useApp.setState({ download: false, message: `“${target.title}”: ${t("track added")}` });
    } catch (cause) { setError(say(errorText(cause))); setAdding(false); }
  };

  const total = found?.tracks.length ?? 0;
  const label = albumId ? isPlaylist ? t("Add to playlist") : t("Add to album") : t("Download from SoundCloud");
  return <div className="dl-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="dl-sheet dl-card" role="dialog" aria-label={label}>
      <header>
        <div className="dl-title"><DownloadIcon size={16} /><h2>{label}{target ? <em> · {target.title}</em> : null}</h2></div>
        <button className="icon-btn" aria-label={t("Close")} disabled={adding} onClick={close}><Icon name="x" /></button>
      </header>
      <form className="dl-link" onSubmit={(event) => { event.preventDefault(); if (link.trim() && !busy && !adding) void find(); }}>
        <input autoFocus value={link} disabled={adding} aria-invalid={!!error} onChange={(event) => { lookup.current++; setLink(event.target.value); setError(""); setFound(null); setBusy(false); setNote(""); }}
          placeholder={albumId ? t("Paste a link to one SoundCloud track") : t("Paste a soundcloud.com link — track, album or playlist")} spellCheck={false} />
        <button className="pill-btn solid" disabled={!link.trim() || busy || adding}>{busy ? t("Looking…") : t("Find")}</button>
      </form>
      {found && <div className="dl-preview">
        {found.cover ? <img className="dl-art" src={found.cover} alt="" /> : <span className="dl-art empty"><DownloadIcon size={26} /></span>}
        <div className="dl-preview-text">
          <span className="mono">{found.kind === "set" ? t("Album") : t("Track")} · {count(total, "track")}</span>
          <h3>{found.title}</h3><span className="sub">{found.author}</span>
          {found.kind === "set" && found.tracks.some((track) => track.title) && <ol>{found.tracks.slice(0, 5).map((track, index) => <li key={track.url}>{track.title || `#${index + 1}`}</li>)}
            {total > 5 && <li className="more">+ {total - 5} {t("more")}</li>}</ol>}
        </div>
        <button className="pill-btn solid" disabled={adding || (!!albumId && found.kind !== "track")} onClick={() => void add()}>
          {adding ? t("Adding…") : <><DownloadIcon size={13} />{albumId ? label : t("Download to the crate")}</>}</button>
      </div>}
      {found && albumId && found.kind !== "track" && <p className="dl-hint">{t("That's a playlist or an album — paste a link to one track.")}</p>}
      {note && <p className="dl-hint" role="status">{note}</p>}
      {!found && !error && !note && <p className="dl-hint">{albumId ? t("The track goes to the end of this record.") : t("An album or a playlist becomes one record in the crate. A single track becomes a record of its own.")}</p>}
      {error && <p className="dl-error" role="alert">{error}</p>}
    </div>
  </div>;
}

function showInCrate(albumId: string) {
  if (useApp.getState().genre && !crateAlbums().some((album) => album.id === albumId)) setCrateGenre(null);
  const at = crateAlbums().findIndex((album) => album.id === albumId);
  if (at >= 0) useApp.setState({ section: "albums", focused: at });
}

/** seconds left until `until`, ticking once a second; 0 when there is no pause (or it is over) */
function useCountdown(until?: number): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const timer = setInterval(() => { tick((n) => n + 1); if (Date.now() >= until) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
}

function JobCard({ job }: { job: Job }) {
  const settled = job.tracks.filter((track) => track.state === "done" || track.state === "fail").length;
  const failed = job.tracks.filter((track) => track.state === "fail").length;
  const live = job.status === "running" || job.status === "queued";
  const inCrate = useApp((state) => !!job.albumId && state.albums.some((album) => album.id === job.albumId));
  const paused = useCountdown(job.status === "running" ? job.pausedUntil : undefined);
  const status = job.status === "queued" ? t("In the queue")
    : job.status === "running" ? `${t("Downloading…")} ${settled} / ${job.tracks.length}` + (paused > 0 ? ` · ${t("SoundCloud asked to slow down, continuing in")} ${paused} ${t("s")}` : "")
    : job.status === "done" ? t("In the crate") + (failed ? ` · ${t("skipped")} ${failed}` : "")
    : say(job.error || "Could not download");
  // a long playlist would list hundreds of lines: then only what is happening now, waiting on SoundCloud, or lost
  const lines = job.kind !== "set" ? [] : job.status === "running" ? job.tracks.filter((track) => job.tracks.length <= 30 || track.state === "run" || track.state === "fail" || !!track.reason)
    : failed > 0 ? job.tracks.filter((track) => track.state === "fail") : [];
  return <article className={"dj dj-" + job.status}>
    {job.cover ? <img className="dj-art" src={job.cover} alt="" /> : <span className="dj-art empty"><DownloadIcon size={20} /></span>}
    <div className="dj-main">
      <div className="dj-head">
        <div className="dj-text"><b>{job.title}</b><span>{job.author} · {job.kind === "set" ? count(job.tracks.length, "track") : t("Track")}</span></div>
        <div className="dj-actions">
          {job.status === "done" && inCrate && <button className="pill-btn small" onClick={() => showInCrate(job.albumId!)}>{t("Show in the crate")}</button>}
          {job.status === "failed" && <button className="pill-btn small" onClick={() => retry(job.id)}>{t("Retry")}</button>}
          <button className="icon-btn" aria-label={live ? t("Cancel") : t("Remove")} title={live ? t("Cancel") : t("Remove")} onClick={() => live ? cancel(job.id) : remove(job.id)}><Icon name="x" size={14} /></button>
        </div>
      </div>
      <div className={"dj-status" + (job.status === "failed" ? " bad" : "")}>{status}</div>
      {live && <div className="dl-bar"><span className={job.status === "queued" ? "wait" : ""} style={{ width: `${job.tracks.length ? Math.round(settled / job.tracks.length * 100) : 0}%` }} /></div>}
      {lines.length > 0 && <ul className="dj-tracks">{lines.map((track) => <li key={track.url} className={"is-" + track.state}>
        <i />{track.title || `#${job.tracks.indexOf(track) + 1}`}{track.reason ? <em> — {say(track.reason)}</em> : null}</li>)}</ul>}
    </div>
  </article>;
}

/** The "Downloads" screen (the button on the left of the crate header): what is downloading now and what came before. */
export function DownloadsScreen() {
  const jobs = useDownloads((state) => state.jobs);
  const active = jobs.filter((job) => job.status === "running" || job.status === "queued").length;
  const finished = jobs.length - active;
  return <div className="screen downloads-screen">
    <header className="header">
      <div className="brand"><span className="h">{t("Downloads")}</span>{active > 0 && <span className="mono">{active} {t("in progress")}</span>}</div>
      <div className="hright"><button className="pill-btn solid" onClick={() => useApp.setState({ download: true })}><DownloadIcon />{t("Download")}</button></div>
    </header>
    <div className="dl-scroll">
      {finished > 0 && <div className="dl-list-head"><h3>{t("Queue and history")}</h3><button className="pill-btn small" onClick={clearFinished}>{t("Clear finished")}</button></div>}
      {jobs.map((job) => <JobCard key={job.id} job={job} />)}
      {jobs.length === 0 && <p className="dl-empty">{t("Nothing downloaded yet. Press Download and paste a link.")}</p>}
    </div>
  </div>;
}

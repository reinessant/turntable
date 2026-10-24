/* The download queue behind the "Downloads" tab: jobs run one after another (a job's tracks run a few at a time, see
   download.ts), the tab shows them live, and finished ones are kept in downloads.json so the list survives a restart. */
import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { downloadTracks } from "./download";
import type { Found, TrackState } from "./download";
import { crateAlbums, useApp } from "./state";
import { t } from "./lang";

export interface JobTrack { url: string; title: string; state: TrackState; reason?: string }
export type JobStatus = "queued" | "running" | "done" | "failed";
export interface Job {
  id: string; link: string; kind: Found["kind"]; title: string; author: string; cover: string; year?: number; info?: string;
  tracks: JobTrack[]; status: JobStatus; error?: string; albumId?: string; addedAt: number; finishedAt?: number;
  /** SoundCloud asked to slow down: nothing is requested until this moment (ms since epoch) */
  pausedUntil?: number;
}

const STORE = "downloads.json";
const KEEP = 30;
export const useDownloads = create<{ jobs: Job[] }>(() => ({ jobs: [] }));
const cancelled = new Set<string>();

const patch = (id: string, change: (job: Job) => Job) => useDownloads.setState((state) => ({ jobs: state.jobs.map((job) => job.id === id ? change(job) : job) }));
const patchTrack = (id: string, index: number, change: Partial<JobTrack>) => patch(id, (job) => ({ ...job, tracks: job.tracks.map((track, i) => i === index ? { ...track, ...change } : track) }));

async function persist(): Promise<void> {
  if (!isTauri()) return;
  try {
    const finished = useDownloads.getState().jobs.filter((job) => job.status === "done" || job.status === "failed").slice(0, KEEP)
      .map(({ info: _info, ...job }) => job);
    const store = await load(STORE, { autoSave: false });
    await store.set("jobs", finished);
    await store.save();
  } catch { /* the list is a convenience; a failed save must not break downloading */ }
}

export async function loadDownloads(): Promise<void> {
  if (!isTauri()) return;
  void invoke("clear_downloads").catch(() => undefined);
  try {
    const store = await load(STORE, { autoSave: false });
    const saved = (await store.get<Job[]>("jobs")) ?? [];
    useDownloads.setState((state) => ({ jobs: [...state.jobs, ...saved.filter((job) => !state.jobs.some((item) => item.id === job.id))] }));
  } catch { /* nothing saved yet */ }
}

/** dev only (?reference=downloads in a plain browser): a few jobs in every state, to lay the tab out */
export function seedDemoDownloads(): void {
  const track = (title: string, state: JobTrack["state"], reason?: string): JobTrack => ({ url: "https://soundcloud.com/x/" + title, title, state, reason });
  const base = { link: "https://soundcloud.com/x", cover: "", addedAt: Date.now() };
  useDownloads.setState({ jobs: [
    { ...base, id: "d1", kind: "set", title: "Avant Nova", author: "slayr", status: "running", tracks: [track("promise", "done"), track("Whats Happening", "done"), track("yes, you may", "run"), track("Money Hungry", "run"), track("24/7", "wait"), track("On my way!", "wait")] },
    { ...base, id: "d2", kind: "track", title: "bologna 2", author: "boolymon", status: "queued", tracks: [track("bologna 2", "wait")] },
    { ...base, id: "d3", kind: "set", title: "Half Blood", author: "slayr", status: "done", albumId: "none", tracks: [track("a", "done"), track("b", "done"), track("c", "fail", "This track is not available")] , finishedAt: Date.now() },
    { ...base, id: "d4", kind: "track", title: "Not Obama (dexey! Flip)", author: "Big Baby Tape", status: "failed", error: "Unable to download JSON metadata: HTTP Error 404", tracks: [track("Not Obama", "fail")], finishedAt: Date.now() }
  ] });
}

/** Puts a found link on the queue; false when the same link is already waiting or downloading (pressed twice, two records). */
export function enqueue(link: string, found: Found): boolean {
  const same = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
  if (useDownloads.getState().jobs.some((item) => (item.status === "queued" || item.status === "running") && same(item.link, link))) return false;
  const job: Job = {
    id: crypto.randomUUID(), link, kind: found.kind, title: found.title, author: found.author, cover: found.cover, year: found.year, info: found.info,
    tracks: found.tracks.map((track) => ({ url: track.url, title: track.title, state: "wait" as const })), status: "queued", addedAt: Date.now()
  };
  useDownloads.setState((state) => ({ jobs: [job, ...state.jobs] }));
  void pump();
  return true;
}

export function retry(id: string): void {
  patch(id, (job) => ({ ...job, status: "queued", error: undefined, finishedAt: undefined, pausedUntil: undefined, tracks: job.tracks.map((track) => ({ ...track, state: "wait", reason: undefined })) }));
  void pump();
}

/** A queued job leaves the list; a running one stops taking new tracks and is dropped when the ones in flight end. */
export function cancel(id: string): void {
  const job = useDownloads.getState().jobs.find((item) => item.id === id);
  if (!job) return;
  if (job.status === "running") { cancelled.add(id); return; }
  remove(id);
}

export function remove(id: string): void {
  useDownloads.setState((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
  void persist();
}

export function clearFinished(): void {
  useDownloads.setState((state) => ({ jobs: state.jobs.filter((job) => job.status === "queued" || job.status === "running") }));
  void persist();
}

let working = false;
async function pump(): Promise<void> {
  // dev in a plain browser, promo videos: the queue only holds the jobs, the capture script plays their progress
  if (import.meta.env.DEV && !isTauri() && (globalThis as { __noRun?: boolean }).__noRun) return;
  if (working) return;
  working = true;
  try {
    for (;;) {
      const job = [...useDownloads.getState().jobs].reverse().find((item) => item.status === "queued");   // oldest first
      if (!job) break;
      await runJob(job);
    }
  } finally { working = false; }
}

async function runJob(job: Job): Promise<void> {
  cancelled.delete(job.id);                // a stale "cancel" (the job had already finished) must not cancel a retry
  patch(job.id, (item) => ({ ...item, status: "running", error: undefined }));
  const found: Found = { kind: job.kind, title: job.title, author: job.author, cover: job.cover, year: job.year, info: job.info,
    tracks: job.tracks.map((track) => ({ url: track.url, title: track.title, author: job.author })) };
  try {
    const { album, skipped } = await downloadTracks(found, {
      start: (index) => patchTrack(job.id, index, { state: "run", reason: undefined }),
      finish: (index, state, reason, title) => patchTrack(job.id, index, title ? { state, reason, title } : { state, reason }),
      retry: (index, reason) => patchTrack(job.id, index, { state: "wait", reason }),
      pause: (until) => patch(job.id, (item) => ({ ...item, pausedUntil: until })),
      cancelled: () => cancelled.has(job.id)
    });
    const before = useApp.getState();
    const current = crateAlbums(before)[before.focused]?.id;
    const next = [album, ...before.albums.filter((item) => item.id !== album.id)].sort((a, b) => b.addedAt - a.addedAt);
    const at = crateAlbums({ albums: next, genre: before.genre }).findIndex((item) => item.id === current);
    useApp.setState({ albums: next, focused: at >= 0 ? at : 0, message: `“${album.title}” ${t("is in the crate")}${skipped ? ` · ${t("skipped")} ${skipped}` : ""}` });
    patch(job.id, (item) => ({ ...item, status: "done", albumId: album.id, title: album.title, author: album.artist, info: undefined, pausedUntil: undefined, finishedAt: Date.now() }));
  } catch (error) {
    if (cancelled.has(job.id)) { cancelled.delete(job.id); useDownloads.setState((state) => ({ jobs: state.jobs.filter((item) => item.id !== job.id) })); }
    else patch(job.id, (item) => ({ ...item, status: "failed", error: error instanceof Error ? error.message : String(error), info: undefined, pausedUntil: undefined, finishedAt: Date.now() }));
  }
  cancelled.delete(job.id);
  void persist();
}

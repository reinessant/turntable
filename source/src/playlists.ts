/* Playlists: a list of tracks taken from albums already in the library. They are stored as references
   (album id + track id) in playlists.json, with a small cover of their own, and shown in the crate like any other
   record: `resolvePlaylist` turns one into an Album whose tracks point at the original files, so the deck, the mini
   player, search and stats need no special case. The sync below keeps those resolved copies in step with the albums
   (a re-imported album gets new files, a deleted one drops out of the list). */
import { isTauri } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { neutralProfile, prepareCover } from "./color";
import { readBlob } from "./library";
import { coverSrc } from "./PlayerScreen";
import { crateAlbums, useApp } from "./state";
import { withGenre } from "./genres";
import { t, useLang } from "./lang";
import type { Album, ColorProfile, Playlist, Track } from "./types";

const LOCAL_KEY = "turntable.playlists";
let storeFile: Awaited<ReturnType<typeof load>> | null = null;
const store = async () => storeFile ??= await load("playlists.json", { autoSave: false });

/** One stored playlist made well-formed (or dropped): a damaged playlists.json must not break the crate. */
export function cleanPlaylist(raw: unknown): Playlist | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id || typeof p.title !== "string") return null;
  const refs = (Array.isArray(p.refs) ? p.refs : []).flatMap((ref: unknown) => {
    const r = ref as Record<string, unknown> | null;
    return r && typeof r.albumId === "string" && typeof r.trackId === "string" ? [{ albumId: r.albumId, trackId: r.trackId }] : [];
  });
  // the same track twice would be two rows with one key
  const seen = new Set<string>();
  const unique = refs.filter((ref) => { const key = ref.albumId + "/" + ref.trackId; if (seen.has(key)) return false; seen.add(key); return true; });
  const genres = (Array.isArray(p.genres) ? p.genres : []).reduce<string[]>((list, g: unknown) => typeof g === "string" ? withGenre(list, g) : list, []);
  return {
    id: p.id, title: p.title, description: typeof p.description === "string" ? p.description : "", genres,
    cover: typeof p.cover === "string" ? p.cover : "", thumb: typeof p.thumb === "string" ? p.thumb : "",
    colors: p.colors && typeof p.colors === "object" ? p.colors as ColorProfile : neutralProfile,
    refs: unique, addedAt: typeof p.addedAt === "number" && Number.isFinite(p.addedAt) ? p.addedAt : 0, liked: p.liked === true
  };
}
export async function loadPlaylists(): Promise<void> {
  let list: Playlist[] = [];
  try {
    const raw = isTauri() ? (await (await store()).get<unknown>("playlists")) ?? [] : JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    list = (Array.isArray(raw) ? raw : []).flatMap((item: unknown) => { const clean = cleanPlaylist(item); return clean ? [clean] : []; });
  } catch (error) { useApp.setState({ message: "Playlists: " + String(error) }); }
  useApp.setState({ playlists: list });
}
async function persist(list: Playlist[]): Promise<void> {
  if (!isTauri()) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* private window: fine */ } return; }
  const file = await store();
  await file.set("playlists", list);
  await file.save();
}
export async function savePlaylist(playlist: Playlist): Promise<void> {
  const list = [...useApp.getState().playlists.filter((item) => item.id !== playlist.id), playlist];
  useApp.setState({ playlists: list });
  await persist(list);
}
export async function removePlaylist(id: string): Promise<void> {
  const list = useApp.getState().playlists.filter((item) => item.id !== id);
  useApp.setState({ playlists: list });
  await persist(list);
}

export function resolvePlaylist(playlist: Playlist, albums: Album[]): Album {
  const byId = new Map(albums.map((album) => [album.id, album]));
  const tracks: Track[] = [];
  for (const ref of playlist.refs) {
    const source = byId.get(ref.albumId), track = source?.tracks.find((item) => item.id === ref.trackId);
    if (source && track) tracks.push({ ...track, albumId: playlist.id, index: tracks.length + 1, artist: source.artist, albumTitle: source.title, sourceAlbumId: source.id });
  }
  return {
    id: playlist.id, kind: "playlist", title: playlist.title, artist: t("Playlist"), description: playlist.description, genres: playlist.genres,
    coverPath: playlist.cover, coverThumbPath: playlist.thumb, colors: playlist.colors, tracks, addedAt: playlist.addedAt, liked: playlist.liked
  };
}

/** Keeps the playlists inside `albums` (resolved) up to date: when the albums or the stored playlists change, the
    resolved copies are rebuilt in place — the crate's order stays as the user left it. Call once at launch. */
export function startPlaylistSync(): () => void {
  let lastReal: Album[] = [], lastDefs: Playlist[] | null = null;
  const run = () => {
    const state = useApp.getState();
    const real = state.albums.filter((album) => album.kind !== "playlist");
    if (state.playlists === lastDefs && real.length === lastReal.length && real.every((album, i) => album === lastReal[i])) return;
    lastReal = real; lastDefs = state.playlists;
    const resolved = new Map(state.playlists.map((playlist) => [playlist.id, resolvePlaylist(playlist, real)]));
    const next: Album[] = [];
    for (const album of state.albums) {
      if (album.kind !== "playlist") next.push(album);
      else { const again = resolved.get(album.id); if (again) { next.push(again); resolved.delete(album.id); } }
    }
    // playlists that are new to the list go where their date puts them (the list is newest first)
    for (const playlist of [...resolved.values()].sort((a, b) => b.addedAt - a.addedAt)) {
      const at = next.findIndex((album) => album.addedAt < playlist.addedAt);
      next.splice(at < 0 ? next.length : at, 0, playlist);
    }
    // a playlist that appeared before the record in front must not push another record to the front
    const current = crateAlbums(state)[state.focused]?.id;
    const focused = crateAlbums({ albums: next, genre: state.genre }).findIndex((album) => album.id === current);
    // the playlist that is on the deck was edited (or lost an album): the track being played keeps its place in the list
    const patch: { albums: Album[]; focused?: number; trackIndex?: number } = { albums: next };
    if (focused >= 0) patch.focused = focused;
    const playing = state.albums.find((album) => album.id === state.activeAlbumId);
    const again = next.find((album) => album.id === state.activeAlbumId);
    if (playing?.kind === "playlist" && again) {
      const id = playing.tracks[state.trackIndex]?.id, at = id ? again.tracks.findIndex((track) => track.id === id) : -1;
      if (at >= 0) patch.trackIndex = at;
      else if (again.tracks.length && state.trackIndex > again.tracks.length - 1) patch.trackIndex = again.tracks.length - 1;
    }
    useApp.setState(patch);
  };
  run();
  // the word "Playlist" stands in for the artist: rebuild when the language changes
  const stopLang = useLang.subscribe(() => { lastDefs = null; run(); });
  const stop = useApp.subscribe(run);
  return () => { stop(); stopLang(); };
}

/* ---------------------------------------------------------------- covers */
async function bitmapOf(album: Album): Promise<ImageBitmap | null> {
  try {
    const path = album.coverPath;
    if (!path) return null;
    const blob = path.startsWith("data:") || path.startsWith("/") ? await (await fetch(coverSrc(album))).blob() : await readBlob(path);
    return await createImageBitmap(blob);
  } catch { return null; }
}
/** A square collage of up to four of the albums' covers (one cover alone, two side by side, three or four in a grid). */
export async function makeCollage(albums: Album[]): Promise<Blob | null> {
  const bitmaps = (await Promise.all(albums.slice(0, 4).map(bitmapOf))).filter((bitmap): bitmap is ImageBitmap => !!bitmap);
  if (!bitmaps.length) return null;
  const size = 800, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#16161a"; ctx.fillRect(0, 0, size, size);
  const cells: [number, number, number, number][] = bitmaps.length === 1 ? [[0, 0, size, size]]
    : bitmaps.length === 2 ? [[0, 0, size / 2, size], [size / 2, 0, size / 2, size]]
    : [[0, 0, size / 2, size / 2], [size / 2, 0, size / 2, size / 2], [0, size / 2, size / 2, size / 2], [size / 2, size / 2, size / 2, size / 2]];
  cells.forEach(([x, y, w, h], i) => {
    const bitmap = bitmaps[i % bitmaps.length];
    // cover-fit the picture into its cell
    const scale = Math.max(w / bitmap.width, h / bitmap.height), sw = w / scale, sh = h / scale;
    ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, x, y, w, h);
  });
  bitmaps.forEach((bitmap) => bitmap.close());
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", .88));
}

const dataUrl = (bytes: number[]) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
});
/** A picture (the collage, or one the user chose) → the data: URLs and colour profile a playlist stores. */
export async function playlistCover(blob: Blob): Promise<{ cover: string; thumb: string; colors: ColorProfile }> {
  const prepared = await prepareCover(blob);
  URL.revokeObjectURL(prepared.url);
  return { cover: await dataUrl(prepared.cover), thumb: await dataUrl(prepared.thumb), colors: prepared.colors };
}

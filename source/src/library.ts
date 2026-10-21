import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import { parseBlob } from "music-metadata";
import { genresFromTags } from "./genres";
import { t } from "./lang";
import type { Album, ColorProfile, DraftTrack } from "./types";

export const audioExt = new Set(["mp3", "flac", "m4a", "wav", "ogg", "opus"]);
const imageExt = new Set(["jpg", "jpeg", "png", "webp"]);
const extension = (name: string) => name.split(".").pop()?.toLowerCase() || "";
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
export const asset = (path: string) => !path ? "" : path.startsWith("data:") || path.startsWith("/") ? path : isTauri() ? convertFileSrc(path) : "";
export const cleanName = (path: string) => basename(path).replace(/\.[^.]+$/, "")
  .replace(/^(?:\s*(?:\d{1,3}[.\s-]+|[([]\d{1,3}[)\]]\s*))/, "")
  .replace(/_/g, " ").replace(/\s+/g, " ").trim();
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export async function chooseAudio(): Promise<string[]> {
  const result = await open({ multiple: true, title: t("Add album tracks"),
    filters: [{ name: t("Audio"), extensions: [...audioExt] }] });
  return result ? Array.isArray(result) ? result : [result] : [];
}
export async function chooseCover(): Promise<string | null> {
  const result = await open({ multiple: false, title: t("Choose album cover"),
    filters: [{ name: t("Images"), extensions: [...imageExt] }] });
  return typeof result === "string" ? result : null;
}
export async function chooseFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title: t("Add album folder") });
  return typeof result === "string" ? result : null;
}
export async function expandPaths(paths: string[]): Promise<{ audio: string[]; lyrics: string[]; cover?: string; skipped: number }> {
  const files: string[] = [];
  const visit = async (path: string, depth: number): Promise<void> => {
    await invoke("allow_import_path", { path });
    let entries;
    try { entries = await readDir(path); } catch { files.push(path); return; }
    if (depth > 1) return;
    for (const entry of entries) {
      const child = await join(path, entry.name);
      if (entry.isDirectory && depth < 1) await visit(child, depth + 1);
      else if (entry.isFile) files.push(child);
    }
  };
  for (const path of paths) await visit(path, 0);
  const audio: string[] = [], lyrics: string[] = [];
  let cover: string | undefined, skipped = 0;
  for (const path of files) {
    const ext = extension(path);
    if (audioExt.has(ext)) audio.push(path);
    else if (ext === "lrc") lyrics.push(path);
    else if (imageExt.has(ext) && /^(cover|folder|front|album)\./i.test(basename(path))) cover ??= path;
    else skipped++;
  }
  audio.sort(naturalCompare);
  return { audio, lyrics, cover, skipped };
}
export interface ParsedTrack { track: DraftTrack; album?: string; artist?: string; year?: number; picture?: Blob; genres?: string[] }
interface NativeInfo { duration: number; title?: string; artist?: string; album?: string; year?: number; trackNumber?: number }
/** Rust reads the tags and the length when the JS parser gives up on a file (a quirky tag, a short read…). */
async function parseNative(path: string, cause: unknown): Promise<ParsedTrack> {
  let info: NativeInfo;
  try { info = await invoke<NativeInfo>("probe_audio", { path }); }
  catch (error) { throw new Error(String(cause instanceof Error ? cause.message : cause) + " / " + String(error)); }
  return {
    track: { id: crypto.randomUUID(), title: info.title?.trim() || cleanName(path) || basename(path), duration: info.duration || 0,
      sourcePath: path, trackNumber: info.trackNumber || undefined },
    album: info.album || undefined, artist: info.artist || undefined, year: info.year || undefined
  };
}
export async function parseTrack(path: string): Promise<ParsedTrack> {
  await invoke("allow_import_path", { path });
  let metadata;
  try {
    const bytes = await readFile(path);
    metadata = await parseBlob(new Blob([new Uint8Array(bytes)]), { duration: true });
  } catch (cause) { return parseNative(path, cause); }
  const common = metadata.common;
  const name = cleanName(path) || basename(path);
  const title = common.title?.trim() || name;
  const picture = common.picture?.[0];
  // an MP3 without a length header can come out with none: ask Rust, which counts the samples
  const duration = metadata.format.duration
    || await invoke<NativeInfo>("probe_audio", { path }).then((info) => info.duration, () => 0);
  const lyrics = (common as typeof common & { lyrics?: Array<{ text?: string }> }).lyrics;
  return {
    track: { id: crypto.randomUUID(), title, duration,
      sourcePath: path, trackNumber: common.track.no || undefined,
      lyricsText: lyrics?.[0]?.text || undefined },
    album: common.album || undefined,
    artist: common.albumartist || common.artist || undefined,
    year: common.year || undefined,
    genres: genresFromTags(common.genre),
    picture: picture ? new Blob([new Uint8Array(picture.data)], { type: picture.format }) : undefined
  };
}
export async function readBlob(path: string): Promise<Blob> {
  await invoke("allow_import_path", { path });
  const bytes = await readFile(path);
  const mime: Record<string, string> = {
    mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4",
    wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp"
  };
  return new Blob([new Uint8Array(bytes)], { type: mime[extension(path)] || "application/octet-stream" });
}
export async function loadAlbums(): Promise<Album[]> { return invoke("load_albums"); }
export interface SaveAlbumRequest {
  id: string; title: string; artist: string; year?: number; colors: ColorProfile;
  tracks: DraftTrack[]; coverBytes?: number[]; thumbBytes?: number[]; existingCover?: string; genres?: string[];
}
export async function saveAlbum(request: SaveAlbumRequest): Promise<Album> { return invoke("save_album", { request }); }
export async function cancelImport(): Promise<void> { await invoke("cancel_import"); }
export async function deleteAlbum(id: string): Promise<Album[]> { return invoke("delete_album", { id }); }
export async function setAlbumGenres(id: string, genres: string[]): Promise<Album[]> { return invoke("set_album_genres", { id, genres }); }
export async function setAlbumLiked(id: string, liked: boolean): Promise<Album[]> { return invoke("set_album_liked", { id, liked }); }
export async function readLyrics(path: string): Promise<string> { return readTextFile(path); }
export async function previewSetting(value?: boolean): Promise<boolean> {
  if (!isTauri()) return value ?? true;
  const store = await load("settings.json", { autoSave: false });
  if (value === undefined) return (await store.get<boolean>("previewsEnabled")) ?? true;
  await store.set("previewsEnabled", value);
  await store.save();
  return value;
}


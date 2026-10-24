// no console window behind the app in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod decode;

use std::{collections::HashMap, fs, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, Mutex}};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    album_id: String,
    index: usize,
    title: String,
    duration: f64,
    file_path: String,
    lyrics_path: Option<String>,
    /// who made this track, when it is not the album's artist (a mix, a playlist pressed from many artists)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    artist: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Album {
    id: String,
    title: String,
    artist: String,
    year: Option<u16>,
    cover_path: String,
    cover_thumb_path: String,
    colors: serde_json::Value,
    tracks: Vec<Track>,
    added_at: u64,
    liked: bool,
    /// up to three genre tags (albums imported before genres existed have none)
    #[serde(default)]
    genres: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftTrack {
    id: String,
    title: String,
    duration: f64,
    source_path: String,
    lyrics_source: Option<String>,
    lyrics_text: Option<String>,
    #[serde(default)]
    artist: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    id: String,
    title: String,
    artist: String,
    year: Option<u16>,
    colors: serde_json::Value,
    tracks: Vec<DraftTrack>,
    cover_bytes: Option<Vec<u8>>,
    thumb_bytes: Option<Vec<u8>>,
    existing_cover: Option<String>,
    #[serde(default)]
    genres: Vec<String>,
}

fn collection_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("albums.json"))
}

fn read_collection(app: &tauri::AppHandle) -> Result<Vec<Album>, String> {
    let path = collection_path(app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let content = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&content).map_err(|e| e.to_string())
}

fn write_collection(app: &tauri::AppHandle, albums: &[Album]) -> Result<(), String> {
    let path = collection_path(app)?;
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(albums).map_err(|e| e.to_string())?;
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_albums(app: tauri::AppHandle) -> Result<Vec<Album>, String> { read_collection(&app) }

#[tauri::command]
fn allow_import_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?;
    if path.is_dir() {
        app.fs_scope().allow_directory(&path, true).map_err(|e| e.to_string())?;
    } else if path.is_file() {
        app.fs_scope().allow_file(&path).map_err(|e| e.to_string())?;
    } else { return Err("Path is not a file or folder".into()); }
    Ok(())
}

/// The whole file decoded here instead of in the webview: 12 bytes (sample rate, channels, frames — u32 LE)
/// and then interleaved 16-bit samples.
#[tauri::command]
async fn decode_audio(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pcm = decode::decode(&path)?;
        let frames = (pcm.samples.len() / pcm.channels as usize) as u32;
        let mut out = Vec::with_capacity(12 + pcm.samples.len() * 2);
        out.extend_from_slice(&pcm.rate.to_le_bytes());
        out.extend_from_slice(&(pcm.channels as u32).to_le_bytes());
        out.extend_from_slice(&frames.to_le_bytes());
        for sample in &pcm.samples { out.extend_from_slice(&sample.to_le_bytes()); }
        Ok(tauri::ipc::Response::new(out))
    }).await.map_err(|e| e.to_string())?
}

/// Length and tags of a file the page's own parser could not read.
#[tauri::command]
async fn probe_audio(path: String) -> Result<decode::Info, String> {
    tauri::async_runtime::spawn_blocking(move || decode::probe(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_import(cancel: State<'_, AtomicBool>) { cancel.store(true, Ordering::SeqCst); }

fn file_name(index: usize, title: &str, source: &Path) -> String {
    let safe: String = title.chars().map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '_' } else { c }).collect();
    let clean = safe.trim().trim_end_matches('.').trim();
    let extension = source.extension().and_then(|s| s.to_str()).unwrap_or("mp3").to_lowercase();
    format!("{:02} - {}.{}", index, if clean.is_empty() { "Track" } else { clean }, extension)
}

#[tauri::command]
fn save_album(app: tauri::AppHandle, cancel: State<'_, AtomicBool>, request: SaveRequest) -> Result<Album, String> {
    if request.id.is_empty() || request.title.trim().is_empty() || request.artist.trim().is_empty() || request.tracks.is_empty() {
        return Err("Album title, artist and tracks are required".into());
    }
    cancel.store(false, Ordering::SeqCst);
    let mut albums = read_collection(&app)?;
    let existing = albums.iter().position(|a| a.id == request.id);
    let added_at = existing.map(|i| albums[i].added_at).unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64);
    let liked = existing.map(|i| albums[i].liked).unwrap_or(false);
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("library");
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let version = format!("{}-{}", request.id, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());
    let staging = base.join(format!(".{version}"));
    let final_dir = base.join(&version);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = (|| -> Result<Album, String> {
        let mut tracks = Vec::with_capacity(request.tracks.len());
        for (position, draft) in request.tracks.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) { return Err("Import cancelled".into()); }
            let source = PathBuf::from(&draft.source_path);
            let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if !["mp3", "flac", "m4a", "wav", "ogg", "opus"].contains(&ext.as_str()) { return Err(format!("Unsupported audio format: {ext}")); }
            let name = file_name(position + 1, &draft.title, &source);
            let dest = staging.join(&name);
            fs::copy(&source, &dest).map_err(|e| format!("Could not copy {}: {e}", source.display()))?;
            let lyric_dest = staging.join(format!("{}.lrc", Path::new(&name).file_stem().unwrap_or_default().to_string_lossy()));
            let lyrics_path = if let Some(source) = &draft.lyrics_source {
                fs::copy(source, &lyric_dest).map_err(|e| e.to_string())?;
                Some(final_dir.join(lyric_dest.file_name().unwrap()).to_string_lossy().to_string())
            } else if let Some(text) = &draft.lyrics_text {
                fs::write(&lyric_dest, text).map_err(|e| e.to_string())?;
                Some(final_dir.join(lyric_dest.file_name().unwrap()).to_string_lossy().to_string())
            } else { None };
            tracks.push(Track { id: draft.id.clone(), album_id: request.id.clone(), index: position + 1, title: draft.title.trim().to_string(), duration: draft.duration, file_path: final_dir.join(name).to_string_lossy().to_string(), lyrics_path,
                artist: draft.artist.as_ref().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) });
            let _ = app.emit("import-progress", serde_json::json!({"done":position+1,"total":request.tracks.len()}));
        }
        let cover = staging.join("cover.jpg");
        let thumb = staging.join("cover-thumb.jpg");
        if let Some(bytes) = &request.cover_bytes { fs::write(&cover, bytes).map_err(|e| e.to_string())?; }
        else if let Some(path) = &request.existing_cover { fs::copy(path, &cover).map_err(|e| e.to_string())?; }
        if let Some(bytes) = &request.thumb_bytes { fs::write(&thumb, bytes).map_err(|e| e.to_string())?; }
        else if let Some(path) = &request.existing_cover { fs::copy(path, &thumb).map_err(|e| e.to_string())?; }
        fs::rename(&staging, &final_dir).map_err(|e| e.to_string())?;
        let album = Album { id: request.id.clone(), title: request.title.trim().into(), artist: request.artist.trim().into(), year: request.year, cover_path: if cover.exists() || final_dir.join("cover.jpg").exists() { final_dir.join("cover.jpg").to_string_lossy().to_string() } else { String::new() }, cover_thumb_path: if final_dir.join("cover-thumb.jpg").exists() { final_dir.join("cover-thumb.jpg").to_string_lossy().to_string() } else { String::new() }, colors: request.colors.clone(), tracks, added_at, liked, genres: clean_genres(&request.genres) };
        let old = existing.map(|i| albums.remove(i));
        albums.push(album.clone());
        if let Err(e) = write_collection(&app, &albums) {
            let _ = fs::remove_dir_all(&final_dir);
            return Err(e);
        }
        if let Some(old) = old {
            if let Some(parent) = managed_album_dir(&old, &base) {
                if parent != final_dir { let _ = fs::remove_dir_all(parent); }
            }
        }
        Ok(album)
    })();
    if result.is_err() { let _ = fs::remove_dir_all(&staging); }
    result
}

/* Audio files added straight to a playlist (not from an album in the library) live in their own folder,
   playlist-files/<playlist id>/<file id>.<ext>, copied there when the playlist is saved. */
const AUDIO_EXTENSIONS: [&str; 6] = ["mp3", "flac", "m4a", "wav", "ogg", "opus"];

/// ids come from the page: only plain ones may become a folder or file name
fn safe_id(id: &str) -> Result<&str, String> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { Ok(id) } else { Err("Invalid id".into()) }
}

fn playlist_files_dir(app: &tauri::AppHandle, playlist_id: &str) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("playlist-files").join(safe_id(playlist_id)?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistFileDraft { id: String, source_path: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPlaylistFile { id: String, file_path: String }

/// Copies the chosen files into the playlist's folder and returns where each one went.
#[tauri::command]
fn store_playlist_files(app: tauri::AppHandle, playlist_id: String, files: Vec<PlaylistFileDraft>) -> Result<Vec<StoredPlaylistFile>, String> {
    let dir = playlist_files_dir(&app, &playlist_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut stored = Vec::with_capacity(files.len());
    for file in &files {
        let source = PathBuf::from(&file.source_path);
        let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if !AUDIO_EXTENSIONS.contains(&ext.as_str()) { return Err(format!("Unsupported audio format: {ext}")); }
        let dest = dir.join(format!("{}.{}", safe_id(&file.id)?, ext));
        fs::copy(&source, &dest).map_err(|e| format!("Could not copy {}: {e}", source.display()))?;
        stored.push(StoredPlaylistFile { id: file.id.clone(), file_path: dest.to_string_lossy().to_string() });
    }
    Ok(stored)
}

/// Deletes the playlist's files that are no longer in it (all of them, and the folder, when `keep` is empty).
#[tauri::command]
fn prune_playlist_files(app: tauri::AppHandle, playlist_id: String, keep: Vec<String>) -> Result<(), String> {
    let dir = playlist_files_dir(&app, &playlist_id)?;
    if !dir.is_dir() { return Ok(()); }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if path.is_file() && !keep.iter().any(|id| id == stem) { let _ = fs::remove_file(&path); }
    }
    if keep.is_empty() { let _ = fs::remove_dir(&dir); }
    Ok(())
}

/// At most three tags, trimmed, without repeats.
fn clean_genres(genres: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for genre in genres {
        let genre = genre.trim();
        if genre.is_empty() || out.iter().any(|g| g.eq_ignore_ascii_case(genre)) { continue; }
        out.push(genre.chars().take(32).collect());
        if out.len() == 3 { break; }
    }
    out
}

#[tauri::command]
fn set_album_genres(app: tauri::AppHandle, id: String, genres: Vec<String>) -> Result<Vec<Album>, String> {
    let mut albums = read_collection(&app)?;
    let album = albums.iter_mut().find(|a| a.id == id).ok_or("Album not found")?;
    album.genres = clean_genres(&genres);
    write_collection(&app, &albums)?;
    Ok(albums)
}

fn managed_album_dir(album: &Album, base: &Path) -> Option<PathBuf> {
    let sample = if !album.cover_path.is_empty() {
        Some(album.cover_path.as_str())
    } else {
        album.tracks.first().map(|track| track.file_path.as_str())
    }?;
    let parent = Path::new(sample).parent()?;
    (parent.starts_with(base) && parent != base).then(|| parent.to_path_buf())
}
#[tauri::command]
fn delete_album(app: tauri::AppHandle, id: String) -> Result<Vec<Album>, String> {
    let mut albums = read_collection(&app)?;
    let position = albums.iter().position(|a| a.id == id).ok_or("Album not found")?;
    let album = albums.remove(position);
    write_collection(&app, &albums)?;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("library");
    if let Some(dir) = managed_album_dir(&album, &base) {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(albums)
}

#[tauri::command]
fn set_album_liked(app: tauri::AppHandle, id: String, liked: bool) -> Result<Vec<Album>, String> {
    let mut albums = read_collection(&app)?;
    let album = albums.iter_mut().find(|a| a.id == id).ok_or("Album not found")?;
    album.liked = liked;
    write_collection(&app, &albums)?;
    Ok(albums)
}

#[tauri::command]
fn set_track_lyrics(app: tauri::AppHandle, album_id: String, track_id: String, path: String) -> Result<Vec<Album>, String> {
    let mut albums = read_collection(&app)?;
    let album = albums.iter_mut().find(|a| a.id == album_id).ok_or("Album not found")?;
    let track = album.tracks.iter_mut().find(|t| t.id == track_id).ok_or("Track not found")?;
    let source = PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?;
    if source.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase() != "lrc" {
        return Err("Only .lrc files are supported".into());
    }
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("library");
    let audio_path = PathBuf::from(&track.file_path);
    let parent = audio_path.parent().ok_or("Invalid track path")?;
    if !parent.starts_with(&root) { return Err("Track is outside managed library".into()); }
    let target = audio_path.with_extension("lrc");
    fs::copy(source, &target).map_err(|e| e.to_string())?;
    track.lyrics_path = Some(target.to_string_lossy().to_string());
    write_collection(&app, &albums)?;
    Ok(albums)
}
/* The "Download" sheet: SoundCloud links are fetched with yt-dlp (open source, no account or keys). Turntable keeps
   its own copy of yt-dlp.exe in <app data>/bin: fetched from yt-dlp's GitHub releases the first time it is needed
   (and checked against the release's SHA2-256SUMS) and updated with `yt-dlp -U` when it gets old or an extraction
   fails (SoundCloud changes now and then). */
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const YTDLP_SUMS_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
static YTDLP_UPDATED: AtomicBool = AtomicBool::new(false);
/// Runs of yt-dlp share this lock; an update (`-U` replaces the exe) takes it alone, so no run starts or is cut off mid-update.
static YTDLP_RUNNING: std::sync::RwLock<()> = std::sync::RwLock::new(());
/// longest a lookup / a track may take before the process is killed (a stalled connection must not hang a job for ever)
const LOOKUP_LIMIT: u64 = 300;
const TRACK_LIMIT: u64 = 1800;

fn ytdlp_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("bin").join("yt-dlp.exe"))
}

fn ytdlp_present(path: &Path) -> bool { fs::metadata(path).map(|m| m.len() > 5_000_000).unwrap_or(false) }

fn is_soundcloud_link(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    ["https://soundcloud.com/", "https://www.soundcloud.com/", "https://m.soundcloud.com/", "https://on.soundcloud.com/"].iter().any(|prefix| lower.starts_with(prefix))
        || is_track_api_link(&lower)
}

/// SoundCloud lists the tracks of a long set after the fifth by number only: `https://api-v2.soundcloud.com/tracks/<id>`
/// (with a `?secret_token=…` for a private set). yt-dlp resolves those like any track link.
fn is_track_api_link(lower: &str) -> bool {
    let Some(rest) = ["https://api-v2.soundcloud.com/tracks/", "https://api.soundcloud.com/tracks/"].iter().find_map(|prefix| lower.strip_prefix(prefix)) else { return false };
    let digits = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
    digits > 0 && (rest.len() == digits || rest[digits..].starts_with('?') || rest[digits..].starts_with('/'))
}

/// The host of an https address, lower-cased; None for anything with a userinfo part or a port we do not expect.
fn https_host(url: &str) -> Option<String> {
    let rest = url.trim().strip_prefix("https://").or_else(|| url.trim().strip_prefix("HTTPS://"))?;
    let authority = rest.split(|c| c == '/' || c == '?' || c == '#').next()?;
    if authority.is_empty() || authority.contains('@') { return None; }
    Some(authority.split(':').next()?.to_ascii_lowercase())
}

fn soundcloud_host(url: &str) -> bool {
    https_host(url).map(|host| ["soundcloud.com", "sndcdn.com", "soundcloud.cloud"].iter().any(|h| host == *h || host.ends_with(&format!(".{h}")))).unwrap_or(false)
}

/// The lookup JSON the page hands back for `--load-info-json` must only point at SoundCloud's own hosts: yt-dlp would
/// fetch whatever the file names.
fn info_is_safe(text: &str) -> bool {
    if text.len() > 2_000_000 { return false; }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else { return false };
    let known = |key: &str| value.get(key).and_then(|v| v.as_str()).map(soundcloud_host).unwrap_or(true);
    if !known("webpage_url") || !known("url") || !known("manifest_url") { return false; }
    value.get("formats").and_then(|f| f.as_array()).map(|formats| formats.iter().all(|format| {
        ["url", "manifest_url"].iter().all(|key| format.get(*key).and_then(|v| v.as_str()).map(soundcloud_host).unwrap_or(true))
            && format.get("fragments").and_then(|f| f.as_array()).map(|list| list.iter().all(|f| f.get("url").and_then(|v| v.as_str()).map(soundcloud_host).unwrap_or(true))).unwrap_or(true)
    })).unwrap_or(true)
}

/// Starts yt-dlp, collects its output and waits at most `limit` seconds: a process that stalls is killed.
fn spawn_ytdlp(exe: &Path, args: &[String], limit: u64) -> Result<std::process::Output, String> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    let mut child = std::process::Command::new(exe).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW).spawn().map_err(|e| format!("Could not start the downloader: {e}"))?;
    let mut out = child.stdout.take().ok_or("Could not start the downloader")?;
    let mut err = child.stderr.take().ok_or("Could not start the downloader")?;
    // both pipes are drained on their own threads: a full pipe would block yt-dlp and look like a stall
    let read_out = std::thread::spawn(move || { let mut buffer = Vec::new(); let _ = out.read_to_end(&mut buffer); buffer });
    let read_err = std::thread::spawn(move || { let mut buffer = Vec::new(); let _ = err.read_to_end(&mut buffer); buffer });
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed().as_secs() >= limit => { let _ = child.kill(); let _ = child.wait(); return Err("The downloader took too long".into()); }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(e) => return Err(format!("Could not start the downloader: {e}")),
        }
    };
    Ok(std::process::Output { status, stdout: read_out.join().unwrap_or_default(), stderr: read_err.join().unwrap_or_default() })
}

fn run_ytdlp(exe: &Path, args: &[String], limit: u64) -> Result<std::process::Output, String> {
    let _shared = YTDLP_RUNNING.read().unwrap_or_else(|e| e.into_inner());
    spawn_ytdlp(exe, args, limit)
}

/// `yt-dlp -U`, with no other run going on (it replaces the exe).
fn update_ytdlp(exe: &Path) {
    let _alone = YTDLP_RUNNING.write().unwrap_or_else(|e| e.into_inner());
    let _ = spawn_ytdlp(exe, &["-U".to_string()], 180);
}

/// yt-dlp's last "ERROR:" line, without its "[extractor] id:" prefix.
fn ytdlp_error(output: &std::process::Output) -> String {
    let text = String::from_utf8_lossy(&output.stderr);
    let line = text.lines().rev().find(|l| l.contains("ERROR:")).unwrap_or("The downloader failed");
    let message = line.split("ERROR:").nth(1).unwrap_or(line).trim();
    let message = message.strip_prefix('[').and_then(|m| m.split_once("] ")).map(|(_, rest)| rest).unwrap_or(message);
    let message = message.split_once(": ").filter(|(head, _)| head.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-' || c == '_')).map(|(_, rest)| rest).unwrap_or(message);
    message.chars().take(200).collect()
}

/// SoundCloud answers 403/429 when it is asked for too much too fast; asking again at once only makes it worse.
fn rate_limited(text: &str) -> bool {
    text.contains("HTTP Error 403") || text.contains("HTTP Error 429") || text.contains("Too Many Requests")
}

/// A failure that is the track's own (removed, private, not for this country): a newer yt-dlp would not change it.
fn track_is_gone(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ["http error 404", "not available", "private", "removed", "has been deleted", "geo", "premium", "does not exist"].iter().any(|mark| lower.contains(mark))
}

/// Runs yt-dlp; if it fails, updates it once per session and tries again (updating takes every other run offline for
/// a while, so a track that is simply gone, one among many in a set, must not trigger it).
fn run_ytdlp_retry(exe: &Path, args: &[String], limit: u64) -> Result<std::process::Output, String> {
    let output = run_ytdlp(exe, args, limit)?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() || rate_limited(&stderr) || track_is_gone(&stderr) || YTDLP_UPDATED.swap(true, Ordering::SeqCst) { return Ok(output); }
    update_ytdlp(exe);
    run_ytdlp(exe, args, limit)
}

#[tauri::command]
fn ytdlp_ready(app: tauri::AppHandle) -> bool { ytdlp_path(&app).map(|p| ytdlp_present(&p)).unwrap_or(false) }

/// One download of yt-dlp at a time: the first lookup and a track added elsewhere must not both write the same file.
static YTDLP_FETCH: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());

/// SHA-256 of a file (Windows' own certutil, so no extra crate), lower-case hex.
fn sha256_of(path: &Path) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("certutil").args(["-hashfile", &path.to_string_lossy(), "SHA256"]).creation_flags(CREATE_NO_WINDOW).output().map_err(|e| e.to_string())?;
    String::from_utf8_lossy(&output.stdout).lines().map(|l| l.replace(' ', "").to_ascii_lowercase())
        .find(|l| l.len() == 64 && l.chars().all(|c| c.is_ascii_hexdigit())).ok_or_else(|| "Could not check the downloader file".to_string())
}

async fn ensure_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri_plugin_http::reqwest;
    let path = ytdlp_path(app)?;
    let _turn = YTDLP_FETCH.lock().await;
    if ytdlp_present(&path) {
        // a copy that is two weeks old is refreshed in the background, once per session
        let stale = fs::metadata(&path).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|age| age.as_secs() > 14 * 86_400).unwrap_or(false);
        if stale && !YTDLP_UPDATED.swap(true, Ordering::SeqCst) {
            let exe = path.clone();
            tauri::async_runtime::spawn_blocking(move || update_ytdlp(&exe));
        }
        return Ok(path);
    }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(300)).user_agent("Turntable").build().map_err(|e| e.to_string())?;
    let response = client.get(YTDLP_URL).send().await.map_err(|e| format!("Could not get the downloader: {e}"))?;
    if !response.status().is_success() { return Err(format!("Could not get the downloader (GitHub answered {})", response.status().as_u16())); }
    let bytes = response.bytes().await.map_err(|e| format!("Could not get the downloader: {e}"))?;
    if bytes.len() < 5_000_000 || &bytes[..2] != b"MZ" { return Err("The downloader file looks wrong".into()); }
    // the release lists the SHA-256 of every file: what came down must be exactly that
    let sums = client.get(YTDLP_SUMS_URL).send().await.map_err(|e| format!("Could not get the downloader: {e}"))?;
    if !sums.status().is_success() { return Err(format!("Could not get the downloader (GitHub answered {})", sums.status().as_u16())); }
    let sums = sums.text().await.map_err(|e| format!("Could not get the downloader: {e}"))?;
    let expected = sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let (hash, name) = (parts.next()?, parts.next()?);
        (name.trim_start_matches('*') == "yt-dlp.exe").then(|| hash.to_ascii_lowercase())
    }).ok_or_else(|| "Could not check the downloader file".to_string())?;
    let part = path.with_extension("exe.part");
    fs::write(&part, &bytes).map_err(|e| e.to_string())?;
    let actual = sha256_of(&part);
    if actual.as_deref() != Ok(expected.as_str()) { let _ = fs::remove_file(&part); return Err("The downloader failed its integrity check".into()); }
    fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// What is behind a SoundCloud link: a track, or a set with its entries (yt-dlp's JSON, as is).
#[tauri::command]
async fn ytdlp_info(app: tauri::AppHandle, url: String) -> Result<String, String> {
    if !is_soundcloud_link(&url) { return Err("That isn't a soundcloud.com link".into()); }
    let exe = ensure_ytdlp(&app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let args: Vec<String> = ["--no-warnings", "--socket-timeout", "30", "--flat-playlist", "-J", "--", url.trim()].iter().map(|s| s.to_string()).collect();
        let output = run_ytdlp_retry(&exe, &args, LOOKUP_LIMIT)?;
        if !output.status.success() { return Err(ytdlp_error(&output)); }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }).await.map_err(|e| e.to_string())?
}

/// Downloads one track into the cache folder; returns yt-dlp's JSON for it (`_filename` is the file).
/// `info` is the JSON `ytdlp_info` gave for this very track: with it yt-dlp skips looking the track up again.
#[tauri::command]
async fn ytdlp_fetch(app: tauri::AppHandle, url: String, info: Option<String>, batch: String) -> Result<String, String> {
    if !is_soundcloud_link(&url) { return Err("That isn't a soundcloud.com link".into()); }
    let exe = ensure_ytdlp(&app).await?;
    let dir = downloads_dir(&app, Some(&batch))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let template = dir.join(format!("{stamp}.%(ext)s")).to_string_lossy().to_string();
    let url = url.trim().to_string();
    // a lookup that points anywhere but SoundCloud is not used: the track is looked up again, the long way
    let info_file = match &info { Some(text) if info_is_safe(text) => { let path = dir.join(format!("{stamp}.info.json")); fs::write(&path, text).ok().map(|_| path) } _ => None };
    tauri::async_runtime::spawn_blocking(move || {
        let common = ["--no-warnings", "-q", "--no-progress", "--no-playlist", "--socket-timeout", "30", "--concurrent-fragments", "8", "-f", "hls_aac_160k/http_mp3_128/bestaudio[ext=m4a]/bestaudio", "-o", &template, "--print-json"];
        let by_url: Vec<String> = common.iter().map(|s| s.to_string()).chain(["--".to_string(), url.clone()]).collect();
        let finish = |output: std::process::Output| -> Result<String, String> {
            if !output.status.success() { return Err(ytdlp_error(&output)); }
            let text = String::from_utf8_lossy(&output.stdout).to_string();
            text.lines().rev().find(|l| l.starts_with('{')).map(|l| l.to_string()).ok_or_else(|| "The downloader returned nothing".to_string())
        };
        // the saved lookup may have gone stale (signed stream links expire): then it is done the long way
        if let Some(file) = &info_file {
            let quick: Vec<String> = common.iter().map(|s| s.to_string()).chain(["--load-info-json".to_string(), file.to_string_lossy().to_string()]).collect();
            let attempt = run_ytdlp(&exe, &quick, TRACK_LIMIT).and_then(finish);
            let _ = fs::remove_file(file);
            match attempt {
                Ok(text) => return Ok(text),
                // asked too much: the caller waits and tries again, not us right now
                Err(message) if rate_limited(&message) => return Err(message),
                Err(_) => {}
            }
        }
        finish(run_ytdlp_retry(&exe, &by_url, TRACK_LIMIT)?)
    }).await.map_err(|e| e.to_string())?
}

/// The cache folder of downloads, or one batch's own folder inside it (a batch is one job or one added track: they
/// run at the same time and must not delete each other's files). The batch id comes from the page: plain ids only.
fn downloads_dir(app: &tauri::AppHandle, batch: Option<&str>) -> Result<PathBuf, String> {
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("downloads");
    match batch {
        Some(id) if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => Ok(root.join(id)),
        Some(_) => Err("Bad download id".into()),
        None => Ok(root),
    }
}

/// Removes one batch's downloaded files, or (no batch: at launch, when nothing can be running) all of them.
#[tauri::command]
fn clear_downloads(app: tauri::AppHandle, batch: Option<String>) {
    if let Ok(dir) = downloads_dir(&app, batch.as_deref()) { let _ = fs::remove_dir_all(dir); }
}

/// Opens the author's Telegram or the Telegram channel (the welcome screen's and the corner buttons) in the default
/// app or browser. Only these two addresses are allowed.
#[tauri::command]
fn open_contact(url: String) -> Result<(), String> {
    if !["https://t.me/openwoundsdotcom", "https://t.me/turntabletg"].contains(&url.as_str()) { return Err("Not a known contact link".into()); }
    std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Cuts the window to a rounded rectangle (the mini cassette recorder's outline), or back to a plain
/// rectangle with `None`. A window region clips everything, the webview included — no corner can show.
#[tauri::command]
fn set_window_round(window: tauri::WebviewWindow, radius: Option<f64>) -> Result<(), String> { round_region(&window, radius) }

#[tauri::command]
fn quit_app(app: tauri::AppHandle) { app.exit(0); }

fn round_region(window: &tauri::WebviewWindow, radius: Option<f64>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as _;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        unsafe {
            match radius {
                Some(r) => {
                    let d = (r * 2.0 * scale).round() as i32;
                    let region = CreateRoundRectRgn(0, 0, size.width as i32 + 1, size.height as i32 + 1, d, d);
                    SetWindowRgn(hwnd, region, 1);
                }
                None => { SetWindowRgn(hwnd, std::ptr::null_mut(), 1); }
            }
        }
    }
    #[cfg(not(windows))]
    { let _ = (window, radius); }
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

const MENU_W: f64 = 320.0;
const MENU_H: f64 = 344.0;

/// The quick menu: a small borderless window (the same frontend, ?view=traymenu), created hidden and shown
/// next to the tray icon on a right click. It talks to the main window through events and hides on blur.
/// Transparent, no shadow and no window region: the card's CSS corners (anti-aliased) are its outline.
fn build_tray_menu(app: &tauri::App) -> tauri::Result<()> {
    tauri::WebviewWindowBuilder::new(app, "traymenu", tauri::WebviewUrl::App("index.html?view=traymenu".into()))
        .title("Turntable").inner_size(MENU_W, MENU_H).decorations(false).transparent(true).shadow(false)
        .always_on_top(true).skip_taskbar(true).resizable(false).visible(false).focused(false)
        .build()?;
    Ok(())
}

fn open_tray_menu(app: &tauri::AppHandle, at: tauri::PhysicalPosition<f64>) {
    let Some(window) = app.get_webview_window("traymenu") else { return };
    // the monitor under the pointer — not the menu's own (hidden) window's, which may be another screen
    let monitor = window.available_monitors().ok().and_then(|monitors| monitors.into_iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        at.x >= p.x as f64 && at.x < (p.x + s.width as i32) as f64 && at.y >= p.y as f64 && at.y < (p.y + s.height as i32) as f64
    })).or_else(|| window.primary_monitor().ok().flatten());
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let (w, h) = (MENU_W * scale, MENU_H * scale);
    // above and to the left of the pointer (the tray sits bottom-right), kept inside that monitor's work area
    let mut x = at.x - w + 24.0 * scale;
    let mut y = at.y - h - 14.0 * scale;
    if let Some(monitor) = &monitor {
        let area = monitor.work_area();
        let (mx, my) = (area.position.x as f64, area.position.y as f64);
        let (mw, mh) = (area.size.width as f64, area.size.height as f64);
        x = x.clamp(mx + 8.0, (mx + mw - w - 8.0).max(mx));
        y = y.clamp(my + 8.0, (my + mh - h - 8.0).max(my));
    }
    let _ = window.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
    // moving between screens with different scaling can resize the window: pin the size and place it again
    let _ = window.set_size(tauri::LogicalSize::new(MENU_W, MENU_H));
    let _ = window.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("traymenu-open", ());
}

/// Tray icon: left click brings the player back (it may be hidden to the tray from the mini player);
/// right click opens the quick menu.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let mut tray = TrayIconBuilder::with_id("turntable").tooltip("Turntable")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state: MouseButtonState::Up, position, .. } = event {
                match button {
                    MouseButton::Left => show_main(tray.app_handle()),
                    MouseButton::Right => open_tray_menu(tray.app_handle(), position),
                    _ => {}
                }
            }
        });
    // the tray has its own drawing: the record without the tile, with a light rim that reads on a dark or a light taskbar
    match tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")) {
        Ok(icon) => tray = tray.icon(icon),
        Err(_) => if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); },
    }
    tray.build(app)?;
    Ok(())
}

/// Global keys: shortcut id → the action it sends to the frontend as a "tray" event (like the quick menu's
/// buttons). They work with the window hidden. The settings screen rebinds them through `set_hotkeys`.
struct Hotkeys(Mutex<HashMap<u32, String>>);

/// Before the settings load: the media keys (play/pause — what most volume knobs send when pressed — next,
/// previous) and Right Alt + arrows (AltGr reaches Windows as Ctrl+Alt): ←/→ tracks, ↑/↓ volume.
const DEFAULT_HOTKEYS: [(&str, &str); 4] = [("next", "Control+Alt+ArrowRight"), ("prev", "Control+Alt+ArrowLeft"), ("vol-up", "Control+Alt+ArrowUp"), ("vol-down", "Control+Alt+ArrowDown")];
const MEDIA_KEYS: [(&str, &str); 3] = [("play-pause", "MediaPlayPause"), ("next", "MediaTrackNext"), ("prev", "MediaTrackPrevious")];

/// Replaces every global key. Returns the actions whose key could not be taken (malformed, used twice, or
/// held by another app) — the rest still work.
fn apply_hotkeys(app: &tauri::AppHandle, bindings: &[(String, String)], media: bool) -> Vec<String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let state = app.state::<Hotkeys>();
    let mut map = state.0.lock().unwrap_or_else(|e| e.into_inner());
    map.clear();
    let mut failed = Vec::new();
    let media_list = if media { MEDIA_KEYS.iter().map(|(a, k)| (a.to_string(), k.to_string())).collect() } else { Vec::new() };
    for (action, accelerator) in media_list.into_iter().chain(bindings.iter().cloned()) {
        if accelerator.trim().is_empty() { continue; }
        match accelerator.parse::<Shortcut>() {
            Ok(shortcut) if !map.contains_key(&shortcut.id()) => match shortcuts.register(shortcut) {
                Ok(()) => { map.insert(shortcut.id(), action); }
                Err(_) => failed.push(action),
            },
            _ => failed.push(action),
        }
    }
    failed
}

#[tauri::command]
fn set_hotkeys(app: tauri::AppHandle, bindings: Vec<(String, String)>, media: bool) -> Vec<String> { apply_hotkeys(&app, &bindings, media) }

/// Closing the window: quit (default), or hide to the tray and keep playing.
struct CloseToTray(AtomicBool);
#[tauri::command]
fn set_close_to_tray(state: State<'_, CloseToTray>, enabled: bool) { state.0.store(enabled, Ordering::SeqCst); }

/// Started by Windows at sign-in with "start in the tray": the window stays hidden until called up.
#[tauri::command]
fn launch_hidden() -> bool { std::env::args().any(|a| a == "--hidden") }

/// Start with Windows: a value under HKCU\…\Run (per user, no admin rights).
#[cfg(windows)]
mod autostart {
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ};
    const KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const NAME: &str = "Turntable";
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
    pub fn get() -> Option<String> {
        let (key, name) = (wide(KEY), wide(NAME));
        let mut buf = vec![0u16; 1024];
        let mut len = (buf.len() * 2) as u32;
        let status = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) };
        if status != 0 { return None; }
        Some(String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]))
    }
    pub fn set(command: Option<&str>) -> Result<(), String> {
        let (key, name) = (wide(KEY), wide(NAME));
        let status = match command {
            Some(command) => { let data = wide(command); unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, data.as_ptr().cast(), (data.len() * 2) as u32) } }
            None => { let status = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) }; if status == 2 { 0 } else { status } }
        };
        if status == 0 { Ok(()) } else { Err(format!("Windows refused the autostart entry (error {status})")) }
    }
}

/// The folder that holds the copied albums, in Explorer.
#[tauri::command]
fn open_library_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::process::Command::new("explorer").arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct AutostartState { enabled: bool, hidden: bool }

#[tauri::command]
fn get_autostart() -> AutostartState {
    #[cfg(windows)]
    if let Some(command) = autostart::get() { return AutostartState { enabled: true, hidden: command.contains("--hidden") }; }
    AutostartState { enabled: false, hidden: false }
}

#[tauri::command]
fn set_autostart(enabled: bool, hidden: bool) -> Result<AutostartState, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let command = format!("\"{}\"{}", exe.display(), if hidden { " --hidden" } else { "" });
        autostart::set(enabled.then_some(command.as_str()))?;
    }
    #[cfg(not(windows))]
    let _ = (enabled, hidden);
    Ok(get_autostart())
}

fn main() {
    tauri::Builder::default()
        // one Turntable at a time: launching it again brings the running one forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .manage(AtomicBool::new(false))
        .manage(Hotkeys(Mutex::new(HashMap::new())))
        .manage(CloseToTray(AtomicBool::new(false)))
        // closing the player quits the app (the hidden tray menu window must not keep it alive in the background),
        // unless the settings say to hide it to the tray
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.app_handle().state::<CloseToTray>().0.load(Ordering::SeqCst) { api.prevent_close(); let _ = window.hide(); }
                    else { window.app_handle().exit(0); }
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let action = app.state::<Hotkeys>().0.lock().ok().and_then(|map| map.get(&shortcut.id()).cloned());
                if let Some(action) = action { let _ = app.emit("tray", action); }
            }
        }).build())
        .setup(|app| {
            fs::create_dir_all(app.path().app_data_dir()?)?;
            build_tray(app)?;
            build_tray_menu(app)?;
            let defaults: Vec<(String, String)> = DEFAULT_HOTKEYS.iter().map(|(a, k)| (a.to_string(), k.to_string())).collect();
            apply_hotkeys(app.handle(), &defaults, true);
            // started into the tray: no window until it is called up
            if launch_hidden() { return Ok(()); }
            // the window starts hidden and the page shows it after its first frame; if that never comes, show it anyway
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2500));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) { let _ = window.show(); }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_albums, allow_import_path, decode_audio, probe_audio, save_album, cancel_import, delete_album, store_playlist_files, prune_playlist_files, set_album_liked, set_album_genres, set_track_lyrics, ytdlp_ready, ytdlp_info, ytdlp_fetch, clear_downloads, open_contact, set_window_round, quit_app, set_hotkeys, set_close_to_tray, launch_hidden, get_autostart, set_autostart, open_library_folder])
        .run(tauri::generate_context!())
        .expect("Turntable failed to start");
}

#[cfg(test)]
mod download_tests {
    use super::*;
    use std::os::windows::process::ExitStatusExt;

    #[test]
    fn only_soundcloud_links_pass() {
        assert!(is_soundcloud_link("https://soundcloud.com/a/b"));
        assert!(is_soundcloud_link("https://SoundCloud.com/Artist/Track"));
        assert!(is_soundcloud_link("HTTPS://on.soundcloud.com/abc"));
        assert!(!is_soundcloud_link("http://soundcloud.com/x"));
        assert!(!is_soundcloud_link("https://soundcloud.com.evil.com/x"));
        assert!(!is_soundcloud_link("https://evilsoundcloud.com/x"));
        assert!(!is_soundcloud_link("https://example.com/https://soundcloud.com/"));
    }

    #[test]
    fn a_vanished_track_does_not_call_for_an_update() {
        assert!(track_is_gone("ERROR: [soundcloud] 99: Unable to download JSON metadata: HTTP Error 404: Not Found"));
        assert!(track_is_gone("ERROR: [soundcloud] 99: This track is not available in your country"));
        assert!(!track_is_gone("ERROR: [soundcloud] 99: Unable to extract client id"));
        assert!(!track_is_gone("ERROR: Unsupported URL: https://soundcloud.com/x"));
    }

    #[test]
    fn tracks_of_a_set_listed_by_number_pass() {
        assert!(is_soundcloud_link("https://api-v2.soundcloud.com/tracks/2165025588"));
        assert!(is_soundcloud_link("https://api.soundcloud.com/tracks/2165025588?secret_token=s-abc"));
        assert!(!is_soundcloud_link("https://api-v2.soundcloud.com/tracks/"));
        assert!(!is_soundcloud_link("https://api-v2.soundcloud.com/tracks/12x"));
        assert!(!is_soundcloud_link("https://api-v2.soundcloud.com/resolve?url=x"));
        assert!(!is_soundcloud_link("https://api-v2.soundcloud.com.evil.com/tracks/1"));
    }

    #[test]
    fn hosts_are_read_strictly() {
        assert!(soundcloud_host("https://api-v2.soundcloud.com/resolve"));
        assert!(soundcloud_host("https://i1.sndcdn.com/a.jpg"));
        assert!(soundcloud_host("https://cf-hls-media.sndcdn.com/playlist/x.m3u8?Policy=1"));
        assert!(!soundcloud_host("https://soundcloud.com@evil.com/x"));
        assert!(!soundcloud_host("https://evil.com/soundcloud.com"));
        assert!(!soundcloud_host("https://notsndcdn.com/x"));
        assert!(!soundcloud_host("https://sndcdn.com.evil.io/x"));
        assert!(!soundcloud_host("http://i1.sndcdn.com/x"));
    }

    #[test]
    fn a_lookup_may_only_point_at_soundcloud() {
        let good = r#"{"webpage_url":"https://soundcloud.com/a/b","formats":[{"url":"https://cf-hls-media.sndcdn.com/x.m3u8","manifest_url":"https://api-v2.soundcloud.com/m"}]}"#;
        assert!(info_is_safe(good));
        let bad_format = r#"{"webpage_url":"https://soundcloud.com/a/b","formats":[{"url":"https://evil.example/x"}]}"#;
        assert!(!info_is_safe(bad_format));
        assert!(!info_is_safe(r#"{"webpage_url":"https://evil.example/x"}"#));
        assert!(!info_is_safe(r#"{"formats":[{"fragments":[{"url":"http://169.254.169.254/"}]}]}"#));
        assert!(!info_is_safe("not json"));
        assert!(info_is_safe(r#"{"title":"no urls at all"}"#));
    }

    #[test]
    fn refusals_are_told_from_other_errors() {
        let output = |stderr: &str| std::process::Output { status: std::process::ExitStatus::from_raw(1), stdout: vec![], stderr: stderr.as_bytes().to_vec() };
        let refused = ytdlp_error(&output("WARNING: x\nERROR: [soundcloud] 12: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)\n"));
        assert!(rate_limited(&refused), "{refused}");
        assert!(rate_limited("HTTP Error 429: Too Many Requests"));
        let gone = ytdlp_error(&output("ERROR: [soundcloud] 99: This track is not available\n"));
        assert!(!rate_limited(&gone), "{gone}");
        assert_eq!(gone, "This track is not available");
    }

    #[test]
    fn a_stalled_process_is_killed() {
        let started = std::time::Instant::now();
        let result = spawn_ytdlp(Path::new("cmd"), &["/c".into(), "ping".into(), "-n".into(), "30".into(), "127.0.0.1".into()], 1);
        assert_eq!(result.err().as_deref(), Some("The downloader took too long"));
        assert!(started.elapsed().as_secs() < 6);
    }

    #[test]
    fn a_normal_process_returns_its_output() {
        let out = spawn_ytdlp(Path::new("cmd"), &["/c".into(), "echo".into(), "hello".into()], 20).unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("hello"));
    }
}
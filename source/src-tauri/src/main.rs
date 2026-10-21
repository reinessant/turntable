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
            tracks.push(Track { id: draft.id.clone(), album_id: request.id.clone(), index: position + 1, title: draft.title.trim().to_string(), duration: draft.duration, file_path: final_dir.join(name).to_string_lossy().to_string(), lyrics_path });
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
/// SoundCloud sign-in: open the authorize page in the user's browser and wait on the loopback
/// redirect (http://127.0.0.1:{port}/soundcloud/callback) for SoundCloud to hand back the code.
/// Returns the callback's query string; the frontend checks `state` and exchanges the code.
#[tauri::command]
async fn sc_login(authorize_url: String, port: u16) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};
    if !authorize_url.starts_with("https://secure.soundcloud.com/") { return Err("Unexpected sign-in address".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("Port {port} is busy: {e}"))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        // the authorize URL is ours and https-only (checked above); the shell opens it in the default browser
        std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &authorize_url]).spawn().map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                    let mut buffer = [0u8; 4096];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let target = request.lines().next().and_then(|line| line.split_whitespace().nth(1)).unwrap_or("").to_string();
                    if !target.starts_with("/soundcloud/callback") {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        continue;
                    }
                    let page = "<!doctype html><meta charset=utf-8><title>Turntable</title><body style=\"font:16px system-ui;background:#141318;color:#eee;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h2 style=\"margin:0 0 8px\">SoundCloud connected</h2><p style=\"opacity:.6;margin:0\">You can close this tab and go back to Turntable.</p></div>";
                    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", page.len(), page);
                    let _ = stream.write_all(response.as_bytes());
                    return Ok(target.split_once('?').map(|(_, query)| query.to_string()).unwrap_or_default());
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(120)),
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("Sign-in timed out".into())
    }).await.map_err(|e| e.to_string())?
}

/// Opens a soundcloud.com page in the default browser (attribution links on SoundCloud records).
#[tauri::command]
fn open_soundcloud(url: String) -> Result<(), String> {
    if !(url.starts_with("https://soundcloud.com/") || url.starts_with("https://on.soundcloud.com/")) { return Err("Not a SoundCloud link".into()); }
    std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Opens the author's Telegram or the Telegram channel (the welcome screen's and the corner buttons) in the default
/// app or browser. Only these two addresses are allowed, like `open_soundcloud` above.
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
        .invoke_handler(tauri::generate_handler![load_albums, allow_import_path, decode_audio, probe_audio, save_album, cancel_import, delete_album, store_playlist_files, prune_playlist_files, set_album_liked, set_album_genres, set_track_lyrics, sc_login, open_soundcloud, open_contact, set_window_round, quit_app, set_hotkeys, set_close_to_tray, launch_hidden, get_autostart, set_autostart, open_library_folder])
        .run(tauri::generate_context!())
        .expect("Turntable failed to start");
}




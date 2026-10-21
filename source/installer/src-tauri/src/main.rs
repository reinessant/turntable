// Turntable's own installer: a small window in the app's style (a record you can scratch, a quiet loop) that
// runs the real NSIS setup, embedded below, silently. The NSIS setup still does the actual work — files,
// Start menu and desktop shortcuts, the uninstaller, WebView2 — so installs stay standard.
// Without WebView2 this window can't draw, so the classic setup (which installs WebView2) runs instead.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

const PAYLOAD: &[u8] = include_bytes!("../payload/turntable-setup.exe");
const NO_WINDOW: u32 = 0x0800_0000;

fn quiet(program: &str) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(NO_WINDOW);
    command
}

/// WebView2 Evergreen runtime, per machine or per user (the same keys its own installer checks).
fn webview2_present() -> bool {
    const KEY: &str = r"\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    [r"HKLM\SOFTWARE\WOW6432Node", r"HKLM\SOFTWARE", r"HKCU\Software"].iter().any(|root| {
        quiet("reg").args(["query", &format!("{root}{KEY}"), "/v", "pv"]).output()
            .map(|out| out.status.success() && !String::from_utf8_lossy(&out.stdout).contains("0.0.0.0"))
            .unwrap_or(false)
    })
}

fn write_payload() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("turntable-setup-{}.exe", std::process::id()));
    std::fs::write(&path, PAYLOAD).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Where the per-user NSIS setup puts the app.
fn install_dir() -> PathBuf {
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("Turntable")
}

fn app_running() -> bool {
    quiet("tasklist").args(["/FI", "IMAGENAME eq turntable.exe", "/NH"]).output()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_lowercase().contains("turntable.exe"))
        .unwrap_or(false)
}

/// The version of the Turntable that is installed now: the NSIS setup writes it to the per-user uninstall entry.
fn installed_version() -> Option<String> {
    let out = quiet("reg").args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Turntable", "/v", "DisplayVersion"]).output().ok()?;
    if !out.status.success() { return None; }
    String::from_utf8_lossy(&out.stdout).lines()
        .find(|line| line.contains("DisplayVersion"))
        .and_then(|line| line.split_whitespace().last())
        .map(str::to_string)
}

/// `version`: what this setup installs; `installed_version`: what is on the machine now (None: unknown or no
/// entry). The window says "Update" for an older one, "Reinstall" for the same version.
#[derive(serde::Serialize)]
struct Status { installed: bool, running: bool, dir: String, version: String, installed_version: Option<String> }

#[tauri::command]
fn status() -> Status {
    let dir = install_dir();
    Status {
        installed: dir.join("turntable.exe").exists(), running: app_running(), dir: dir.to_string_lossy().into(),
        version: env!("CARGO_PKG_VERSION").into(), installed_version: installed_version(),
    }
}

#[tauri::command]
fn close_app() -> Result<(), String> {
    quiet("taskkill").args(["/IM", "turntable.exe", "/F"]).status().map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(400));
    Ok(())
}

/// Runs the embedded setup silently; returns the installed exe. `desktop: false` removes the desktop shortcut
/// the silent setup always makes.
#[tauri::command]
async fn install(app: tauri::AppHandle, desktop: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if app_running() { return Err("running".into()); }
        let setup = write_payload()?;
        let result = quiet(&setup.to_string_lossy()).arg("/S").status();
        let _ = std::fs::remove_file(&setup);
        let status = result.map_err(|e| e.to_string())?;
        if !status.success() { return Err(format!("setup exited with code {}", status.code().unwrap_or(-1))); }
        let exe = install_dir().join("turntable.exe");
        if !exe.exists() { return Err("turntable.exe is missing after setup".into()); }
        if !desktop {
            if let Ok(desk) = app.path().desktop_dir() { let _ = std::fs::remove_file(desk.join("Turntable.lnk")); }
        }
        Ok(exe.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn launch(app: tauri::AppHandle, path: String) -> Result<(), String> {
    Command::new(&path).current_dir(install_dir()).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// The plain NSIS wizard, for anyone who prefers it (and the fallback when this window can't run).
#[tauri::command]
fn classic(app: tauri::AppHandle) -> Result<(), String> {
    let setup = write_payload()?;
    Command::new(&setup).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn quit(app: tauri::AppHandle) { app.exit(0); }

fn main() {
    if !webview2_present() {
        if let Ok(setup) = write_payload() { let _ = Command::new(setup).spawn(); }
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![status, close_app, install, launch, classic, quit])
        .run(tauri::generate_context!())
        .expect("Turntable Setup failed to start");
}

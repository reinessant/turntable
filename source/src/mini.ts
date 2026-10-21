/* Mini mode: the same window shrinks into a portable cassette recorder (bottom-right, on top), and back.
   The audio engine never stops — only the screens change. The window is transparent with no shadow, so the
   recorder's CSS-rounded (anti-aliased) corners are its outline. A Win32 region would cut them jagged. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { setWindowFullscreen } from "./fullscreen";
import { useApp } from "./state";
import { settings, updateSettings } from "./settings";

export const MINI = { w: 340, h: 500, radius: 30 };
export const MINI_SCALE = { min: .75, max: 1.75, step: .05 };
export const clampMiniScale = (value: number) => !Number.isFinite(value) ? 1 : Math.min(MINI_SCALE.max, Math.max(MINI_SCALE.min, Math.round(value / MINI_SCALE.step) * MINI_SCALE.step));
/** the recorder draws itself at 340 × 500 and is zoomed to this (mini.css reads the variable) */
export function applyMiniScale(scale = settings().miniScale): void {
  const asked = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("miniscale")) : 0;      // dev: ?miniscale=1.4
  document.body.style.setProperty("--mini-scale", String(clampMiniScale(asked || scale || 1)));
}
/** The size the screen can actually hold: a 175% recorder (595 × 875) would not fit a 768-pixel laptop screen. */
async function fitScale(scale: number): Promise<number> {
  if (!isTauri()) return scale;
  const monitor = await currentMonitor();
  if (!monitor) return scale;
  const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
  const room = Math.min((area.size.height / monitor.scaleFactor - 24) / MINI.h, (area.size.width / monitor.scaleFactor - 24) / MINI.w);
  return Math.max(MINI_SCALE.min, Math.min(scale, Math.floor(room / MINI_SCALE.step) * MINI_SCALE.step));
}
/** Resizes the recorder: the setting, the drawing and — when it is on screen — the window, which keeps its bottom-right corner in place. */
export async function setMiniScale(value: number): Promise<void> {
  const wanted = clampMiniScale(value);
  if (wanted !== settings().miniScale) void updateSettings({ miniScale: wanted });
  const scale = await fitScale(wanted);
  applyMiniScale(scale);
  if (!useApp.getState().mini || !isTauri()) return;
  const window = getCurrentWindow();
  const [position, before] = [await window.outerPosition(), await window.outerSize()];
  await window.setMinSize(new LogicalSize(MINI.w * scale, MINI.h * scale));
  await window.setSize(new LogicalSize(MINI.w * scale, MINI.h * scale));
  const after = await window.outerSize();
  await window.setPosition(new PhysicalPosition(position.x + before.width - after.width, position.y + before.height - after.height));
}
const MARGIN = 28;

export async function enterMini(): Promise<void> {
  const state = useApp.getState();
  if (state.transitionBusy || state.mini) return;
  // whatever is playing stays playing; the full screens come back on the player (or the crate)
  useApp.setState({ mini: true, scSheet: false, screen: state.activeAlbumId ? "player" : state.screen === "import" || state.screen === "playlist" ? "crate" : state.screen });
  document.body.classList.add("mini-mode");
  applyMiniScale();
  if (!isTauri()) return;
  const window = getCurrentWindow();
  if (await window.isFullscreen()) await window.setFullscreen(false);
  await window.setResizable(false);
  const scale = await fitScale(clampMiniScale(settings().miniScale || 1));
  applyMiniScale(scale);
  await window.setMinSize(new LogicalSize(MINI.w * scale, MINI.h * scale));
  await window.setSize(new LogicalSize(MINI.w * scale, MINI.h * scale));
  await window.setAlwaysOnTop(true);
  // bottom-right of the work area (above the taskbar); the monitor reports physical pixels
  const monitor = await currentMonitor();
  if (monitor) {
    const scale = monitor.scaleFactor, area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
    const size = await window.outerSize();
    await window.setPosition(new PhysicalPosition(
      Math.round(area.position.x + area.size.width - size.width - MARGIN * scale),
      Math.round(area.position.y + area.size.height - size.height - MARGIN * scale)));
  }
}

export async function exitMini(): Promise<void> {
  if (!useApp.getState().mini) return;
  useApp.setState({ mini: false });
  document.body.classList.remove("mini-mode");
  if (!isTauri()) return;
  const window = getCurrentWindow();
  await invoke("set_window_round", { radius: null }).catch(() => {});
  await window.setAlwaysOnTop(false);
  await window.setResizable(true);
  await window.setMinSize(new LogicalSize(1280, 720));
  await window.show();
  await setWindowFullscreen(true);
  await window.setFocus();
}

export async function hideToTray(): Promise<void> {
  if (isTauri()) await getCurrentWindow().hide();
}

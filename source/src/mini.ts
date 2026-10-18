/* Mini mode: the same window shrinks into a portable cassette recorder (bottom-right, on top), and back.
   The audio engine never stops — only the screens change. The window is transparent with no shadow, so the
   recorder's CSS-rounded (anti-aliased) corners are its outline. A Win32 region would cut them jagged. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "./state";

export const MINI = { w: 340, h: 500, radius: 30 };
const MARGIN = 28;

export async function enterMini(): Promise<void> {
  const state = useApp.getState();
  if (state.transitionBusy || state.mini) return;
  // whatever is playing stays playing; the full screens come back on the player (or the crate)
  useApp.setState({ mini: true, scSheet: false, screen: state.activeAlbumId ? "player" : state.screen === "import" ? "crate" : state.screen });
  document.body.classList.add("mini-mode");
  if (!isTauri()) return;
  const window = getCurrentWindow();
  if (await window.isFullscreen()) await window.setFullscreen(false);
  await window.setResizable(false);
  await window.setMinSize(new LogicalSize(MINI.w, MINI.h));
  await window.setSize(new LogicalSize(MINI.w, MINI.h));
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
  await window.setFullscreen(true);
  await window.show(); await window.setFocus();
}

export async function hideToTray(): Promise<void> {
  if (isTauri()) await getCurrentWindow().hide();
}

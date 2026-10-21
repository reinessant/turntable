import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fullscreen as the user sees it: the window covers its monitor. The window's own "fullscreen" flag can stay on after the
    window was pulled away by its top edge or snapped, and then a plain setFullscreen(true) does nothing. */
export async function coversMonitor(): Promise<boolean> {
  const window = getCurrentWindow(), monitor = await currentMonitor();
  if (!monitor) return window.isFullscreen();
  const [size, position] = await Promise.all([window.outerSize(), window.outerPosition()]);
  return size.width >= monitor.size.width - 2 && size.height >= monitor.size.height - 2
    && Math.abs(position.x - monitor.position.x) <= 2 && Math.abs(position.y - monitor.position.y) <= 2;
}

/** Fullscreen on or off, whatever state the window was left in (dragged, maximized, snapped). */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  const window = getCurrentWindow();
  if (on) {
    if (await window.isMaximized()) await window.unmaximize();
    await window.setFullscreen(true);
    await pause(80);
    // the flag was already on but the window is elsewhere: turn it off and on again
    if (!(await coversMonitor())) { await window.setFullscreen(false); await pause(80); await window.setFullscreen(true); }
  } else {
    await window.setFullscreen(false);
    if (await window.isMaximized()) await window.unmaximize();
  }
}

export async function toggleWindowFullscreen(): Promise<boolean> {
  const next = !(await coversMonitor());
  await setWindowFullscreen(next);
  return next;
}

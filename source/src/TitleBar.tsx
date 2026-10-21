import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enterMini } from "./mini";
import { t } from "./lang";

function WindowIcon({ name }: { name: "minimize" | "maximize" | "restore" | "close" | "mini" }) {
  const paths = {
    // a little cassette: the mini player
    mini: <><rect x="1" y="2" width="8" height="6" rx="1" /><circle cx="3.5" cy="5" r=".9" /><circle cx="6.5" cy="5" r=".9" /></>,
    minimize: <path d="M1 5h8" />,
    maximize: <rect x="1.5" y="1.5" width="7" height="7" />,
    restore: <><path d="M3 1.5h5.5v5.5" /><path d="M1.5 3h5.5v5.5H1.5z" /></>,
    close: <path d="M1.5 1.5l7 7m0-7l-7 7" />
  };
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">{paths[name]}</svg>;
}

/** The app starts fullscreen (tauri.conf.json). The middle button and F11 switch fullscreen ↔ window. */
export function TitleBar() {
  const [fullscreen, setFullscreen] = useState(true);
  useEffect(() => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    let alive = true;
    const refresh = () => { void window.isFullscreen().then((value) => { if (alive) setFullscreen(value); }); };
    const toggle = async () => { await window.setFullscreen(!(await window.isFullscreen())); refresh(); };
    const key = (event: KeyboardEvent) => { if (event.key === "F11") { event.preventDefault(); void toggle(); } };
    refresh();
    const unlisten = window.onResized(refresh);
    addEventListener("keydown", key);
    return () => { alive = false; removeEventListener("keydown", key); void unlisten.then((stop) => stop()); };
  }, []);
  if (!isTauri() && !(import.meta.env.DEV && new URLSearchParams(location.search).has("titlebar"))) return null;
  const appWindow = isTauri() ? getCurrentWindow() : null;
  const toggleFullscreen = async () => {
    if (!appWindow) return;
    const next = !(await appWindow.isFullscreen());
    await appWindow.setFullscreen(next);
    setFullscreen(next);
  };
  return <div className="titlebar" data-tauri-drag-region onDoubleClick={(event) => { if (event.target === event.currentTarget) void toggleFullscreen(); }}>
    <div className="titlebar-controls">
      <button aria-label={t("Mini player")} title={t("Mini player (Ctrl+M)")} onClick={(event) => { event.stopPropagation(); void enterMini(); }}><WindowIcon name="mini" /></button>
      <button aria-label={t("Minimize window")} onClick={(event) => { event.stopPropagation(); void appWindow?.minimize(); }}><WindowIcon name="minimize" /></button>
      <button aria-label={fullscreen ? t("Exit full screen") : t("Full screen")} onClick={(event) => { event.stopPropagation(); void toggleFullscreen(); }}><WindowIcon name={fullscreen ? "restore" : "maximize"} /></button>
      <button className="titlebar-close" aria-label={t("Close window")} onClick={(event) => { event.stopPropagation(); void appWindow?.close(); }}><WindowIcon name="close" /></button>
    </div>
  </div>;
}

import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { TrayMenu } from "./TrayMenu";
import { installTooltips } from "./tooltip";
import "./styles.css";

/* The screens are laid out on a 1920×1080 artboard and fitted to the window with CSS `zoom`
   (not a scale transform, which resampled everything — text, covers, labels — and looked soft).
   --ox/--oy centre the artboard; they are in artboard px because `left`/`top` are zoomed too. */
function fit(): void {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  const root = document.documentElement.style;
  root.setProperty("--fit", String(scale));
  root.setProperty("--ox", ((innerWidth - 1920 * scale) / 2 / scale).toFixed(2) + "px");
  root.setProperty("--oy", ((innerHeight - 1080 * scale) / 2 / scale).toFixed(2) + "px");
}

installTooltips();     // hover tips in our own look, in every window

// the same bundle also draws the tray's quick menu, in its own small window
if (new URLSearchParams(location.search).get("view") === "traymenu") {
  document.getElementById("splash")?.remove();
  document.documentElement.classList.remove("launching");
  document.documentElement.classList.add("traymenu-view");
  createRoot(document.getElementById("root")!).render(<ErrorBoundary><TrayMenu /></ErrorBoundary>);
} else {
  fit();
  addEventListener("resize", fit);
  createRoot(document.getElementById("root")!).render(<ErrorBoundary><App /></ErrorBoundary>);
  // the window is created hidden (no blank flash); show it once the splash and the first frame are painted
  // (started with Windows into the tray: it stays hidden until called up)
  if (isTauri()) requestAnimationFrame(() => requestAnimationFrame(() => {
    void invoke<boolean>("launch_hidden").catch(() => false).then((hidden) => { if (!hidden) void getCurrentWindow().show().then(() => getCurrentWindow().setFocus()); });
  }));
}

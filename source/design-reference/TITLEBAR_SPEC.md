# Custom Title Bar

Replace the native Windows title bar with our own, so the blurred-cover
backdrop runs all the way to the top edge of the window.

## Tauri config
- `tauri.conf.json` → `app.windows[0]`: `"decorations": false`, `"shadow": true`,
  `"resizable": true`, `minWidth 1600`, `minHeight 900`.
- capabilities: `core:window:allow-start-dragging`, `core:window:allow-minimize`,
  `core:window:allow-toggle-maximize`, `core:window:allow-close`,
  `core:window:allow-is-maximized`.

## The bar
- Height **36 px in window pixels** (not scaled with the artboard), full width,
  fixed at the top, above the artboard, **transparent** — the backdrop shows
  through. No title text, no logo, no divider line.
- The whole bar is a drag region (`data-tauri-drag-region`). Double-click
  toggles maximise.
- Right side: three controls, each a **46 × 36** hit area with a **10 px**
  icon drawn as inline SVG with 1 px strokes (not font glyphs):
  minimise (a horizontal line), maximise (a square) / restore (two offset
  squares when maximised — listen to resize and query `isMaximized()`),
  close (×).
- Colours: icons at ink 64%; hover background ink 6% with the icon at 100%;
  **close** hover background `#C42B1C` with a white icon. 120 ms transitions.
  No glow, no scale.
- The buttons are NOT drag regions.
- In a light room the icons use the light-room ink automatically.

## Layout
- The app header (Crate / Edit album pills, sort, import) stays at artboard
  y 44. The drag region covers only the 36 px bar; check that no pill is
  covered or unclickable at 1600×900 and 1920×1080.
- Alt+F4 closes; Win+↑/↓ maximise/restore; dragging to screen edges snaps.

## Known trade-off
With a custom bar, Windows 11's snap-layout flyout on hovering maximise is not
available. Snapping by dragging and Win+arrows still work. Accept this.

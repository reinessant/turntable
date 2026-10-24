/* Settings: how the turntable looks, the room's dust, the global keys and how the app starts and closes.
   The store file (settings.json, next to the library) is the truth; a copy in localStorage lets the first
   frame (the launch intro, the deck's colour) use them before the store has answered. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { useApp } from "./state";
import type { RepeatMode, ShuffleMode } from "./types";
import { CROSSFADE_MODES } from "./crossfadeMath";
import type { CrossfadeMode } from "./crossfadeMath";

export type Finish = "graphite" | "piano" | "alu" | "ivory" | "walnut" | "oxblood" | "navy" | "sage" | "rose";
export type Vinyl = "black" | "smoke" | "oxblood" | "cobalt" | "emerald" | "amber" | "bone";
export type HotkeyAction = "play-pause" | "next" | "prev" | "vol-up" | "vol-down" | "mini-toggle" | "window-toggle";

export const FINISHES: { id: Finish; name: string }[] = [
  { id: "graphite", name: "Graphite" }, { id: "piano", name: "Piano black" }, { id: "alu", name: "Aluminium" },
  { id: "ivory", name: "Ivory" }, { id: "walnut", name: "Walnut" }, { id: "oxblood", name: "Oxblood" },
  { id: "navy", name: "Navy" }, { id: "sage", name: "Sage" }, { id: "rose", name: "Rose" }
];
/** base colour of the pressing, and whether it is light (its grooves are then drawn dark) */
export const VINYLS: { id: Vinyl; name: string; base: string; edge: string; light?: boolean }[] = [
  { id: "black", name: "Black", base: "#131316", edge: "#0f0f11" },
  { id: "smoke", name: "Smoke", base: "#3a3a42", edge: "#26262c" },
  { id: "oxblood", name: "Oxblood", base: "#6e1520", edge: "#4b0d15" },
  { id: "cobalt", name: "Cobalt", base: "#1d3c8c", edge: "#132a66" },
  { id: "emerald", name: "Emerald", base: "#14583c", edge: "#0c3d29" },
  { id: "amber", name: "Amber", base: "#b4741c", edge: "#8a5512" },
  { id: "bone", name: "Bone", base: "#e4dfd4", edge: "#cfc8ba", light: true }
];
export const HOTKEY_ACTIONS: { id: HotkeyAction; name: string }[] = [
  { id: "play-pause", name: "Play / pause" }, { id: "next", name: "Next track" }, { id: "prev", name: "Previous track" },
  { id: "vol-up", name: "Volume up" }, { id: "vol-down", name: "Volume down" },
  { id: "mini-toggle", name: "Mini player on / off" }, { id: "window-toggle", name: "Show / hide Turntable" }
];

export type Shell = "black" | "silver" | "white" | "red" | "navy" | "olive" | "pink";
export type Lcd = "amber" | "green" | "ice" | "red" | "violet" | "white";
export type Tape = "smoke" | "clear" | "white" | "red" | "blue" | "yellow";
export type TrayTheme = "dark" | "light" | "album";
export type TrayAccent = "ink" | "amber" | "green" | "blue" | "pink" | "album";
/** swatch colours for the settings screen (the real materials live in mini.css / traymenu.css) */
export const SHELLS: { id: Shell; name: string; swatch: string }[] = [
  { id: "black", name: "Black", swatch: "#1d1d20" }, { id: "silver", name: "Silver", swatch: "#c9c9c6" }, { id: "white", name: "White", swatch: "#eeebe5" },
  { id: "red", name: "Red", swatch: "#a42128" }, { id: "navy", name: "Navy", swatch: "#24324f" }, { id: "olive", name: "Olive", swatch: "#555c40" }, { id: "pink", name: "Pink", swatch: "#e9abb8" }
];
export const LCDS: { id: Lcd; name: string; swatch: string }[] = [
  { id: "amber", name: "Amber", swatch: "#ffcf8f" }, { id: "green", name: "Green", swatch: "#8dffa0" }, { id: "ice", name: "Ice", swatch: "#9fd8ff" },
  { id: "red", name: "Red", swatch: "#ff8a7a" }, { id: "violet", name: "Violet", swatch: "#d0a8ff" }, { id: "white", name: "White", swatch: "#f2f2ee" }
];
export const TAPES: { id: Tape; name: string; swatch: string }[] = [
  { id: "smoke", name: "Smoke", swatch: "#333236" }, { id: "clear", name: "Transparent", swatch: "rgba(200,212,226,.55)" }, { id: "white", name: "White", swatch: "#e6e3dc" },
  { id: "red", name: "Red", swatch: "#b52a31" }, { id: "blue", name: "Blue", swatch: "#2f5cb4" }, { id: "yellow", name: "Yellow", swatch: "#e5b938" }
];
export const TRAY_THEMES: { id: TrayTheme; name: string }[] = [{ id: "dark", name: "Dark" }, { id: "light", name: "Light" }, { id: "album", name: "Album colour" }];
export const TRAY_ACCENTS: { id: TrayAccent; name: string; swatch: string }[] = [
  { id: "ink", name: "Plain", swatch: "#f3f1ec" }, { id: "amber", name: "Amber", swatch: "#ffb85c" }, { id: "green", name: "Green", swatch: "#5fe08a" },
  { id: "blue", name: "Blue", swatch: "#6aa8ff" }, { id: "pink", name: "Pink", swatch: "#ff7eb6" }, { id: "album", name: "Album colour", swatch: "conic-gradient(#ff7eb6, #ffb85c, #5fe08a, #6aa8ff, #ff7eb6)" }
];

export interface Settings {
  finish: Finish;
  vinyl: Vinyl;
  /** the mini player's size, 1 = 340 × 500 (0.75 – 1.75) */
  miniScale: number;
  miniShell: Shell;
  miniLcd: Lcd;
  miniTape: Tape;
  trayTheme: TrayTheme;
  trayAccent: TrayAccent;
  particles: boolean;
  /** 0..1: how much dust is in the air */
  particleAmount: number;
  /** the dust glints with the beat */
  particlesReact: boolean;
  intro: boolean;
  /** while music plays and nothing is touched, the interface (all but the record player) becomes translucent */
  idleFade: boolean;
  previews: boolean;
  /** the vinyl surface hiss under the music (it follows the volume) */
  surfaceNoise: boolean;
  /** decode every file with Turntable's own decoder instead of the webview's (the fix when a file sounds wrong) */
  nativeDecoder: boolean;
  /** seconds the end of a track overlaps the start of the next one (0 = off, the needle simply moves on) */
  crossfade: number;
  /** false: the tracks of a record play gapless (the way the artist made them); only playlists and shuffle cross-fade */
  crossfadeAlbums: boolean;
  /** how the tracks hand over: all at once (classic), the bass changes hands in one moment, or band by band (highs first, bass last) */
  crossfadeMode: CrossfadeMode;
  /** a spiral of light threads through the deck while a crossfade runs */
  crossfadeAnimation: boolean;
  /** shuffle and repeat are remembered between launches */
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  mediaKeys: boolean;
  hotkeys: Record<HotkeyAction, string>;
  closeToTray: boolean;
  autostart: boolean;
  startHidden: boolean;
  /** the welcome screen has been seen (it opens by itself only the first time) */
  welcomed: boolean;
}
export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  "play-pause": "", next: "Control+Alt+ArrowRight", prev: "Control+Alt+ArrowLeft",
  "vol-up": "Control+Alt+ArrowUp", "vol-down": "Control+Alt+ArrowDown", "mini-toggle": "", "window-toggle": ""
};
export const CROSSFADE = { min: 0, max: 12, step: 1 };
export const DEFAULTS: Settings = {
  finish: "graphite", vinyl: "black", miniScale: 1, miniShell: "black", miniLcd: "amber", miniTape: "smoke", trayTheme: "dark", trayAccent: "ink", particles: true, particleAmount: .5, particlesReact: true, intro: true, idleFade: true, previews: true,
  surfaceNoise: true, nativeDecoder: false, crossfade: 0, crossfadeAlbums: true, crossfadeMode: "spectrum", crossfadeAnimation: true, shuffle: "off", repeat: "off",
  mediaKeys: true, hotkeys: DEFAULT_HOTKEYS, closeToTray: false, autostart: false, startHidden: false, welcomed: false
};

const QUICK = "turntable.settings";
/** The settings as last saved on this machine, without the store: the tray menu's window reads them (it shares
    the main window's origin, so the `storage` event tells it when they change). */
export function quickSettings(): Settings { return quick(); }
function quick(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(QUICK) || "null");
    if (saved) return clean({ ...DEFAULTS, ...saved, hotkeys: { ...DEFAULT_HOTKEYS, ...saved.hotkeys } });
  } catch { /* no storage: defaults */ }
  return DEFAULTS;
}

/** a value that came from a file must still make sense */
function clean(value: Settings): Settings {
  const fade = Number(value.crossfade);
  return { ...value, crossfade: Number.isFinite(fade) ? Math.min(CROSSFADE.max, Math.max(CROSSFADE.min, Math.round(fade))) : 0,
    crossfadeMode: CROSSFADE_MODES.includes(value.crossfadeMode) ? value.crossfadeMode : "spectrum" };
}

interface SettingsState extends Settings {
  /** actions whose key Windows would not give us (taken by another app, or the same key twice) */
  hotkeyErrors: HotkeyAction[];
  loaded: boolean;
}
export const useSettings = create<SettingsState>(() => ({ ...quick(), hotkeyErrors: [], loaded: false }));
export const settings = (): Settings => useSettings.getState();

let storeFile: Awaited<ReturnType<typeof load>> | null = null;
const store = async () => storeFile ??= await load("settings.json", { autoSave: false });

/** Reads the store, then puts everything into effect. Called once at launch by the main window. */
export async function loadSettings(): Promise<void> {
  let next = settings();
  if (isTauri()) {
    try {
      const s = await store();
      const saved = (await s.get<Partial<Settings>>("settings")) ?? {};
      next = clean({ ...DEFAULTS, ...saved, hotkeys: { ...DEFAULT_HOTKEYS, ...saved.hotkeys } });
      // the crate-preview switch predates this screen and kept its own key
      const previews = await s.get<boolean>("previewsEnabled");
      if (previews !== undefined && saved.previews === undefined) next.previews = previews;
      // the registry is the truth for autostart (it can be removed from Task Manager)
      const auto = await invoke<{ enabled: boolean; hidden: boolean }>("get_autostart");
      next.autostart = auto.enabled; if (auto.enabled) next.startHidden = auto.hidden;
    } catch (error) { useApp.setState({ message: "Settings: " + String(error) }); }
  }
  useSettings.setState({ ...next, loaded: true });
  remember(next);
  applyLook(next);
  useApp.setState({ previewsEnabled: next.previews, shuffle: next.shuffle, repeat: next.repeat });
  if (isTauri()) {
    await invoke("set_close_to_tray", { enabled: next.closeToTray }).catch(() => {});
    await applyHotkeys();
  }
}

function remember(value: Settings): void {
  try { localStorage.setItem(QUICK, JSON.stringify(value)); } catch { /* private window: fine */ }
}
function pick(state: SettingsState): Settings {
  const { hotkeyErrors: _e, loaded: _l, ...rest } = state;
  return rest;
}

/** Changes some settings, saves them, and applies what they touch. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  useSettings.setState(patch);
  const value = pick(useSettings.getState());
  remember(value);
  if ("finish" in patch || "vinyl" in patch) applyLook(value);
  if ("previews" in patch) useApp.setState({ previewsEnabled: value.previews });
  if (!isTauri()) return;
  try {
    if ("closeToTray" in patch) await invoke("set_close_to_tray", { enabled: value.closeToTray });
    if ("autostart" in patch || "startHidden" in patch) {
      const auto = await invoke<{ enabled: boolean; hidden: boolean }>("set_autostart", { enabled: value.autostart, hidden: value.startHidden });
      useSettings.setState({ autostart: auto.enabled });
    }
    if ("hotkeys" in patch || "mediaKeys" in patch) await applyHotkeys();
    const s = await store();
    await s.set("settings", pick(useSettings.getState()));
    await s.set("previewsEnabled", value.previews);
    await s.save();
  } catch (error) { useApp.setState({ message: "Settings: " + String(error) }); }
}

/** Hands the global keys to Windows (through Rust); the ones that could not be taken are flagged. */
export async function applyHotkeys(): Promise<void> {
  if (!isTauri()) return;
  const s = settings();
  const bindings = Object.entries(s.hotkeys).filter(([, key]) => key);
  const failed = await invoke<string[]>("set_hotkeys", { bindings, media: s.mediaKeys }).catch(() => []);
  // a media key that is busy is not worth a red mark: only the keys set here are
  useSettings.setState({ hotkeyErrors: failed.filter((action) => s.hotkeys[action as HotkeyAction]) as HotkeyAction[] });
}
/** While a key is being recorded, the global keys are let go — otherwise pressing the old one would act on it. */
export async function suspendHotkeys(): Promise<void> {
  if (isTauri()) await invoke("set_hotkeys", { bindings: [], media: false }).catch(() => {});
}

/** The vinyl colour reaches the CSS records (crate peek, carousel) through variables on <html>. */
export function applyLook(value: Settings): void {
  const vinyl = VINYLS.find((v) => v.id === value.vinyl) ?? VINYLS[0];
  const root = document.documentElement.style;
  root.setProperty("--vinyl", vinyl.base);
  root.setProperty("--vinyl-edge", vinyl.edge);
  root.setProperty("--vinyl-groove", vinyl.light ? "rgba(0,0,0,.07)" : "rgba(255,255,255,.035)");
}
export const vinylOf = (id: Vinyl) => VINYLS.find((v) => v.id === id) ?? VINYLS[0];

/* ---------------------------------------------------------------- key names */
const KEY_NAMES: Record<string, string> = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Space", Enter: "Enter", Backspace: "Backspace",
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", PageUp: "PgUp", PageDown: "PgDn", Insert: "Ins", Delete: "Del",
  MediaPlayPause: "Play/Pause", MediaTrackNext: "Next", MediaTrackPrevious: "Prev", MediaStop: "Stop"
};
const MOD_NAMES: Record<string, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win" };
/** "Control+Alt+ArrowRight" → ["Ctrl", "Alt", "→"] */
export function keyLabel(accelerator: string): string[] {
  return accelerator.split("+").filter(Boolean).map((part) => MOD_NAMES[part] ?? KEY_NAMES[part]
    ?? part.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num "));
}
const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;
/** A key press → an accelerator Rust can parse, or null while only modifiers are down. Plain letters need a
    modifier (a global "A" would steal the letter from every other app); F-keys and media keys do not. */
export function acceleratorOf(event: KeyboardEvent): string | null {
  if (MODIFIER_CODES.test(event.code) || !event.code) return null;
  const mods = [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean) as string[];
  const bare = /^(F\d{1,2}|Media\w+|Pause|ScrollLock|Insert)$/.test(event.code);
  if (!mods.length && !bare) return null;
  return [...mods, event.code].join("+");
}

import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { coverSrc, Icon } from "./PlayerScreen";
import { useApp } from "./state";
import { MiniPlayer } from "./MiniPlayer";
import { TrayMenu } from "./TrayMenu";
import {
  DEFAULT_HOTKEYS, FINISHES, HOTKEY_ACTIONS, LCDS, SHELLS, TAPES, TRAY_ACCENTS, TRAY_THEMES, VINYLS, acceleratorOf, applyHotkeys, keyLabel, suspendHotkeys, updateSettings, useSettings, vinylOf
} from "./settings";
import type { HotkeyAction, Settings } from "./settings";

/** A row of colour chips for one setting. */
function Chips<K extends keyof Settings>({ setting, options, label }: { setting: K; label: string; options: { id: Settings[K] & string; name: string; swatch: string }[] }) {
  const value = useSettings((s) => s[setting]);
  return <>
    <div className="st-label">{label} <em>{options.find((o) => o.id === value)?.name}</em></div>
    <div className="st-grid">{options.map((o) => <button key={o.id} title={o.name} aria-label={label + ": " + o.name} className={"st-chip" + (value === o.id ? " on" : "")}
      style={{ "--c": o.swatch } as React.CSSProperties} onClick={() => void updateSettings({ [setting]: o.id } as Partial<Settings>)}><i /></button>)}</div>
  </>;
}

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={"st-toggle" + (on ? " on" : "")} onClick={() => onChange(!on)}><i /></button>;
}
function Row({ title, hint, children, disabled }: { title: string; hint?: string; children: React.ReactNode; disabled?: boolean }) {
  return <div className={"st-row" + (disabled ? " off" : "")}><div className="st-text"><b>{title}</b>{hint && <span>{hint}</span>}</div><div className="st-control">{children}</div></div>;
}
function Keys({ accelerator }: { accelerator: string }) {
  return <span className="st-keys">{keyLabel(accelerator).map((part, i) => <kbd key={i}>{part}</kbd>)}</span>;
}

/** A live turntable in the chosen finish and vinyl, turning slowly. */
function DeckPreview() {
  const host = useRef<HTMLDivElement>(null);
  const finish = useSettings((s) => s.finish), vinyl = useSettings((s) => s.vinyl);
  const album = useApp((s) => s.albums.find((a) => a.id === s.activeAlbumId) ?? s.albums[s.focused]);
  const cover = album ? coverSrc(album) : "/design/cover.jpg";
  useEffect(() => {
    if (!host.current || !window.buildDeck) return;
    window.buildDeck(host.current, { widthPx: 440, cover, finish, vinyl: vinylOf(vinyl), trackFractions: [.2, .41, .6, .78], layout: "landscape", playing: false, stylusRadiusMm: 120 });
    host.current.querySelector(".led")?.classList.add("on");
    let angle = 0, raf = 0, last = performance.now();
    const spin = host.current.querySelector<HTMLElement>(".spin"), platter = host.current.querySelector<HTMLElement>(".platter");
    const frame = (now: number) => {
      angle += (now - last) / 1000 * 200; last = now;      // 33⅓ rpm = 200°/s
      if (spin) spin.style.transform = `rotate(${angle}deg)`;
      if (platter) platter.style.transform = `rotate(${angle}deg)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); if (host.current) host.current.innerHTML = ""; };
  }, [finish, vinyl, cover]);
  return <div className="st-preview"><div ref={host} /></div>;
}

/** One global key: click, press the new combination (Esc cancels, Backspace clears). */
function HotkeyRow({ action, name }: { action: HotkeyAction; name: string }) {
  const value = useSettings((s) => s.hotkeys[action]);
  const failed = useSettings((s) => s.hotkeyErrors.includes(action));
  const [recording, setRecording] = useState(false);
  const [nudge, setNudge] = useState("");
  useEffect(() => {
    if (!recording) return;
    void suspendHotkeys();
    const key = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Escape") { setRecording(false); return; }
      if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setRecording(false); void save("");
        return;
      }
      const accelerator = acceleratorOf(event);
      if (!accelerator) { if (!/^(Control|Alt|Shift|Meta)/.test(event.key)) setNudge("Add Ctrl, Alt or Shift — a bare key would be taken from every app"); return; }
      setRecording(false); void save(accelerator);
    };
    const away = () => setRecording(false);
    addEventListener("keydown", key, true); addEventListener("blur", away);
    return () => { removeEventListener("keydown", key, true); removeEventListener("blur", away); setNudge(""); void applyHotkeys(); };
  }, [recording]);
  async function save(accelerator: string) {
    const hotkeys = { ...useSettings.getState().hotkeys };
    // one key, one action: taking it from another row clears that row
    if (accelerator) for (const other of Object.keys(hotkeys) as HotkeyAction[]) if (other !== action && hotkeys[other] === accelerator) hotkeys[other] = "";
    hotkeys[action] = accelerator;
    await updateSettings({ hotkeys });
  }
  return <div className={"st-row st-hotkey" + (failed ? " failed" : "")}>
    <div className="st-text"><b>{name}</b>{failed ? <span className="st-warn">Another app holds this key — pick a different one</span> : recording && nudge ? <span>{nudge}</span> : null}</div>
    <div className="st-control">
      <button className={"st-key" + (recording ? " recording" : "") + (value ? "" : " empty")} onClick={() => setRecording(!recording)}>
        {recording ? <span className="st-listen">Press keys…</span> : value ? <Keys accelerator={value} /> : <span>Not set</span>}
      </button>
      {/* always takes its place, so the key buttons line up whether a row has a key or not */}
      <button className="st-clear" aria-label={"Clear " + name} style={value && !recording ? undefined : { visibility: "hidden" }} onClick={() => void save("")}><Icon name="x" size={12} /></button>
    </div>
  </div>;
}

const SECTIONS = [{ id: "look", name: "Appearance" }, { id: "mini", name: "Mini player" }, { id: "tray", name: "Tray menu" }, { id: "play", name: "Playback" }, { id: "keys", name: "Keys" }, { id: "system", name: "System" }, { id: "about", name: "About" }];

export function SettingsScreen() {
  const s = useSettings();
  const [libraryDir, setLibraryDir] = useState("");
  const [section, setSection] = useState("look");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (isTauri()) void appDataDir().then(setLibraryDir).catch(() => {}); }, []);
  // the nav follows the scroll
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const watch = () => {
      const top = box.getBoundingClientRect().top;
      let current = SECTIONS[0].id;
      for (const { id } of SECTIONS) { const el = box.querySelector<HTMLElement>("#st-" + id); if (el && el.getBoundingClientRect().top - top < 160) current = id; }
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id;
      setSection(current);
    };
    box.addEventListener("scroll", watch, { passive: true });
    return () => box.removeEventListener("scroll", watch);
  }, []);
  const go = (id: string) => {
    const box = scroller.current, el = box?.querySelector<HTMLElement>("#st-" + id);
    if (box && el) box.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
  };
  return <div className="screen settings-screen">
    <header className="header"><div className="brand"><span className="h">Settings</span><span className="mono">Turntable 0.1.0</span></div><div className="hright" /></header>
    <nav className="st-nav">{SECTIONS.map((x) => <button key={x.id} className={section === x.id ? "on" : ""} onClick={() => go(x.id)}>{x.name}</button>)}</nav>
    <div className="st-scroll" ref={scroller}>
      <section id="st-look" className="st-card">
        <h3>Appearance</h3>
        <div className="st-look">
          <DeckPreview />
          <div className="st-swatches">
            <div className="st-label">Turntable <em>{FINISHES.find((f) => f.id === s.finish)?.name}</em></div>
            <div className="st-grid">{FINISHES.map((f) => <button key={f.id} title={f.name} aria-label={"Turntable: " + f.name} className={"st-finish deck finish-" + f.id + (s.finish === f.id ? " on" : "")} onClick={() => void updateSettings({ finish: f.id })}><span className="plinth" /></button>)}</div>
            <div className="st-label">Record <em>{vinylOf(s.vinyl).name}</em></div>
            <div className="st-grid">{VINYLS.map((v) => <button key={v.id} title={v.name} aria-label={"Record: " + v.name} className={"st-vinyl" + (s.vinyl === v.id ? " on" : "") + (v.light ? " light" : "")} style={{ "--v": v.base, "--e": v.edge } as React.CSSProperties} onClick={() => void updateSettings({ vinyl: v.id })}><i /></button>)}</div>
          </div>
        </div>
        <Row title="Dust in the air" hint="Specks of dust drift through the light behind the player">
          <Toggle label="Dust in the air" on={s.particles} onChange={(particles) => void updateSettings({ particles })} />
        </Row>
        <Row title="Amount" disabled={!s.particles}>
          <input className="st-range" type="range" min={0} max={1} step={.01} value={s.particleAmount} disabled={!s.particles} style={{ "--p": s.particleAmount } as React.CSSProperties}
            onChange={(event) => useSettings.setState({ particleAmount: Number(event.target.value) })}
            onPointerUp={(event) => void updateSettings({ particleAmount: Number((event.target as HTMLInputElement).value) })}
            onKeyUp={(event) => void updateSettings({ particleAmount: Number((event.target as HTMLInputElement).value) })} />
        </Row>
        <Row title="Glints with the beat" hint="The dust catches the light on every kick" disabled={!s.particles}>
          <Toggle label="Glints with the beat" on={s.particlesReact} disabled={!s.particles} onChange={(particlesReact) => void updateSettings({ particlesReact })} />
        </Row>
        <Row title="Launch animation" hint="The record and the wave of light when Turntable opens">
          <Toggle label="Launch animation" on={s.intro} onChange={(intro) => void updateSettings({ intro })} />
        </Row>
      </section>

      <section id="st-mini" className="st-card">
        <h3>Mini player</h3>
        <div className="st-look">
          <div className="st-mini-preview"><MiniPlayer preview /></div>
          <div className="st-swatches">
            <Chips setting="miniShell" label="Body" options={SHELLS} />
            <Chips setting="miniLcd" label="Display" options={LCDS} />
            <Chips setting="miniTape" label="Cassette" options={TAPES} />
            <p className="st-note">The preview is the real recorder — its keys play and pause, ⏏ loads a tape.</p>
          </div>
        </div>
      </section>

      <section id="st-tray" className="st-card">
        <h3>Tray menu</h3>
        <div className="st-look">
          <div className="st-tray-preview"><TrayMenu preview /></div>
          <div className="st-swatches">
            <div className="st-label">Theme <em>{TRAY_THEMES.find((t) => t.id === s.trayTheme)?.name}</em></div>
            <div className="st-seg">{TRAY_THEMES.map((t) => <button key={t.id} className={s.trayTheme === t.id ? "on" : ""} onClick={() => void updateSettings({ trayTheme: t.id })}>{t.name}</button>)}</div>
            <Chips setting="trayAccent" label="Accent" options={TRAY_ACCENTS} />
            <p className="st-note">“Album colour” follows the record that is playing. The menu opens with a right click on the record by the clock.</p>
          </div>
        </div>
      </section>

      <section id="st-play" className="st-card">
        <h3>Playback</h3>
        <Row title="Previews in the crate" hint="A few seconds of the album play while you flip to it">
          <Toggle label="Previews in the crate" on={s.previews} onChange={(previews) => void updateSettings({ previews })} />
        </Row>
      </section>

      <section id="st-keys" className="st-card">
        <h3>Keys</h3>
        <p className="st-note">These work everywhere — with Turntable in the tray or another app in front. Right Alt counts as Ctrl + Alt.</p>
        <Row title="Media keys" hint="Play/pause, next and previous on the keyboard — and pressing a volume knob">
          <Toggle label="Media keys" on={s.mediaKeys} onChange={(mediaKeys) => void updateSettings({ mediaKeys })} />
        </Row>
        {HOTKEY_ACTIONS.map((a) => <HotkeyRow key={a.id} action={a.id} name={a.name} />)}
        <div className="st-actions"><button className="pill-btn" onClick={() => void updateSettings({ hotkeys: DEFAULT_HOTKEYS, mediaKeys: true })}><Icon name="x" size={14} />Reset keys</button></div>
        <div className="st-sub">In the app</div>
        <div className="st-cheats">
          {[["Space", "Play / pause"], ["← →", "Previous / next track"], ["Ctrl K", "Search"], ["Ctrl M", "Mini player"], ["Ctrl I", "Import an album"], ["F11", "Full screen"], ["Esc", "Back to the crate"]].map(([k, what]) =>
            <div key={k}><span className="st-keys">{k.split(" ").map((p) => <kbd key={p}>{p}</kbd>)}</span><span>{what}</span></div>)}
        </div>
      </section>

      <section id="st-system" className="st-card">
        <h3>System</h3>
        <Row title="Start with Windows" hint="Turntable opens when you sign in">
          <Toggle label="Start with Windows" on={s.autostart} onChange={(autostart) => void updateSettings({ autostart })} />
        </Row>
        <Row title="Start in the tray" hint="No window at sign-in — the record waits by the clock" disabled={!s.autostart}>
          <Toggle label="Start in the tray" on={s.startHidden} disabled={!s.autostart} onChange={(startHidden) => void updateSettings({ startHidden })} />
        </Row>
        <Row title="Closing keeps the music playing" hint="The close button hides Turntable to the tray instead of quitting. Quit from the tray menu">
          <Toggle label="Closing keeps the music playing" on={s.closeToTray} onChange={(closeToTray) => void updateSettings({ closeToTray })} />
        </Row>
      </section>

      <section id="st-about" className="st-card">
        <h3>About</h3>
        <Row title="Library" hint={libraryDir || "Albums are copied into Turntable's own folder: the music stays even if the original files are moved or deleted"}>
          {isTauri() && <button className="pill-btn" onClick={() => void invoke("open_library_folder").catch((e) => useApp.setState({ message: String(e) }))}>Open folder</button>}
        </Row>
        <Row title="Lyrics" hint="From LRCLIB — kept on this computer once found, so they work offline" ><span className="st-mono">lrclib.net</span></Row>
        <Row title="Quick guide" hint="How to add music and get around">
          <button className="pill-btn" onClick={() => useApp.setState({ guide: true })}>Open</button>
        </Row>
        <Row title="Welcome screen" hint="A short tour, and where to report bugs">
          <button className="pill-btn" onClick={() => useApp.setState({ welcome: true })}>Show</button>
        </Row>
        <Row title="Version" hint="Updates are announced on TikTok"><span className="st-mono">0.1.0</span></Row>
      </section>
    </div>
  </div>;
}

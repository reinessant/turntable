import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useApp } from "./state";
import { updateSettings } from "./settings";
import { useLang } from "./lang";
import "./welcome.css";

function ArrowOut({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" style={{ display: "block" }}>
    <path d="M4 2.5h5.5V8M9.3 2.7 2.5 9.5" />
  </svg>;
}

/* The welcome screen: opens by itself on the first launch, and any time from Settings → About.
   Two languages, switched at the top; it starts in the system's. */

export const TELEGRAM = { handle: "@openwoundsdotcom", url: "https://t.me/openwoundsdotcom" };
export const DISCORD = { handle: "reinessant" };
export const CHANNEL = { handle: "@turntabletg", url: "https://t.me/turntabletg" };

const TEXT = {
  en: {
    eyebrow: "Welcome to",
    lead: "A tactile player for your own music. Albums sit in a crate, the record spins on a turntable, lyrics scroll in time — and when you need it out of the way, the whole thing folds into a pocket cassette recorder.",
    features: [
      ["Crate & turntable", "Flip through your albums, drop the needle, drag the tonearm to wind to any moment."],
      ["Synced lyrics", "Found automatically on LRCLIB and kept on your computer, so they work offline."],
      ["Plugin rack", "Seven studio-style units: equalizers, compressor, valve, bit-crusher, filter and tape echo."],
      ["Mini player & tray", "Ctrl+M folds the app into a cassette recorder. Global keys and a tray menu keep it within reach."]
    ],
    feedbackTitle: "Found a bug or have an idea?",
    feedback: "Turntable is young and made by one person. If something breaks, looks off or you are missing a feature — write to me here. Every message gets read.",
    telegram: "Telegram", discord: "Discord", channel: "Telegram channel",
    open: "Open", copy: "Copy", copied: "Copied",
    start: "Get started", guide: "Quick guide",
    again: "You can open this screen and the guide again in Settings → About."
  },
  ru: {
    eyebrow: "Добро пожаловать в",
    lead: "Тактильный плеер для вашей собственной музыки. Альбомы лежат в крейте, пластинка крутится на проигрывателе, тексты идут синхронно со звуком — а когда нужно не мешать, всё складывается в карманный кассетник.",
    features: [
      ["Крейт и проигрыватель", "Листайте альбомы, опускайте иглу, перематывайте перетаскиванием тонарма."],
      ["Синхронные тексты", "Находятся сами на LRCLIB и сохраняются на компьютере — работают и без интернета."],
      ["Рэк плагинов", "Семь студийных приборов: эквалайзеры, компрессор, лампа, краш, фильтр и ленточное эхо."],
      ["Мини-плеер и трей", "Ctrl+M складывает приложение в кассетник. Глобальные клавиши и меню в трее всегда под рукой."]
    ],
    feedbackTitle: "Нашли баг или есть идея?",
    feedback: "Turntable ещё молодой, и делает его один человек. Если что-то ломается, выглядит криво или не хватает фичи — пишите сюда. Читаю всё.",
    telegram: "Telegram", discord: "Discord", channel: "Telegram-канал",
    open: "Открыть", copy: "Копировать", copied: "Скопировано",
    start: "Поехали", guide: "Мини-гайд",
    again: "Это окно и гайд можно открыть снова: Настройки → О программе."
  }
} as const;

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // no clipboard permission: the old way, through a hidden field
    const field = Object.assign(document.createElement("textarea"), { value: text });
    field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(field); field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  }
}

export function openTelegram(url: string = TELEGRAM.url): void {
  if (isTauri()) void invoke("open_contact", { url }).catch((error) => useApp.setState({ message: String(error) }));
  else window.open(url, "_blank", "noopener");
}

export const Plane = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2 1.8 6.8l4.4 1.7M14 2l-3.2 11-4.6-4.5M14 2 6.2 8.5m0 0V13l2.2-2.3" /></svg>;
export const Megaphone = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 6.2v3.6h2.2L10 12.8V3.2L4.7 6.2zM12.4 6a2.8 2.8 0 0 1 0 4M4.8 9.8l.8 3.2" /></svg>;
export const Bubble = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 3h11v7.5H8L5 13.2v-2.7H2.5z" /><circle cx="6" cy="6.8" r=".5" fill="currentColor" /><circle cx="10" cy="6.8" r=".5" fill="currentColor" /></svg>;

function Contact({ icon, name, handle, copy, copied, onCopy, open, onOpen }: {
  icon: React.ReactNode; name: string; handle: string; copy: string; copied: boolean; onCopy: () => void; open?: string; onOpen?: () => void;
}) {
  return <div className="wl-contact">
    <span className="wl-ico">{icon}</span>
    <span className="wl-who"><span>{name}</span><b>{handle}</b></span>
    {open && <button className="pill-btn solid" onClick={onOpen}>{open}<ArrowOut size={10} /></button>}
    <button className={"pill-btn" + (copied ? " done" : "")} onClick={onCopy}>{copy}</button>
  </div>;
}

export function Welcome() {
  const lang = useLang((s) => s.lang), setLang = useLang((s) => s.set);
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState<"" | "tg" | "ds" | "ch">("");
  const start = useRef<HTMLButtonElement>(null);
  const t = TEXT[lang];
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => {
    if (closing) return;
    setClosing(true);
    void updateSettings({ welcomed: true });
    window.setTimeout(() => useApp.setState({ welcome: false }), 220);
  };
  useEffect(() => {
    start.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !useApp.getState().guide) { event.preventDefault(); event.stopPropagation(); close(); } };
    addEventListener("keydown", key, true); return () => removeEventListener("keydown", key, true);
  }, [closing]);
  const copy = async (which: "tg" | "ds" | "ch", text: string) => {
    if (!(await copyText(text))) return;
    setCopied(which);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(""), 1600);
  };
  return <div className={"welcome" + (closing ? " closing" : "")} lang={lang}>
    <div className="wl-card" role="dialog" aria-modal="true" aria-label="Turntable">
      <div className="wl-lang" role="group" aria-label="Language">
        <button className={lang === "ru" ? "on" : ""} aria-pressed={lang === "ru"} onClick={() => setLang("ru")}>Русский</button>
        <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
      </div>

      <div className="wl-scroll">
      <header className="wl-head">
        <i className="wl-record" aria-hidden="true" />
        <span className="wl-eyebrow">{t.eyebrow}</span>
        <h1>Turntable</h1>
      </header>
      <p className="wl-lead">{t.lead}</p>

      <ul className="wl-features">
        {t.features.map(([title, text]) => <li key={title}><b>{title}</b><span>{text}</span></li>)}
      </ul>

      <section className="wl-feedback">
        <h2>{t.feedbackTitle}</h2>
        <p>{t.feedback}</p>
        <Contact icon={<Plane />} name={t.telegram} handle={TELEGRAM.handle} open={t.open} onOpen={() => openTelegram()}
          copy={copied === "tg" ? t.copied : t.copy} copied={copied === "tg"} onCopy={() => void copy("tg", TELEGRAM.handle)} />
        <Contact icon={<Bubble />} name={t.discord} handle={DISCORD.handle}
          copy={copied === "ds" ? t.copied : t.copy} copied={copied === "ds"} onCopy={() => void copy("ds", DISCORD.handle)} />
        <Contact icon={<Megaphone />} name={t.channel} handle={CHANNEL.handle} open={t.open} onOpen={() => openTelegram(CHANNEL.url)}
          copy={copied === "ch" ? t.copied : t.copy} copied={copied === "ch"} onCopy={() => void copy("ch", CHANNEL.handle)} />
      </section>
      </div>

      <footer className="wl-foot">
        <div className="wl-actions">
          <button className="pill-btn solid wl-start" ref={start} onClick={close}>{t.start}</button>
          <button className="pill-btn wl-start" onClick={() => useApp.setState({ guide: true })}>{t.guide}</button>
        </div>
        <span>{t.again}</span>
      </footer>
    </div>
  </div>;
}

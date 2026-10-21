import { useEffect, useRef, useState } from "react";
import { useApp } from "./state";
import { useLang } from "./lang";
import "./welcome.css";

/* The quick guide: how to put music in and how to use the player. Opens from the welcome screen and from
   Settings → About. `code` marks a key. */

const GUIDE = {
  en: {
    title: "Quick guide", sub: "From an empty crate to the first record in a minute.", done: "Got it",
    steps: [
      ["Add your music", "Open the crate and press `Import` (or `Ctrl I`), or drag a folder or files onto the crate window. mp3, flac, m4a, wav, ogg and opus work. Title, artist and cover come from the tags and from a cover.jpg in the folder — fix anything by hand, drag the handle to reorder, click a title to rename. Then Save album. Files are copied into Turntable's own folder, so moving the originals later changes nothing."],
      ["Pick a record", "Scroll or press `←` `→` to flip through the crate — a few seconds of a random track play as a preview. Click the sleeve or press `Enter`: the record slides out and flies onto the deck. Click the record (or press `Enter`) to drop the needle."],
      ["On the deck", "`Space` plays and pauses, `←` `→` change the track, `Esc` goes back to the crate. Drag the tonearm to wind to any moment, hold the platter to scratch, pick tracks from the list. Lyrics appear by themselves — click a line to jump to it."],
      ["Search", "`Ctrl K` or `/` finds albums, artists and tracks, even with the wrong keyboard layout or a typo. `Enter` plays, `Shift Enter` shows it in the crate."],
      ["Plugins", "The Plugins tab is a rack of seven studio units. Scroll to flip through them, click the patch cable to plug a unit in, drag knobs, double-click a knob to reset it."],
      ["Mini player", "`Ctrl M` folds the app into a pocket cassette recorder that stays on top. ⏏ loads another album, the keys work like a real deck, the mouse wheel is the volume. With Turntable hidden, the tray icon (right click) and the media keys keep control."],
      ["Make it yours", "Settings: the turntable and record colours, the mini player's body, display and cassette, dust in the air, global hotkeys, start with Windows."]
    ]
  },
  ru: {
    title: "Мини-гайд", sub: "От пустого крейта до первой пластинки за минуту.", done: "Понятно",
    steps: [
      ["Добавьте музыку", "Откройте крейт и нажмите `Импорт` (или `Ctrl I`), либо перетащите папку или файлы в окно крейта. Подходят mp3, flac, m4a, wav, ogg и opus. Название, исполнитель и обложка берутся из тегов и из cover.jpg в папке — всё можно поправить руками, порядок меняется перетаскиванием, название треков правится кликом. Потом «Сохранить альбом». Файлы копируются в собственную папку Turntable, так что оригиналы потом можно переносить."],
      ["Выберите пластинку", "Листайте колесом или `←` `→` — на фоне играет кусочек случайного трека. Клик по конверту или `Enter`: пластинка выезжает и летит на проигрыватель. Клик по пластинке (или `Enter`) опускает иглу."],
      ["На проигрывателе", "`Space` — пауза и пуск, `←` `→` — трек, `Esc` — назад в крейт. Тонарм тянется на любой момент трека, пластинку можно придержать и скретчить, треки выбираются из списка. Тексты появляются сами — клик по строке перематывает на неё."],
      ["Поиск", "`Ctrl K` или `/` ищет альбомы, исполнителей и треки — даже в неправильной раскладке и с опечатками. `Enter` — играть, `Shift Enter` — показать в крейте."],
      ["Плагины", "Вкладка «Плагины» — рэк из семи студийных приборов. Колесо листает их, клик по патч-корду включает прибор, ручки крутятся перетаскиванием, двойной клик по ручке сбрасывает её."],
      ["Мини-плеер", "`Ctrl M` складывает приложение в карманный кассетник поверх всех окон. ⏏ — загрузить другой альбом, клавиши как у настоящей деки, колесо мыши — громкость. Когда Turntable спрятан, музыкой управляют иконка в трее (правый клик) и медиа-клавиши."],
      ["Настройте под себя", "Настройки: язык, цвета проигрывателя и пластинки, корпус, дисплей и кассета мини-плеера, пыль в воздухе, глобальные клавиши, запуск вместе с Windows."]
    ]
  }
} as const;

/** "press `Ctrl K` now" → text with a key cap */
function Rich({ text }: { text: string }) {
  return <>{text.split(/`([^`]+)`/).map((part, i) => i % 2 ? <kbd key={i}>{part}</kbd> : part)}</>;
}

export function Guide() {
  const lang = useLang((s) => s.lang), setLang = useLang((s) => s.set);
  const [closing, setClosing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const g = GUIDE[lang];
  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => useApp.setState({ guide: false }), 220);
  };
  useEffect(() => {
    button.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); } };
    addEventListener("keydown", key, true); return () => removeEventListener("keydown", key, true);
  }, [closing]);
  return <div className={"welcome guide" + (closing ? " closing" : "")} lang={lang}>
    <div className="wl-card gd-card" role="dialog" aria-modal="true" aria-label={g.title}>
      <div className="wl-lang" role="group" aria-label="Language">
        <button className={lang === "ru" ? "on" : ""} aria-pressed={lang === "ru"} onClick={() => setLang("ru")}>Русский</button>
        <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
      </div>
      <div className="wl-scroll">
        <header className="wl-head gd-head">
          <h1>{g.title}</h1>
          <p>{g.sub}</p>
        </header>
        <ol className="gd-steps">
          {g.steps.map(([title, text], i) => <li key={title}>
            <span className="gd-n">{i + 1}</span>
            <div><b>{title}</b><p><Rich text={text} /></p></div>
          </li>)}
        </ol>
      </div>
      <footer className="wl-foot">
        <button className="pill-btn solid wl-start" ref={button} onClick={close}>{g.done}</button>
      </footer>
    </div>
  </div>;
}

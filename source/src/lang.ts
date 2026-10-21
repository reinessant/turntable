import { create } from "zustand";
import { RU } from "./ru";

/* The language of the app: English or Russian. "Auto" follows the system (Russian, Ukrainian, Belarusian and
   Kazakh systems get Russian). The choice is kept in localStorage (the tray menu's window shares it and follows
   changes through the `storage` event). Text is written in English in the code and looked up in the Russian
   table (ru.ts) by its English wording: `t("Crate")`. Whatever has no entry shows in English. */
export type Lang = "ru" | "en";
export type LangChoice = "auto" | Lang;
const KEY = "turntable.lang";
const system = (): Lang => /^(ru|uk|be|kk)/i.test(navigator.language || "") ? "ru" : "en";
const stored = (): LangChoice => {
  // dev: ?lang=ru|en for screenshots
  if (import.meta.env.DEV) { const asked = new URLSearchParams(location.search).get("lang"); if (asked === "ru" || asked === "en") return asked; }
  try { const value = localStorage.getItem(KEY); return value === "ru" || value === "en" ? value : "auto"; } catch { return "auto"; } };
const effective = (choice: LangChoice): Lang => choice === "auto" ? system() : choice;

interface LangState { choice: LangChoice; lang: Lang; setChoice: (choice: LangChoice) => void; set: (lang: Lang) => void }
export const useLang = create<LangState>((set) => ({
  choice: stored(), lang: effective(stored()),
  setChoice: (choice) => {
    try { if (choice === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch { /* private window: lasts until closed */ }
    set({ choice, lang: effective(choice) });
  },
  // the welcome screen's and the guide's own switch: picking a language there is picking it for the app
  set: (lang) => useLang.getState().setChoice(lang)
}));
// another window (the tray menu) changed it
addEventListener("storage", (event) => { if (event.key === KEY) { const choice = stored(); useLang.setState({ choice, lang: effective(choice) }); } });

/** The text in the current language. */
export const t = (english: string): string => useLang.getState().lang === "ru" ? RU[english] ?? english : english;
export const locale = () => useLang.getState().lang === "ru" ? "ru-RU" : "en-GB";

/* "3 tracks" / "3 трека" / "5 треков": the Russian forms are one / few / many */
const FORMS: Record<string, [string, string, string]> = {
  track: ["трек", "трека", "треков"], album: ["альбом", "альбома", "альбомов"], playlist: ["плейлист", "плейлиста", "плейлистов"],
  play: ["прослушивание", "прослушивания", "прослушиваний"], day: ["день", "дня", "дней"], session: ["сессия", "сессии", "сессий"],
  skip: ["пропуск", "пропуска", "пропусков"], file: ["файл", "файла", "файлов"], record: ["пластинка", "пластинки", "пластинок"]
};
export function count(n: number, noun: string, plural = noun + "s"): string {
  const value = Math.round(n);
  if (useLang.getState().lang !== "ru" || !FORMS[noun]) return value + " " + (value === 1 ? noun : plural);
  const m10 = value % 10, m100 = value % 100;
  return value + " " + FORMS[noun][m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2];
}

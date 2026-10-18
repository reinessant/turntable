import { create } from "zustand";

/* The language of the welcome screen and the quick guide: starts in the system's, and the switch at the top
   of either one changes both. */
export type Lang = "ru" | "en";
export const useLang = create<{ lang: Lang; set: (lang: Lang) => void }>((set) => ({
  lang: (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "en",
  set: (lang) => set({ lang })
}));

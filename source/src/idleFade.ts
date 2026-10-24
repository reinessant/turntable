import { useEffect } from "react";
import { useApp } from "./state";
import { useSettings } from "./settings";

/* When nothing is touched for a while and the music plays, the interface becomes translucent: everything except the record
   player itself (the body gets the class `ui-idle`, styles.css does the rest). A move of the mouse, a key, a click or the
   wheel brings it back at once. Off for a paused record, in the mini player, and while a sheet (search, downloads, the
   guide) is open: someone is reading then. */

/** how long the mouse rests before the interface fades, ms */
const REST = 6000;

export function useIdleFade(): void {
  const enabled = useSettings((state) => state.idleFade);
  const screen = useApp((state) => state.screen);
  const section = useApp((state) => state.section);
  const playing = useApp((state) => state.phase === "PLAYING");
  const mini = useApp((state) => state.mini);
  const sheet = useApp((state) => !!state.download || state.search || state.welcome || state.guide);
  const active = enabled && screen === "player" && section === "albums" && playing && !mini && !sheet;

  useEffect(() => {
    const body = document.body;
    if (!active) { body.classList.remove("ui-idle"); return; }
    let timer = 0;
    const rest = () => { clearTimeout(timer); timer = window.setTimeout(() => body.classList.add("ui-idle"), REST); };
    const wake = () => { if (body.classList.contains("ui-idle")) body.classList.remove("ui-idle"); rest(); };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) addEventListener(name, wake, { passive: true });
    rest();
    return () => { clearTimeout(timer); for (const name of events) removeEventListener(name, wake); body.classList.remove("ui-idle"); };
  }, [active]);
}

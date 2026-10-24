/* Reordering a list by dragging a row's handle (the album editor, the playlist editor). The listeners live on the window,
   not on the handle: moving a row moves its element in the page, and the browser then drops the handle's pointer capture —
   the release never reached it, and the row stayed stuck to the cursor. Any end of the press (release, cancel, losing focus,
   a move with no button down) lets go. */
import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** a row's height, px (import-reference.css) */
export const ROW_HEIGHT = 48;

/** Returns the handler for a handle's `onPointerDown`. `count()` is the list's length now, `move` puts row `from` at `to`. */
export function useRowDrag(count: () => number, move: (from: number, to: number) => void): (event: ReactPointerEvent, index: number) => void {
  const end = useRef<(() => void) | null>(null);
  useEffect(() => () => end.current?.(), []);
  return (event, index) => {
    if (event.button !== 0) return;
    event.preventDefault();                      // no text selection while dragging
    end.current?.();
    let at = index, startY = event.clientY;
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0) { stop(); return; }   // the release happened where we could not hear it
      const wanted = at + Math.round((e.clientY - startY) / ROW_HEIGHT);
      const to = Math.min(count() - 1, Math.max(0, wanted));
      if (to === at) { if (wanted !== at) startY = e.clientY; return; }   // pushed past the end of the list: the overshoot is forgotten
      move(at, to);
      startY += (to - at) * ROW_HEIGHT;          // the rest of the move stays for the next step: the row keeps up with the cursor
      at = to;
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      document.body.style.cursor = previous;
      end.current = null;
    };
    const previous = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    end.current = stop;
  };
}

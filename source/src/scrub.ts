import { useRef, useState } from "react";
import type React from "react";

/** Drag-to-seek on a horizontal bar. While the pointer is down the bar shows where it will land (`preview`)
    and the music is left alone; the seek happens once, on release — no stutter from re-seeking every move.
    `hover` is where the pointer is over the bar (for a time tip). */
export function useScrub(duration: number, onSeek: (seconds: number) => void) {
  const [preview, setPreview] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; seconds: number } | null>(null);
  const dragging = useRef(false);
  const at = (event: React.PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
    return { x: fraction, seconds: fraction * (duration || 0) };
  };
  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (!duration) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = true;
      setPreview(at(event).seconds);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const point = at(event);
      setHover(point);
      if (dragging.current) setPreview(point.seconds);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      const target = at(event).seconds;
      setPreview(null);
      onSeek(target);
    },
    onPointerCancel: () => { dragging.current = false; setPreview(null); },
    onPointerLeave: () => { if (!dragging.current) setHover(null); }
  };
  return { preview, hover, dragging: preview !== null, handlers };
}

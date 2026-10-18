import { useEffect, useRef } from "react";

/* Record labels are small (30–150 px) and spin. Letting the GPU shrink a 1000 px cover on every
   frame gives a soft, shimmering label, so each label is pre-scaled once — high-quality resample —
   into a canvas at exactly the device pixels it occupies. */

const ready = new WeakMap<HTMLCanvasElement, Promise<void>>();
const decoded = new Map<string, Promise<HTMLImageElement>>();

function load(src: string): Promise<HTMLImageElement> {
  let promise = decoded.get(src);
  if (!promise) {
    const image = new Image();
    image.src = src;
    promise = image.decode().then(() => image);
    decoded.set(src, promise);
    promise.catch(() => decoded.delete(src));
  }
  return promise;
}

/** Device pixels per artboard pixel (window DPR × the 1920×1080 artboard fit). */
export function pixelScale(): number {
  const fit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fit")) || 1;
  return (window.devicePixelRatio || 1) * fit;
}

/** Paint `src` (centre-cropped square, round) into `canvas` for a label `cssSize` artboard px wide. */
export function paintLabel(canvas: HTMLCanvasElement, src: string, cssSize: number): Promise<void> {
  const job = (async () => {
    const px = Math.max(16, Math.round(cssSize * pixelScale()));
    const image = await load(src);
    const crop = Math.min(image.naturalWidth, image.naturalHeight);
    const bitmap = await createImageBitmap(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop,
      { resizeWidth: px, resizeHeight: px, resizeQuality: "high" });
    canvas.width = canvas.height = px;
    const context = canvas.getContext("2d")!;
    context.save();
    context.beginPath(); context.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2); context.clip();
    context.drawImage(bitmap, 0, 0);
    context.restore();
    bitmap.close();
  })();
  ready.set(canvas, job.catch(() => undefined));
  return job;
}

/** Resolves once the canvas holds its label (immediately for canvases that are not labels). */
export function labelReady(canvas: HTMLCanvasElement | null | undefined): Promise<void> {
  return (canvas && ready.get(canvas)) || Promise.resolve();
}

/** Copy every canvas of `source` into the matching canvas of its clone (cloneNode does not copy pixels). */
export function copyCanvases(source: Element, clone: Element): void {
  const from = source.querySelectorAll("canvas"), to = clone.querySelectorAll("canvas");
  from.forEach((canvas, index) => {
    const target = to[index];
    if (!target || !canvas.width) return;
    target.width = canvas.width; target.height = canvas.height;
    target.getContext("2d")?.drawImage(canvas, 0, 0);
  });
}

/** A <canvas> label that repaints itself when the window (and so the artboard scale) changes. */
export function LabelCanvas({ src, size, className }: { src: string; size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => repaintOnResize(ref.current, src, size), [src, size]);
  return <canvas className={className} ref={ref} />;
}

/** Paint now and again whenever the window size (artboard scale) settles. Returns the cleanup. */
export function repaintOnResize(canvas: HTMLCanvasElement | null, src: string, size: number): () => void {
  if (!canvas || !src) return () => undefined;
  const paint = () => { void paintLabel(canvas, src, size).catch(() => undefined); };
  paint();
  let timer = 0;
  const resize = () => { clearTimeout(timer); timer = window.setTimeout(paint, 150); };
  addEventListener("resize", resize);
  return () => { clearTimeout(timer); removeEventListener("resize", resize); };
}

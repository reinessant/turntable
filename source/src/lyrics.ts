import type { LyricLine } from "./types";
export function parseLrc(source: string): LyricLine[] {
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const lines: LyricLine[] = [];
  for (const row of source.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d+):(\d{1,2})(?:\.(\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = row.replace(/\[(\d+):(\d{1,2})(?:\.(\d{1,3}))?\]/g, "").trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3].padEnd(3, "0")) / 1000 : 0;
      lines.push({ time: Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + fraction - offset), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

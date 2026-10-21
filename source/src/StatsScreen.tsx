import { useEffect, useMemo, useRef, useState } from "react";
import { asset } from "./library";
import { count, locale, t } from "./lang";
import { coverSrc } from "./PlayerScreen";
import { LP_SIDE_SECONDS, NEEDLE_M_PER_S, REVOLUTIONS_PER_S, dayOf, resetStats, streaks, useStats } from "./stats";
import type { StatsData } from "./stats";
import { setCrateGenre, useApp } from "./state";
import type { Album } from "./types";

/* The stats screen: how much you listen, to what, and when. Plain SVG charts, one hue for magnitude (blue), a
   fixed colour order for the genre split, grid and axes kept quiet, every mark has a hover tooltip and every
   chart has its numbers written out beside it (the lists), so nothing is colour-only. */

/* ---------------------------------------------------------------- formatting */
export function duration(seconds: number, short = false): string {
  const s = Math.round(seconds);
  if (s < 60) return s + " " + (short ? t("s") : t("sec"));
  const m = Math.round(s / 60);
  if (m < 60) return m + " " + t("min");
  const h = Math.floor(s / 3600), rest = Math.round((s % 3600) / 60);
  return rest ? h + " " + t("h") + " " + rest + " " + t("min") : h + " " + t("h");
}
const capital = (text: string) => text ? text[0].toUpperCase() + text.slice(1) : text;
const hoursOnly = (seconds: number) => seconds >= 3600 ? (seconds / 3600).toFixed(seconds >= 36000 ? 0 : 1) + " " + t("h") : Math.round(seconds / 60) + " " + t("min");
const number = (n: number) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
const plural = (n: number, one: string) => count(n, one);
const dateLabel = (key: string, long = false) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale(), long ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
};

/* colours: magnitude is always this blue (lighter = more); the genre split uses the fixed categorical order, the
   dark-surface steps; "Other" is a neutral */
const BLUE = "#6da7ec", BLUE_HI = "#9ec5f4";
const CATEGORICAL = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
const OTHER = "rgba(243,241,236,.34)";

/* ---------------------------------------------------------------- tooltips */
interface Tip { x: number; y: number; title: string; lines: string[] }
/** A tooltip layer for one chart: the chart calls `show(event, title, lines)` on hover. Positions are in the
    container's own pixels (the screen is scaled with CSS zoom, so the pointer is converted). */
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (event: React.PointerEvent | React.MouseEvent, title: string, lines: string[] = []) => {
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect(), k = rect.width / el.offsetWidth || 1;
    setTip({ x: (event.clientX - rect.left) / k, y: (event.clientY - rect.top) / k, title, lines });
  };
  const hide = () => setTip(null);
  const layer = tip && <div className="sx-tip" style={{ left: Math.min(tip.x + 14, (box.current?.offsetWidth ?? 600) - 180), top: Math.max(0, tip.y - 56) }}>
    <b>{tip.title}</b>{tip.lines.map((line) => <span key={line}>{line}</span>)}
  </div>;
  return { box, show, hide, layer };
}

function Card({ title, note, span, children, right }: { title: string; note?: string; span: number; children: React.ReactNode; right?: React.ReactNode }) {
  return <section className="st-card sx-card" style={{ gridColumn: "span " + span }}>
    <div className="sx-head"><div><h3>{title}</h3>{note && <p>{note}</p>}</div>{right}</div>
    {children}
  </section>;
}
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; name: string }[]; onChange: (id: T) => void; label: string }) {
  return <div className="st-seg sx-seg" role="group" aria-label={label}>{options.map((o) => <button key={o.id} className={value === o.id ? "on" : ""} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.name}</button>)}</div>;
}

/* ---------------------------------------------------------------- charts */
/** top corners rounded, bottom square on the baseline */
const barPath = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};
const niceMax = (value: number) => {
  if (value <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(value))), f = value / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
};

function DailyBars({ days, count }: { days: Record<string, number>; count: 30 | 90 }) {
  const { box, show, hide, layer } = useTip();
  const W = 760, H = 292, left = 44, right = 8, top = 24, bottom = 26;
  const series = useMemo(() => {
    const out: { key: string; sec: number }[] = [];
    const cursor = new Date(); cursor.setDate(cursor.getDate() - (count - 1));
    for (let i = 0; i < count; i++) { const key = dayOf(cursor); out.push({ key, sec: days[key] ?? 0 }); cursor.setDate(cursor.getDate() + 1); }
    return out;
  }, [days, count]);
  const inMinutes = series.map((d) => d.sec / 60);
  const peak = Math.max(10, ...inMinutes);
  // the axis counts in minutes up to two hours, then in whole hours
  const max = peak > 120 ? Math.ceil(peak / 60 / 2) * 2 * 60 : niceMax(peak);
  const step = (W - left - right) / count, barW = Math.min(20, step * .62);
  const y = (minutes: number) => top + (H - top - bottom) * (1 - minutes / max);
  const average = inMinutes.reduce((a, b) => a + b, 0) / count;
  const tick = (m: number) => m >= 120 ? Math.round(m / 60 * 10) / 10 + " " + t("h") : m + " " + t("m");
  return <div className="sx-chart" ref={box}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Minutes listened per day")}>
      {[0, .5, 1].map((f) => <g key={f}><line className="sx-grid" x1={left} x2={W - right} y1={y(max * f)} y2={y(max * f)} /><text className="sx-axis" x={left - 8} y={y(max * f) + 4} textAnchor="end">{tick(Math.round(max * f))}</text></g>)}
      {series.map((d, i) => {
        const h = Math.max(0, (H - top - bottom) * (d.sec / 60 / max)), x = left + i * step + (step - barW) / 2;
        const today = i === count - 1;
        return <g key={d.key}>
          {d.sec > 0 && <path d={barPath(x, y(d.sec / 60), barW, Math.max(2, h), 4)} fill={today ? BLUE_HI : BLUE} opacity={today ? 1 : .9} />}
          {d.sec === 0 && <rect x={x} y={H - bottom - 2} width={barW} height={2} rx={1} className="sx-zero" />}
          <rect x={left + i * step} y={top} width={step} height={H - top - bottom} fill="transparent"
            onPointerMove={(event) => show(event, dateLabel(d.key, true), [d.sec ? duration(d.sec) : t("Nothing played")])} onPointerLeave={hide} />
        </g>;
      })}
      <line className="sx-avg" x1={left} x2={W - right} y1={y(average)} y2={y(average)} />
      <text className="sx-avg-label" x={W - right} y={12} textAnchor="end">{t("Average")} {Math.round(average)} {t("min a day")}</text>
      {series.map((d, i) => (i % (count === 30 ? 5 : 15) === 0 || i === count - 1) && <text key={d.key} className="sx-axis" x={left + i * step + step / 2} y={H - 6} textAnchor="middle">{dateLabel(d.key)}</text>)}
    </svg>
    {layer}
  </div>;
}

function Heatmap({ days }: { days: Record<string, number> }) {
  const { box, show, hide, layer } = useTip();
  const WEEKS = 26, cell = 20, gap = 5, left = 34, top = 22;
  const grid = useMemo(() => {
    const end = new Date(); end.setHours(12, 0, 0, 0);
    const monday = new Date(end); monday.setDate(end.getDate() - ((end.getDay() + 6) % 7));
    const start = new Date(monday); start.setDate(monday.getDate() - (WEEKS - 1) * 7);
    const cells: { key: string; col: number; row: number; sec: number; future: boolean }[] = [];
    for (let w = 0; w < WEEKS; w++) for (let r = 0; r < 7; r++) {
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + r);
      cells.push({ key: dayOf(date), col: w, row: r, sec: days[dayOf(date)] ?? 0, future: date > end });
    }
    const values = cells.map((c) => c.sec).filter((v) => v > 0).sort((a, b) => a - b);
    return { cells, high: values[Math.floor(values.length * .9)] || 1 };
  }, [days]);
  const W = left + WEEKS * (cell + gap), H = top + 7 * (cell + gap);
  const months = grid.cells.filter((c) => c.row === 0 && (c.col === 0 || c.key.slice(8) <= "07" && c.key.slice(8) >= "01")).map((c) => ({ col: c.col, label: capital(new Date(c.key + "T12:00:00").toLocaleDateString(locale(), { month: "short" })) }));
  const level = (sec: number) => sec <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.min(.999, sec / grid.high) * 4));
  return <div className="sx-chart" ref={box}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Last half year")}>
      {months.map((m) => <text key={m.col + m.label} className="sx-axis" x={left + m.col * (cell + gap)} y={12}>{m.label}</text>)}
      {[t("Mon"), t("Wed"), t("Fri")].map((name, i) => <text key={name} className="sx-axis" x={left - 8} y={top + i * 2 * (cell + gap) + cell * .72} textAnchor="end">{name}</text>)}
      {grid.cells.map((c) => !c.future && <rect key={c.key} x={left + c.col * (cell + gap)} y={top + c.row * (cell + gap)} width={cell} height={cell} rx={5}
        fill={level(c.sec) ? BLUE : "rgba(243,241,236,.07)"} opacity={level(c.sec) ? [0, .28, .5, .75, 1][level(c.sec)] : 1}
        onPointerMove={(event) => show(event, dateLabel(c.key, true), [c.sec ? duration(c.sec) : t("Nothing played")])} onPointerLeave={hide} />)}
    </svg>
    <div className="sx-scale" aria-hidden="true"><span>{t("Less")}</span>{[.07, .28, .5, .75, 1].map((o, i) => <i key={i} style={{ background: i ? BLUE : "rgba(243,241,236,.07)", opacity: i ? o : 1 }} />)}<span>{t("More")}</span></div>
    {layer}
  </div>;
}

const DAYPARTS = [
  { name: "Night owl", from: 0, to: 5, text: "Most of your listening happens after midnight" },
  { name: "Morning person", from: 5, to: 12, text: "You do your listening before noon" },
  { name: "Afternoon cruiser", from: 12, to: 18, text: "The afternoon is when the needle drops" },
  { name: "Evening listener", from: 18, to: 24, text: "Your records come out when the day is done" }
];
function persona(hours: number[]) {
  const total = hours.reduce((a, b) => a + b, 0) || 1;
  const parts = DAYPARTS.map((p) => ({ ...p, share: hours.slice(p.from, p.to).reduce((a, b) => a + b, 0) / total }));
  return parts.reduce((a, b) => b.share > a.share ? b : a);
}

function Clock({ hours }: { hours: number[] }) {
  const { box, show, hide, layer } = useTip();
  const S = 300, c = S / 2, inner = 52, reach = 78;
  const max = Math.max(1, ...hours), peak = hours.indexOf(Math.max(...hours));
  const wedge = (i: number, length: number) => {
    const a0 = (i / 24) * Math.PI * 2 - Math.PI / 2 + .02, a1 = ((i + 1) / 24) * Math.PI * 2 - Math.PI / 2 - .02, r1 = inner + length;
    const p = (a: number, r: number) => `${(c + Math.cos(a) * r).toFixed(2)},${(c + Math.sin(a) * r).toFixed(2)}`;
    return `M${p(a0, inner)} L${p(a0, r1)} A${r1},${r1} 0 0 1 ${p(a1, r1)} L${p(a1, inner)} A${inner},${inner} 0 0 0 ${p(a0, inner)} Z`;
  };
  return <div className="sx-chart sx-clock" ref={box}>
    <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={t("Your clock")}>
      <circle cx={c} cy={c} r={inner - 3} className="sx-grid-fill" />
      <circle cx={c} cy={c} r={inner + reach} className="sx-grid" fill="none" strokeDasharray="2 4" />
      {hours.map((sec, i) => <g key={i}>
        <path d={wedge(i, Math.max(2, (sec / max) * reach))} fill={i === peak && sec > 0 ? BLUE_HI : BLUE} opacity={sec > 0 ? (i === peak ? 1 : .55 + .4 * sec / max) : .12} />
        <path d={wedge(i, reach)} fill="transparent" onPointerMove={(event) => show(event, String(i).padStart(2, "0") + ":00 – " + String((i + 1) % 24).padStart(2, "0") + ":00", [sec ? duration(sec) : t("Nothing played")])} onPointerLeave={hide} />
      </g>)}
      {[0, 6, 12, 18].map((h) => { const a = (h / 24) * Math.PI * 2 - Math.PI / 2, r = inner + reach + 12; return <text key={h} className="sx-axis" x={c + Math.cos(a) * r} y={c + Math.sin(a) * r + 4} textAnchor="middle">{String(h).padStart(2, "0")}</text>; })}
      <text className="sx-clock-big" x={c} y={c + 2} textAnchor="middle">{hours[peak] > 0 ? String(peak).padStart(2, "0") + ":00" : "—"}</text>
      <text className="sx-axis" x={c} y={c + 20} textAnchor="middle">{t("Golden hour")}</text>
    </svg>
    {layer}
  </div>;
}

function Weekdays({ weekdays }: { weekdays: number[] }) {
  const names = [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")], max = Math.max(1, ...weekdays);
  return <ul className="sx-bars" aria-label={t("Days of the week")}>{weekdays.map((sec, i) => <li key={i}>
    <span className="sx-bar-name">{names[i]}</span>
    <span className="sx-bar-track"><i style={{ width: (sec / max) * 100 + "%", background: i >= 5 ? BLUE_HI : BLUE }} /></span>
    <span className="sx-bar-val">{sec ? hoursOnly(sec) : "—"}</span>
  </li>)}</ul>;
}

interface Row { key: string; label: string; sub?: string; value: number; text: string; cover?: string; onClick?: () => void }
function Ranked({ rows, empty }: { rows: Row[]; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="sx-empty">{empty}</p>;
  return <ol className="sx-rank">{rows.map((row, i) => <li key={row.key}>
    <span className="sx-n mono">{String(i + 1).padStart(2, "0")}</span>
    {row.cover !== undefined && <span className="sx-thumb">{row.cover ? <img src={row.cover} alt="" /> : <i />}</span>}
    <span className="sx-name"><b title={row.label}>{row.label}</b>{row.sub && <span title={row.sub}>{row.sub}</span>}
      <span className="sx-line"><i style={{ width: Math.max(2, row.value / max * 100) + "%" }} /></span></span>
    <span className="sx-val mono">{row.text}</span>
  </li>)}</ol>;
}

function Donut({ genres }: { genres: Record<string, number> }) {
  const { box, show, hide, layer } = useTip();
  const entries = Object.entries(genres).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, sec]) => sum + sec, 0);
  const shown: [string, number, string][] = entries.slice(0, 5).map(([name, sec], i) => [name, sec, CATEGORICAL[i]]);
  const rest = entries.slice(5).reduce((sum, [, sec]) => sum + sec, 0);
  if (rest > 0) shown.push([t("Other"), rest, OTHER]);
  if (!total) return <p className="sx-empty">{t("No genres yet — give your albums up to three genre tags (Edit album) and they show up here.")}</p>;
  const R = 78, c = 100, gap = .035;
  let angle = -Math.PI / 2;
  const arcs = shown.map(([name, sec, color]) => {
    const span = sec / total * Math.PI * 2, a0 = angle + gap / 2, a1 = angle + span - gap / 2;
    angle += span;
    const p = (a: number) => `${(c + Math.cos(a) * R).toFixed(2)},${(c + Math.sin(a) * R).toFixed(2)}`;
    return { name, sec, color, d: span > gap * 1.5 ? `M${p(a0)} A${R},${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}` : "" };
  });
  return <div className="sx-donut" ref={box}>
    <svg viewBox="0 0 200 200" role="img" aria-label={t("Genres")}>
      {arcs.map((arc) => arc.d && <path key={arc.name} d={arc.d} stroke={arc.color} strokeWidth={24} strokeLinecap="butt" fill="none"
        onPointerMove={(event) => show(event, arc.name, [Math.round(arc.sec / total * 100) + "% · " + duration(arc.sec)])} onPointerLeave={hide} />)}
      <text className="sx-clock-big" x={c} y={c + 4} textAnchor="middle">{shown.length === 1 && shown[0][0] !== t("Other") ? "1" : entries.length}</text>
      <text className="sx-axis" x={c} y={c + 22} textAnchor="middle">{entries.length === 1 ? t("Genre") : t("Genres")}</text>
    </svg>
    <ul className="sx-legend">{arcs.map((arc) => <li key={arc.name}><i style={{ background: arc.color }} /><span className="sx-lname">{arc.name}</span><span className="mono">{Math.round(arc.sec / total * 100)}%</span><span className="sx-ltime mono">{hoursOnly(arc.sec)}</span></li>)}</ul>
    {layer}
  </div>;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="sx-tile"><span className="micro">{label}</span><b>{value}</b>{hint && <em>{hint}</em>}</div>;
}
function Fact({ big, text, icon }: { big: string; text: string; icon?: React.ReactNode }) {
  return <div className="sx-fact">{icon}<b>{big}</b><span>{text}</span></div>;
}

/* ---------------------------------------------------------------- the screen */
const thumbOf = (album?: Album) => album ? (album.coverThumbPath ? (album.coverThumbPath.startsWith("data:") ? album.coverThumbPath : asset(album.coverThumbPath)) : coverSrc(album)) : "";

export function StatsScreen() {
  const data = useStats((s) => s.data) as StatsData;
  const albums = useApp((s) => s.albums);
  const [range, setRange] = useState<30 | 90>(30);
  const [metric, setMetric] = useState<"time" | "plays">("time");
  const [allAlbums, setAllAlbums] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // dev: ?scroll=900 opens the screen scrolled (for screenshots)
  useEffect(() => { if (import.meta.env.DEV) { const y = Number(new URLSearchParams(location.search).get("scroll")); if (y && scroller.current) scroller.current.scrollTop = y; } });
  const byId = useMemo(() => new Map(albums.map((a) => [a.id, a])), [albums]);
  const local = albums.filter((a) => a.kind !== "playlist");

  const albumRows = Object.entries(data.albums).map(([id, a]) => ({ id, ...a }));
  const trackRows = Object.entries(data.tracks).map(([key, t]) => ({ key, ...t }));
  const sortedAlbums = [...albumRows].sort((a, b) => metric === "time" ? b.sec - a.sec : b.plays - a.plays || b.sec - a.sec);
  const sortedTracks = [...trackRows].sort((a, b) => metric === "time" ? b.sec - a.sec : b.plays - a.plays || b.sec - a.sec);
  const artistRows = Object.entries(data.artists).sort((a, b) => b[1] - a[1]);
  const { current: streak, best: bestStreak } = streaks(data.days);
  const activeDays = Object.values(data.days).filter((s) => s > 30).length;
  const heard = new Set(albumRows.filter((a) => a.sec >= 30).map((a) => a.id));
  const libraryHeard = local.filter((a) => heard.has(a.id)).length;
  const busiest = Object.entries(data.days).sort((a, b) => b[1] - a[1])[0];
  const topRepeat = [...trackRows].sort((a, b) => b.plays - a.plays)[0];
  const mostSkipped = [...trackRows].sort((a, b) => b.skips - a.skips)[0];
  const weekend = (data.weekdays[5] + data.weekdays[6]) / (data.total || 1);
  const mood = persona(data.hours);
  const empty = data.total < 15;
  const topAlbum = sortedAlbums[0];

  if (empty) return <div className="screen stats-screen">
    <header className="header"><div className="brand"><span className="h">{t("Stats")}</span><span className="mono">{t("Your listening, counted")}</span></div><div className="hright" /></header>
    <div className="sx-nothing"><div className="sx-disc" aria-hidden="true" /><h2>{t("Nothing counted yet")}</h2><p>{t("Play something and come back. Turntable keeps count of what you listen to, when, and for how long — everything stays on this computer.")}</p></div>
  </div>;

  return <div className="screen stats-screen">
    <header className="header"><div className="brand"><span className="h">{t("Stats")}</span><span className="mono">{t("Since")} {new Date(data.since).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" })}</span></div>
      <div className="hright">{confirmReset
        ? <div className="delete-choice">{t("Erase all stats?")} <button className="pill-btn" onClick={() => { resetStats(); setConfirmReset(false); }}>{t("Erase")}</button><button className="pill-btn" onClick={() => setConfirmReset(false)}>{t("Keep")}</button></div>
        : <button className="pill-btn" onClick={() => setConfirmReset(true)}>{t("Reset stats")}</button>}</div></header>
    <div className="st-scroll sx-scroll" ref={scroller}>
      <div className="sx-grid-layout">
        <section className="st-card sx-card sx-hero" style={{ gridColumn: "span 12" }}>
          <div className="sx-hero-main"><span className="micro">{t("Time on the turntable")}</span>
            <b className="sx-total">{duration(data.total)}</b>
            <p>{plural(data.plays, "play")} · {plural(activeDays, "day")} {t("with music")} · {duration(data.total / Math.max(1, activeDays))} {t("on an average day")}</p></div>
          <div className="sx-tiles">
            <Tile label={t("Streak")} value={plural(streak, "day")} hint={t("Best") + ": " + bestStreak} />
            <Tile label={t("Albums heard")} value={libraryHeard + " / " + local.length} hint={local.length ? Math.round(libraryHeard / local.length * 100) + "% " + t("of the library") : undefined} />
            <Tile label={t("Longest session")} value={duration(data.bestSession)} hint={plural(data.sessions, "session")} />
            <Tile label={t("Heard to the end")} value={number(data.finished)} hint={data.plays ? Math.round(Math.min(1, data.finished / data.plays) * 100) + "% " + t("of plays") : undefined} />
            <Tile label={t("Skipped")} value={number(data.skips)} hint={data.plays + data.skips ? Math.round(data.skips / (data.plays + data.skips) * 100) + "% " + t("of tracks started") : undefined} />
          </div>
        </section>

        <Card title={t("Every day")} note={t("Minutes listened per day")} span={8} right={<Segmented label={t("Range")} value={String(range) as "30" | "90"} options={[{ id: "30", name: t("30 days") }, { id: "90", name: t("90 days") }]} onChange={(v) => setRange(v === "30" ? 30 : 90)} />}>
          <DailyBars days={data.days} count={range} />
        </Card>
        <Card title={t("Your clock")} note={t(mood.name)} span={4}>
          <Clock hours={data.hours} />
          <p className="sx-caption">{t(mood.text)} — {Math.round(mood.share * 100)}% {t("between")} {String(mood.from).padStart(2, "0")}:00 {t("and")} {String(mood.to % 24).padStart(2, "0")}:00.</p>
        </Card>

        <Card title={t("Last half year")} note={t("Each square is a day; brighter means more")} span={8}><Heatmap days={data.days} /></Card>
        <Card title={t("Days of the week")} note={weekend > .42 ? t("A weekend listener") : weekend < .22 ? t("A weekday listener") : t("Evenly spread")} span={4}><Weekdays weekdays={data.weekdays} /></Card>

        <Card title={t("Top albums")} note={t("Records you come back to")} span={6} right={<Segmented label={t("Rank by")} value={metric} options={[{ id: "time", name: t("Time") }, { id: "plays", name: t("Plays") }]} onChange={setMetric} />}>
          <Ranked empty={t("Nothing yet.")} rows={sortedAlbums.slice(0, 8).map((a) => ({ key: a.id, label: a.title, sub: a.playlist ? t("Playlist") : a.artist, value: metric === "time" ? a.sec : a.plays, text: metric === "time" ? duration(a.sec, true) : plural(a.plays, "play"), cover: thumbOf(byId.get(a.id)) }))} />
        </Card>
        <Card title={t("Top tracks")} note={metric === "time" ? t("By time listened") : t("By number of plays")} span={6}>
          <Ranked empty={t("Nothing yet.")} rows={sortedTracks.slice(0, 8).map((t) => ({ key: t.key, label: t.title, sub: t.artist + " · " + t.album, value: metric === "time" ? t.sec : t.plays, text: metric === "time" ? duration(t.sec, true) : plural(t.plays, "play"), cover: thumbOf(byId.get(t.albumId)) }))} />
        </Card>

        <Card title={t("Top artists")} span={6}>
          <Ranked empty={t("Nothing yet.")} rows={artistRows.slice(0, 8).map(([name, sec]) => ({ key: name, label: name, value: sec, text: duration(sec, true) }))} />
        </Card>
        <Card title={t("Genres")} note={t("Share of your listening time")} span={6}><Donut genres={data.genres} />
          {Object.keys(data.genres).length > 0 && <div className="sx-genre-links">{Object.entries(data.genres).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => <button key={name} className="gp-chip small" title={t("Show only") + " " + name} onClick={() => { setCrateGenre(name); useApp.setState({ section: "albums" }); }}>{name}</button>)}</div>}
        </Card>

        <Card title={t("Little facts")} note={t("The numbers behind the numbers")} span={12}>
          <div className="sx-facts">
            <Fact big={(data.total * NEEDLE_M_PER_S >= 1000 ? (data.total * NEEDLE_M_PER_S / 1000).toFixed(1) + " " + t("km") : Math.round(data.total * NEEDLE_M_PER_S) + " " + t("m"))} text={t("Groove the needle has followed (at 33⅓ rpm, about 0.4 m every second)")} />
            <Fact big={number(data.total * REVOLUTIONS_PER_S)} text={t("Turns of the record — one every 1.8 seconds")} />
            <Fact big={(data.total / LP_SIDE_SECONDS).toFixed(data.total / LP_SIDE_SECONDS >= 10 ? 0 : 1)} text={t("LP sides' worth of music, counting 22 minutes a side")} />
            {busiest && <Fact big={duration(busiest[1])} text={t("Your busiest day,") + " " + dateLabel(busiest[0], true)} />}
            {topRepeat && topRepeat.plays > 1 && <Fact big={plural(topRepeat.plays, "play")} text={t("Your most repeated track:") + " " + topRepeat.title} />}
            {topAlbum && data.total > 0 && <Fact big={Math.round(topAlbum.sec / data.total * 100) + "%"} text={t("Share of everything you played:") + " " + topAlbum.title} />}
            {mostSkipped && mostSkipped.skips >= 2 && <Fact big={plural(mostSkipped.skips, "skip")} text={t("The track you leave most often:") + " " + mostSkipped.title} />}
            {data.viaPlaylists > 0 && <Fact big={Math.round(data.viaPlaylists / data.total * 100) + "%"} text={t("Share of your time that came from playlists; the rest is whole albums")} />}
            <Fact big={t(mood.name)} text={t("Your listening personality —") + " " + Math.round(mood.share * 100) + "% " + t("of it") + " " + (mood.from === 0 ? t("after midnight") : t("from") + " " + String(mood.from).padStart(2, "0") + ":00 " + t("to") + " " + String(mood.to % 24).padStart(2, "0") + ":00")} />
          </div>
        </Card>

        <Card title={t("Every album, by time")} note={allAlbums ? t("The whole library, most listened first") : t("Top twenty — open the list to see the rest")} span={12} right={<button className="pill-btn" onClick={() => setAllAlbums(!allAlbums)}>{allAlbums ? t("Show less") : t("Show all")}</button>}>
          <Ranked empty={t("Nothing yet.")} rows={libraryTimes(local, data).slice(0, allAlbums ? 1000 : 20).map((a) => ({ key: a.id, label: a.title, sub: a.artist, value: a.sec, text: a.sec ? duration(a.sec, true) : t("Not played yet"), cover: thumbOf(byId.get(a.id)) }))} />
        </Card>
      </div>
    </div>
  </div>;
}

/** Every album in the library with the time it has been heard (0 for the ones never played), most first;
    albums that are gone but have history stay on the list. */
function libraryTimes(local: Album[], data: StatsData): { id: string; title: string; artist: string; sec: number }[] {
  const rows = new Map<string, { id: string; title: string; artist: string; sec: number }>();
  for (const album of local) rows.set(album.id, { id: album.id, title: album.title, artist: album.artist, sec: data.albums[album.id]?.sec ?? 0 });
  for (const [id, a] of Object.entries(data.albums)) if (!rows.has(id) && !a.playlist) rows.set(id, { id, title: a.title, artist: a.artist, sec: a.sec });
  return [...rows.values()].sort((a, b) => b.sec - a.sec || a.title.localeCompare(b.title));
}

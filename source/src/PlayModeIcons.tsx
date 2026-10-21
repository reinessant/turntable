/* Shuffle and repeat glyphs (the icon sheet has neither), drawn like the rest: round-capped lines on a 16 grid. */
interface Props { size?: number; stroke?: number }
const svg = (size: number, stroke: number): React.SVGProps<SVGSVGElement> => ({
  viewBox: "0 0 16 16", width: size, height: size, fill: "none", stroke: "currentColor", strokeWidth: stroke,
  strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true
});
export function ShuffleIcon({ size = 18, stroke = 1.4 }: Props) {
  return <svg {...svg(size, stroke)}>
    <path d="M1.8 4.6h2.1c3.3 0 4.3 6.8 7.6 6.8h2.7M11.6 9.4l2.6 2-2.6 2" />
    <path d="M1.8 11.4h2.1c1 0 1.8-.7 2.5-1.8M8.5 6.6c.7-1.2 1.5-2 3-2h2.7M11.6 2.6l2.6 2-2.6 2" />
  </svg>;
}
/** `one`: repeat this track only (the loop with a 1 inside) */
export function RepeatIcon({ size = 18, stroke = 1.4, one = false }: Props & { one?: boolean }) {
  return <svg {...svg(size, stroke)}>
    <path d="M3 7.2v-.4a2.3 2.3 0 0 1 2.3-2.3H13M11 2.5l2 2-2 2" />
    <path d="M13 8.8v.4a2.3 2.3 0 0 1-2.3 2.3H3M5 9.5l-2 2 2 2" />
    {one && <path d="M7.2 7l1.1-.7v3.5" />}
  </svg>;
}

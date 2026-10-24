/* Colours of the crossfade animation: they belong to the album. Every track keeps the tone of the cover (the same the room's
   glow has) and differs from its neighbours only a little, in tone and lightness; a grey cover gets a pale, neutral light.
   No other file is needed to try it: pure functions (tests/downloads.test.mjs). */

export type Rgb = [number, number, number];

export function hsl(h: number, s: number, l: number): Rgb {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** how far a track's tone may sit from the cover's, degrees: the album stays one family of colour */
export const HUE_RANGE = 14;

/** A track's colours (main, light) for an album with this tone and colourfulness (the cover's `hDominant` and `cMean`).
    `index` is the track's place in the record: neighbours differ a little, the cover's own tone is always the middle. */
export function trackAccent(hue: number, chroma: number, index: number, onLight = false): { main: Rgb; light: Rgb } {
  const wobble = ((index * 37) % (2 * HUE_RANGE + 1)) - HUE_RANGE;      // -14..14
  const lift = ((index * 53) % 13) - 6;                                  // -6..6 lightness
  // a light room (a pale cover): light does not show on light, so the animation is drawn in ink, deep and saturated
  if (onLight) return chroma < .05 ? { main: hsl(0, 0, 24 + lift), light: hsl(0, 0, 12) } : { main: hsl(hue + wobble, 78, 40 + lift / 2), light: hsl(hue + wobble, 85, 28) };
  if (chroma < .05) return { main: hsl(0, 0, 78 + lift), light: hsl(0, 0, 94) };   // a grey cover: pale, no colour of its own
  return { main: hsl(hue + wobble, 75, 55 + lift), light: hsl(hue + wobble, 85, 82) };
}

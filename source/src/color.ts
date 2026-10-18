import type { ColorProfile } from "./types";
export const neutralProfile: ColorProfile = {
  lMean: .78, lMedian: .82, cMean: 0, cP90: 0, hDominant: 80,
  hSpread: 0, key: "light", temperature: "neutral"
};
export function oklchPixels(data: Uint8ClampedArray): ColorProfile {
  const lights: number[] = [];
  const chromas: number[] = [];
  let sumL = 0, sumC = 0, sumX = 0, sumY = 0, sumWeight = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]].map((v) => {
      const x = v / 255;
      return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
    });
    const l = Math.cbrt(.4122214708 * rgb[0] + .5363325363 * rgb[1] + .0514459929 * rgb[2]);
    const m = Math.cbrt(.2119034982 * rgb[0] + .6806995451 * rgb[1] + .1073969566 * rgb[2]);
    const s = Math.cbrt(.0883024619 * rgb[0] + .2817188376 * rgb[1] + .6299787005 * rgb[2]);
    const L = .2104542553 * l + .793617785 * m - .0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
    const b = .0259040371 * l + .7827717662 * m - .808675766 * s;
    const C = Math.hypot(a, b);
    lights.push(L);
    chromas.push(C);
    sumL += L;
    sumC += C;
    const weight = C * C;
    sumX += a / (C || 1) * weight;
    sumY += b / (C || 1) * weight;
    sumWeight += weight;
  }
  if (!lights.length) return neutralProfile;
  lights.sort((a, b) => a - b);
  chromas.sort((a, b) => a - b);
  const hDominant = (Math.atan2(sumY, sumX) * 180 / Math.PI + 360) % 360;
  const hSpread = sumWeight ? 1 - Math.hypot(sumX, sumY) / sumWeight : 0;
  return {
    lMean: sumL / lights.length, lMedian: lights[Math.floor(lights.length / 2)],
    cMean: sumC / lights.length, cP90: chromas[Math.floor(chromas.length * .9)],
    hDominant, hSpread, key: lights[Math.floor(lights.length / 2)] < .52 ? "dark" : "light",
    temperature: sumC / lights.length < .035 ? "neutral" : hDominant > 40 && hDominant < 200 ? "warm" : "cool"
  };
}
export async function prepareCover(blob: Blob): Promise<{ cover: number[]; thumb: number[]; colors: ColorProfile; url: string; small: boolean }> {
  const bitmap = await createImageBitmap(blob);
  const sample = document.createElement("canvas");
  sample.width = sample.height = 64;
  const context = sample.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, 64, 64);
  const colors = oklchPixels(context.getImageData(0, 0, 64, 64).data);
  const encode = async (size: number): Promise<number[]> => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e6e2da";
    ctx.fillRect(0, 0, size, size);
    const crop = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, size, size);
    const out = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Cover encoding failed")), "image/jpeg", .9));
    return [...new Uint8Array(await out.arrayBuffer())];
  };
  const cover = await encode(1000);
  const thumb = await encode(256);
  const small = bitmap.width < 400 || bitmap.height < 400;
  bitmap.close();
  const url = URL.createObjectURL(new Blob([new Uint8Array(cover)], { type: "image/jpeg" }));
  return { cover, thumb, colors, url, small };
}
export function roomColor(profile: ColorProfile, crate: boolean): { bg: string; ink: string; lightness: number } {
  let L = crate ? Math.min(.93, Math.max(.22, .30 + profile.lMedian * .60))
    : profile.lMedian < .18 && profile.cMean < .10 ? .13 : Math.min(.96, Math.max(.18, .86 + (profile.lMedian - .5) * .26));
  if (L >= .53 && L < .62) L = L < .575 ? .53 : .62;
  const C = crate ? Math.min(profile.cP90 * .3, profile.hSpread > .72 ? .02 : .065) : Math.min(profile.cMean * .1, .012);
  return { bg: 'oklch(' + (L * 100).toFixed(2) + '% ' + C.toFixed(4) + ' ' + profile.hDominant.toFixed(1) + ')',
    ink: L < .575 ? "#ffffff" : "#080909", lightness: L };
}




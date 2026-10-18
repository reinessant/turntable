import { oklchPixels } from "./color";
import type { Album } from "./types";

export function seedDemoCrate(): Album[] {
  if (!import.meta.env.DEV) return [];
  const sample = document.createElement("canvas");
  sample.width = sample.height = 64;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true })!;
  return Array.from({ length: 40 }, (_, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1000;
    const ctx = canvas.getContext("2d")!;
    const hue = (index * 137.5) % 360;
    const dark = index % 4 === 0;
    const base = "hsl(" + hue + " " + (32 + index % 4 * 11) + "% " + (dark ? 25 : 72 - index % 3 * 9) + "%)";
    const ink = dark ? "#eee9e1" : "#24272a";
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1000, 1000);
    ctx.save();
    ctx.translate(500, 490);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.globalAlpha = .45;
    if (index % 5 === 0) {
      for (let n = 1; n < 13; n++) {
        ctx.lineWidth = n % 3 ? 2 : 8;
        ctx.beginPath();
        ctx.arc(0, 0, 32 + n * 34, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (index % 5 === 1) {
      ctx.rotate(index * .2);
      for (let n = -8; n < 9; n++) ctx.fillRect(n * 65, -470, n % 3 ? 12 : 29, 940);
    } else if (index % 5 === 2) {
      ctx.beginPath();
      ctx.arc(0, 0, 335, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = .8;
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(116, -94, 230, 0, Math.PI * 2);
      ctx.fill();
    } else if (index % 5 === 3) {
      for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
        if ((x * 7 + y * 11 + index) % 4 === 0) ctx.fillRect(x * 77 - 19, y * 77 - 19, 38, 38);
      }
    } else {
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(-350, 260);
      ctx.bezierCurveTo(-50, -350, 30, 350, 350, -260);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = ink;
    ctx.font = "500 72px Arial, sans-serif";
    ctx.fillText("STUDY " + String(index + 1).padStart(2, "0"), 72, 116);
    ctx.font = "400 32px Arial, sans-serif";
    ctx.fillText(["FORM", "COLOUR", "MOTION", "SPACE"][index % 4], 76, 925);
    sampleContext.clearRect(0, 0, 64, 64);
    sampleContext.drawImage(canvas, 0, 0, 64, 64);
    const colors = oklchPixels(sampleContext.getImageData(0, 0, 64, 64).data);
    const coverPath = canvas.toDataURL("image/jpeg", .86);
    const id = "demo-" + String(index + 1).padStart(2, "0");
    return {
      id, title: "Study " + String(index + 1).padStart(2, "0"),
      artist: ["Aster", "Vale", "North", "Kite", "Mira"][index % 5],
      year: 2020 + index % 6, coverPath, coverThumbPath: coverPath,
      colors, addedAt: Date.now() - index * 1000, liked: false,
      tracks: Array.from({ length: 3 + index % 4 }, (_, trackIndex) => ({
        id: id + "-track-" + trackIndex, albumId: id, index: trackIndex,
        title: ["Prelude", "Drift", "Afterglow", "Contour", "Echo", "Nightfall"][trackIndex],
        duration: 16, filePath: "demo-tone:" + (180 + (index % 8) * 24 + trackIndex * 5)
      }))
    };
  });
}


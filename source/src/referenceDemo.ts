import type { Album } from "./types";
const darkTitles = ["Love Blur", "Demigod", "Sloppy Joe", "Never Going Down", "Wipe Yo Nose", "24/7", "Phone Interlude", "Power 4", "Death by MP3", "Holding", "The Sky", "Set In Stone"];
const darkDurations = [166, 167, 146, 120, 188, 126, 128, 100, 155, 153, 219, 124];
const lightTitles = [
  "2010 justin bieber prod m8i", "cara mia prod lucy bedroque", "cat's eye prod 9lives", "fenty face prod skai",
  "finish him ft jackzebra prod 2dah ivvy", "g6 anthem prod lucy bedroque", "i am impossible prod m8i", "ignorant prod cranes yk",
  "lucy bedroque - yes, you may prod cranes", "made in italy prod 177p pop north", "one of us is lying prod lucy bedroque",
  "ouija prod skai", "smackdown prod egobreak", "speakers never learn prod lucy bedroque",
  "tout naturel prod blxty inno rochambeau", "ultraviolet ft prettifun prod egobreak 9lives", "unmusique prod lucy bedroque"
];
const lightDurations = [112, 154, 119, 134, 103, 195, 118, 133, 113, 126, 199, 128, 138, 135, 151, 193, 150];
function makeAlbum(light: boolean): Album {
  const id = light ? "reference-unmusique" : "reference-half-blood";
  const titles = light ? lightTitles : darkTitles;
  const durations = light ? lightDurations : darkDurations;
  const cover = light ? "/design/cover-light.jpg" : "/design/cover.jpg";
  return {
    id, title: light ? "Unmusique" : "Half Blood", artist: light ? "Lucy Bedroque" : "slayr", year: 2025,
    coverPath: cover, coverThumbPath: cover,
    colors: light ? { lMean: .9, lMedian: .92, cMean: .01, cP90: .02, hDominant: 0, hSpread: .2, key: "light", temperature: "neutral" }
      : { lMean: .4, lMedian: .4, cMean: .07, cP90: .15, hDominant: 260, hSpread: .2, key: "dark", temperature: "cool" },
    addedAt: Date.now(), liked: false,
    tracks: titles.map((title, index) => ({
      id: id + "-" + index, albumId: id, index, title, duration: durations[index], filePath: "demo-tone:" + (180 + index * 7)
    }))
  };
}
export const referenceAlbum = () => makeAlbum(false);
export const referenceLightAlbum = () => makeAlbum(true);

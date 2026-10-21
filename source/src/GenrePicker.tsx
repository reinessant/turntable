import { useMemo, useState } from "react";
import { MAX_GENRES, SUGGESTED_GENRES, libraryGenres, withGenre } from "./genres";
import { useApp } from "./state";
import { Icon } from "./PlayerScreen";
import { t } from "./lang";

/** Up to three genre tags: the chosen ones as chips, a box to type a new one (Enter or comma), and suggestions —
    the genres already in the library first, then a common list. Used by the album editor and the playlist editor. */
export function GenrePicker({ value, onChange }: { value: string[]; onChange: (genres: string[]) => void }) {
  const albums = useApp((s) => s.albums);
  const [text, setText] = useState("");
  const full = value.length >= MAX_GENRES;
  const suggestions = useMemo(() => {
    const used = new Set(value.map((g) => g.toLowerCase()));
    const own = libraryGenres(albums).map((g) => g.genre);
    const typed = text.trim().toLowerCase();
    return [...new Set([...own, ...SUGGESTED_GENRES])]
      .filter((g) => !used.has(g.toLowerCase()) && (!typed || g.toLowerCase().includes(typed))).slice(0, 48);
  }, [albums, value, text]);
  // a pasted "rap, trap; drill" is several genres
  const add = (raw: string) => { onChange(raw.split(/[;,]+/).reduce((list, part) => withGenre(list, part), value)); setText(""); };
  return <div className="genre-picker">
    <div className="gp-chosen">
      {value.map((genre) => <span className="gp-chip on" key={genre}>{genre}
        <button aria-label={t("Remove") + " " + genre} onClick={() => onChange(value.filter((g) => g !== genre))}><Icon name="x" size={10} /></button></span>)}
      {!full && <input value={text} placeholder={value.length ? t("Add another…") : t("Type a genre, or pick below")} aria-label={t("Add a genre")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === ",") && text.trim()) { event.preventDefault(); add(text); }
          if (event.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }} />}
      <span className="gp-count mono">{value.length}/{MAX_GENRES}</span>
    </div>
    {!full && <div className="gp-suggest">{suggestions.map((genre) => <button className="gp-chip" key={genre} onClick={() => add(genre)}>{genre}</button>)}</div>}
  </div>;
}

/* What a person pasted into the "Download from SoundCloud" field: found, tidied, and — when it is not something Turntable
   can fetch — explained in words (what is wrong and what to paste instead), not with a bare "invalid link".
   No I/O in here, so it can be checked on its own (tests/downloads.test.mjs). Messages are English keys for t(). */

export type LinkCheck = { ok: true; url: string } | { ok: false; error: string };

/** the start of the "wrong site" message: the site's name follows it (the screen translates the start and keeps the name) */
export const SITE_PREFIX = "Turntable downloads only from SoundCloud. This link is from ";
const bad = (error: string): LinkCheck => ({ ok: false, error });
const SOUNDCLOUD_HOSTS = ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"];
/** first path parts of soundcloud.com that are pages of the site, not music */
const SITE_PAGES = new Set(["discover", "stream", "search", "you", "upload", "charts", "feed", "notifications", "messages", "settings", "pages",
  "terms-of-use", "jobs", "tags", "mobile", "people", "popular", "imprint", "creators", "music-licensing", "legal", "community-guidelines", "login", "signin", "signup"]);
/** pages of a profile that list people or comments, not tracks */
const PROFILE_PEOPLE = new Set(["followers", "following", "comments", "followings"]);

/** The first thing in the text that looks like an address: people paste "listen to this https://…" or a link in brackets. */
function firstAddress(text: string): string | null {
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[<("'«“\[]+/, "").replace(/[>)"'»”\].,;!]+$/, "");
    if (/^https?:\/\//i.test(token) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(token) && token.includes(".")) return token;
  }
  return null;
}

export function readLink(text: string): LinkCheck {
  const typed = text.trim();
  if (!typed) return bad("Paste a link first.");
  const address = firstAddress(typed);
  if (!address) return bad("That doesn't look like a link. Copy the address of a track, album or playlist from SoundCloud, e.g. https://soundcloud.com/artist/track");
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(address) ? address : "https://" + address); }
  catch { return bad("That link is broken — it can't be read. Copy it again from the SoundCloud page."); }
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)soundcloud\.com$/.test(host)) {
    return bad(/(^|\.)(sndcdn\.com|soundcloud\.app\.goo\.gl)$/.test(host) || host === "snd.sc"
      ? "That is a short or file link that Turntable can't follow. Open the track on soundcloud.com and copy its address from the browser."
      : SITE_PREFIX + host.replace(/^www\./, "") + ".");
  }
  if (!SOUNDCLOUD_HOSTS.includes(host)) return bad("That is a SoundCloud service page, not a track. Copy the address of a track, album or playlist.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) return bad("That is the SoundCloud home page. Open a track, album or playlist and copy its address.");
  if (host === "on.soundcloud.com") {
    // a share link has one short code and nothing else
    if (parts.length !== 1) return bad("That share link is incomplete. Copy it again from SoundCloud's Share button.");
  } else {
    if (SITE_PAGES.has(parts[0].toLowerCase())) return bad("That is a page of SoundCloud with no music of its own. Open a track, album or playlist and copy its address.");
    if (parts[1] && PROFILE_PEOPLE.has(parts[1].toLowerCase())) return bad("That page lists people, not music. Copy the address of a track, album or playlist.");
  }
  url.protocol = "https:";
  url.hash = ""; url.username = ""; url.password = ""; url.port = "";      // nothing but the address of the page goes on
  return { ok: true, url: url.toString() };
}

/** yt-dlp's and the system's wording, said plainly. Anything not recognised is returned as it came. */
export function explain(message: string): string {
  const m = message.toLowerCase();
  if (/unsupported url/.test(m)) return "Turntable can't read this SoundCloud page. Copy the address of a track, album or playlist.";
  if (/http error 404|not found|does not exist|no such (track|playlist|user)|has been (removed|deleted)|was removed/.test(m)) return "SoundCloud can't find anything at this link. It may have been deleted, or the address has a typo.";
  if (/private|secret.?token|sign in|log in|login required|members only/.test(m)) return "This is private on SoundCloud. Open it with the private link the author gave you (it ends in ?secret_token=…) and paste that.";
  if (/geo|not available in your country|your location|blocked in/.test(m)) return "SoundCloud doesn't let this be played in your country.";
  if (/go\+|premium|snipped/.test(m)) return "This is a SoundCloud Go+ track: SoundCloud gives only a 30-second preview of it, so Turntable can't download it.";
  if (/urlopen error|getaddrinfo|name or service not known|network is unreachable|connection (reset|refused|aborted)|timed out|timeout|temporary failure|no route to host|ssl/.test(m)) return "Can't reach SoundCloud. Check your internet connection and try again.";
  if (/took too long/.test(m)) return "SoundCloud took too long to answer. Try again in a minute.";
  return message;
}

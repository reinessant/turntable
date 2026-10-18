/* SoundCloud: sign-in (OAuth 2.1 + PKCE over a loopback redirect), the user's likes and playlists as
   records in the crate, and track audio fetched on demand through the official API.
   Audio is only ever held in memory — nothing from SoundCloud is written to disk.
   Keys come from .env.local (VITE_SC_CLIENT_ID / VITE_SC_CLIENT_SECRET), registered at soundcloud.com/you/apps
   with the redirect URI below. */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { load } from "@tauri-apps/plugin-store";
import { prepareCover } from "./color";
import type { Album, Track } from "./types";

const CLIENT_ID = import.meta.env.VITE_SC_CLIENT_ID as string | undefined;
const CLIENT_SECRET = import.meta.env.VITE_SC_CLIENT_SECRET as string | undefined;
const PORT = 53682;
export const SC_REDIRECT = `http://127.0.0.1:${PORT}/soundcloud/callback`;
const AUTH = "https://secure.soundcloud.com";
const API = "https://api.soundcloud.com";
const STORE = "soundcloud.json";

export interface ScUser { id: number; username: string; avatar: string; url: string }
interface Session { access: string; refresh: string; expiresAt: number; user: ScUser }
interface ScTrack {
  id: number; title: string; duration: number; streamable?: boolean; access?: string;
  artwork_url?: string | null; permalink_url: string; user: { username: string; avatar_url?: string };
  release_year?: number | null; created_at?: string;
}
interface ScPlaylist {
  id: number; title: string; artwork_url?: string | null; permalink_url: string; release_year?: number | null; created_at?: string;
  user: { username: string }; tracks?: ScTrack[];
}

export const scConfigured = () => !!CLIENT_ID && !!CLIENT_SECRET;

/* ---------------------------------------------------------------- session */
let session: Session | null = null;
async function store() { return load(STORE, { autoSave: false }); }
async function saveSession(next: Session | null): Promise<void> {
  session = next;
  const s = await store();
  // records the user added stay in the library when signing out; they play again after the next sign-in
  if (next) await s.set("session", next); else await s.delete("session");
  await s.save();
}
export async function scSession(): Promise<ScUser | null> {
  if (!isTauri()) return null;
  session ??= (await (await store()).get<Session>("session")) ?? null;
  return session?.user ?? null;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));

async function token(params: Record<string, string>): Promise<Session> {
  const response = await tauriFetch(AUTH + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json; charset=utf-8" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, ...params }).toString()
  });
  if (!response.ok) throw new Error("SoundCloud sign-in failed (" + response.status + ")");
  const body = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
  return { access: body.access_token, refresh: body.refresh_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000, user: session?.user ?? { id: 0, username: "", avatar: "", url: "" } };
}

/** Opens SoundCloud's sign-in page in the browser and waits for the user to come back. */
export async function scConnect(): Promise<ScUser> {
  if (!scConfigured()) throw new Error("SoundCloud keys are not set (VITE_SC_CLIENT_ID / VITE_SC_CLIENT_SECRET in .env.local)");
  const verifier = random(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = random(16);
  const url = AUTH + "/authorize?" + new URLSearchParams({
    client_id: CLIENT_ID!, redirect_uri: SC_REDIRECT, response_type: "code",
    code_challenge: challenge, code_challenge_method: "S256", state
  });
  const query = new URLSearchParams(await invoke<string>("sc_login", { authorizeUrl: url, port: PORT }));
  if (query.get("error")) throw new Error("SoundCloud: " + (query.get("error_description") || query.get("error")));
  if (query.get("state") !== state || !query.get("code")) throw new Error("SoundCloud sign-in was interrupted");
  session = await token({ grant_type: "authorization_code", redirect_uri: SC_REDIRECT, code_verifier: verifier, code: query.get("code")! });
  const me = await api<{ id: number; username: string; avatar_url: string; permalink_url: string }>("/me");
  session.user = { id: me.id, username: me.username, avatar: me.avatar_url, url: me.permalink_url };
  await saveSession(session);
  return session.user;
}

export async function scDisconnect(): Promise<void> { await saveSession(null); }

async function accessToken(): Promise<string> {
  if (!session) await scSession();
  if (!session) throw new Error("Not connected to SoundCloud");
  if (Date.now() > session.expiresAt) {
    const user = session.user;
    try { session = { ...(await token({ grant_type: "refresh_token", refresh_token: session.refresh })), user }; }
    catch (error) { await saveSession(null); throw new Error("SoundCloud session expired — connect again"); }
    await saveSession(session);
  }
  return session.access;
}

async function api<T>(path: string, retried = false): Promise<T> {
  const url = path.startsWith("http") ? path : API + path;
  const response = await tauriFetch(url, { headers: { Authorization: "OAuth " + await accessToken(), Accept: "application/json; charset=utf-8" } });
  // a revoked token: refresh once and ask again — a second 401 is a real "no", not a reason to loop forever
  if (response.status === 401 && session && !retried) { session.expiresAt = 0; return api(path, true); }
  if (!response.ok) throw new Error("SoundCloud request failed (" + response.status + ")");
  return response.json() as Promise<T>;
}
/** follows `next_href` pages up to `max` items */
async function collect<T>(path: string, max: number): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next && out.length < max) {
    const page: { collection: T[]; next_href?: string | null } = await api(next);
    out.push(...page.collection);
    next = page.next_href ?? null;
  }
  return out.slice(0, max);
}

/* ---------------------------------------------------------------- library → records */
const playable = (t: ScTrack) => t.streamable !== false && (t.access ?? "playable") === "playable";
const bigArt = (url?: string | null) => url ? url.replace("-large.", "-t500x500.") : "";
const year = (o: { release_year?: number | null; created_at?: string }) => o.release_year || (o.created_at ? new Date(o.created_at).getFullYear() : undefined);

async function coverFor(url: string): Promise<{ path: string; colors: Album["colors"] }> {
  const fallback = { path: "", colors: { lMean: .2, lMedian: .2, cMean: .02, cP90: .04, hDominant: 20, hSpread: 0, key: "dark" as const, temperature: "neutral" as const } };
  if (!url) return fallback;
  try {
    const response = await tauriFetch(url);
    if (!response.ok) return fallback;
    const blob = await response.blob();
    const prepared = await prepareCover(blob);
    URL.revokeObjectURL(prepared.url);
    // keep SoundCloud's own 500 px artwork as a data: URL — the crate, the label art and the backdrop read it like a local file
    const data = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
    return { path: data, colors: prepared.colors };
  } catch { return fallback; }
}

function toTracks(albumId: string, list: ScTrack[], artist: string): Track[] {
  return list.filter(playable).map((t, index) => ({
    id: albumId + "-" + t.id, albumId, index, duration: t.duration / 1000,
    // on a single artist's record the title stands alone; on a mix it carries who made it
    title: t.user.username === artist ? t.title : `${t.user.username} — ${t.title}`,
    filePath: "sc:" + t.id
  }));
}

/* ---------------------------------------------------------------- browsing (the "Add from SoundCloud" sheet) */
export interface ScPlaylistRow { id: number; title: string; owner: string; count: number; artwork: string; url: string; kind: string }
export interface ScTrackRow { id: number; title: string; artist: string; duration: number; artwork: string; playable: boolean; raw: ScTrack }
const smallArt = (url?: string | null) => url ? url.replace("-large.", "-t200x200.") : "";
const trackRow = (t: ScTrack): ScTrackRow => ({ id: t.id, title: t.title, artist: t.user.username, duration: t.duration / 1000, artwork: smallArt(t.artwork_url || t.user.avatar_url), playable: playable(t), raw: t });

// dev in a plain browser (no Tauri, no API): sample rows so the sheet can be laid out and tested
const devMock = import.meta.env.DEV && !isTauri();
const mockTrack = (id: number, title: string, artist: string, duration: number, playableNow = true): ScTrack =>
  ({ id, title, duration: duration * 1000, access: playableNow ? "playable" : "blocked", permalink_url: "https://soundcloud.com/x/" + id, user: { username: artist } });
const MOCK_LIKES = [mockTrack(1, "promise", "slayr", 155), mockTrack(2, "Whats Happening", "osamason", 131), mockTrack(3, "yes, you may", "lucy bedroque", 142),
  mockTrack(4, "Money Hungry", "Prettifun", 118), mockTrack(5, "24/7", "slayr", 126, false), mockTrack(6, "On my way!", "yuke", 133), mockTrack(7, "Love Blur", "slayr", 166)];

export async function scLikes(): Promise<ScTrackRow[]> {
  if (devMock) return MOCK_LIKES.map(trackRow);
  return (await collect<ScTrack>("/me/likes/tracks?limit=200&linked_partitioning=true", 600)).map(trackRow);
}
export async function scPlaylists(): Promise<ScPlaylistRow[]> {
  if (devMock) return [{ id: 11, title: "Avant Nova", owner: "slayr", count: 6, artwork: "", url: "", kind: "album" }, { id: 12, title: "late night rage", owner: "you", count: 23, artwork: "", url: "", kind: "playlist" }];
  const own = await collect<ScPlaylist & { track_count?: number; set_type?: string }>("/me/playlists?show_tracks=false&limit=50&linked_partitioning=true", 100);
  const liked = await collect<ScPlaylist & { track_count?: number; set_type?: string }>("/me/likes/playlists?limit=50&linked_partitioning=true", 100).catch(() => []);
  return [...own, ...liked].map((p) => ({ id: p.id, title: p.title, owner: p.user.username, count: p.track_count ?? p.tracks?.length ?? 0,
    artwork: smallArt(p.artwork_url), url: p.permalink_url, kind: p.set_type || "playlist" }));
}
/** A pasted soundcloud.com link: a single track, or a playlist / album with its tracks. */
export async function scResolve(link: string): Promise<{ kind: "track"; track: ScTrackRow } | { kind: "set"; playlist: ScPlaylistRow; tracks: ScTrackRow[] }> {
  const clean = link.trim();
  if (!/^https:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(clean)) throw new Error("That isn't a soundcloud.com link");
  if (devMock) return { kind: "set", playlist: { id: 11, title: "Avant Nova", owner: "slayr", count: 6, artwork: "", url: clean, kind: "album" }, tracks: MOCK_LIKES.slice(0, 6).map(trackRow) };
  const item = await api<(ScTrack | ScPlaylist) & { kind: string; track_count?: number; set_type?: string }>("/resolve?url=" + encodeURIComponent(clean));
  if (item.kind === "track") return { kind: "track", track: trackRow(item as ScTrack) };
  if (item.kind === "playlist") {
    const p = item as ScPlaylist & { track_count?: number; set_type?: string };
    return { kind: "set", playlist: { id: p.id, title: p.title, owner: p.user.username, count: p.track_count ?? p.tracks?.length ?? 0, artwork: smallArt(p.artwork_url || p.tracks?.[0]?.artwork_url), url: p.permalink_url, kind: p.set_type || "playlist" },
      tracks: (p.tracks ?? []).map(trackRow) };
  }
  throw new Error("Only tracks, albums and playlists can go into the crate");
}

/* ---------------------------------------------------------------- records in the crate (persisted) */
export async function scRecords(): Promise<Album[]> {
  if (!isTauri()) return [];
  return (await (await store()).get<Album[]>("records")) ?? [];
}
async function saveRecords(records: Album[]): Promise<void> { const s = await store(); await s.set("records", records); await s.save(); }

/** Builds a record from tracks and puts it in the library. */
async function addRecord(id: string, title: string, artist: string, tracks: ScTrack[], artwork: string, url: string, when?: number): Promise<Album> {
  const list = toTracks(id, tracks, artist);
  if (!list.length) throw new Error("None of these tracks can be played outside SoundCloud");
  const cover = await coverFor(bigArt(artwork) || bigArt(tracks.find((t) => t.artwork_url)?.artwork_url));
  const album: Album = { id, title, artist, year: when, coverPath: cover.path, coverThumbPath: cover.path, colors: cover.colors,
    tracks: list, addedAt: Date.now(), liked: false, source: { kind: "soundcloud", url } };
  const records = (await scRecords()).filter((r) => r.id !== id);
  await saveRecords([...records, album]);
  return album;
}
export async function scAddPlaylist(playlistId: number): Promise<Album> {
  const p = await api<ScPlaylist>(`/playlists/${playlistId}?show_tracks=true`);
  return addRecord("sc-pl-" + p.id, p.title, p.user.username, p.tracks ?? [], p.artwork_url || "", p.permalink_url, year(p));
}
export async function scAddTracks(title: string, rows: ScTrackRow[]): Promise<Album> {
  const user = await scSession();
  const artists = new Set(rows.map((r) => r.artist));
  const artist = artists.size === 1 ? rows[0].artist : user?.username || "SoundCloud";
  const id = "sc-mix-" + (rows.length === 1 ? rows[0].id : crypto.randomUUID());
  const url = rows.length === 1 ? rows[0].raw.permalink_url : (user?.url ? user.url + "/likes" : "https://soundcloud.com/");
  return addRecord(id, title.trim() || (rows.length === 1 ? rows[0].title : "Likes"), artist, rows.map((r) => r.raw), rows[0]?.raw.artwork_url || "", url, year(rows[0]?.raw ?? {}));
}
export async function scRemoveRecord(id: string): Promise<void> { await saveRecords((await scRecords()).filter((r) => r.id !== id)); }

/** Opens a SoundCloud page (album attribution) in the default browser. */
export async function openOnSoundCloud(url: string): Promise<void> { await invoke("open_soundcloud", { url }); }

/* ---------------------------------------------------------------- audio */
export const isScPath = (path: string) => path.startsWith("sc:");
interface Streams { http_mp3_128_url?: string; hls_aac_160_url?: string; hls_aac_96_url?: string; hls_mp3_128_url?: string }
/** The track's audio, in memory only, as bytes decodeAudioData can read.
    Since the end of 2025 the API serves AAC over HLS (hls_aac_160_url); a progressive MP3 is used if still offered. */
export async function scTrackBytes(path: string): Promise<ArrayBuffer> {
  const id = path.slice(3);
  const streams = await api<Streams>(`/tracks/${encodeURIComponent("soundcloud:tracks:" + id)}/streams`).catch(() => api<Streams>(`/tracks/${id}/streams`));
  if (streams.http_mp3_128_url) return (await fetchBytes(streams.http_mp3_128_url)).bytes;
  const hls = streams.hls_aac_160_url || streams.hls_aac_96_url || streams.hls_mp3_128_url;
  if (!hls) throw new Error("This track can't be played outside SoundCloud");
  return hlsToBytes(hls);
}

/** GET with the OAuth header on SoundCloud's own API hosts only — CDN links are pre-signed and must go bare. */
async function fetchBytes(url: string): Promise<{ bytes: ArrayBuffer; url: string }> {
  const own = /^https:\/\/(api|api-v2|secure)\.soundcloud\.com\//.test(url);
  const response = await tauriFetch(url, own ? { headers: { Authorization: "OAuth " + await accessToken() } } : {});
  if (!response.ok) throw new Error("SoundCloud stream failed (" + response.status + ")");
  return { bytes: await response.arrayBuffer(), url: response.url || url };
}
const text = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);
const resolveUrl = (base: string, ref: string) => new URL(ref, base).toString();

/* ---------------------------------------------------------------- HLS → one decodable file */
async function hlsToBytes(entry: string): Promise<ArrayBuffer> {
  let { bytes, url } = await fetchBytes(entry);
  let playlist = text(bytes);
  // a master playlist: take the first (preferred) variant
  if (playlist.includes("#EXT-X-STREAM-INF")) {
    const variant = playlist.split(/\r?\n/).find((line, i, all) => i > 0 && all[i - 1].startsWith("#EXT-X-STREAM-INF") && line && !line.startsWith("#"));
    if (!variant) throw new Error("SoundCloud stream has no playable variant");
    ({ bytes, url } = await fetchBytes(resolveUrl(url, variant)));
    playlist = text(bytes);
  }
  const lines = playlist.split(/\r?\n/);
  const key = lines.find((l) => l.startsWith("#EXT-X-KEY"));
  const method = key?.match(/METHOD=([^,]+)/)?.[1];
  if (method && method !== "NONE" && method !== "AES-128") throw new Error("This track is protected and can only be played on SoundCloud");
  const mapUri = lines.find((l) => l.startsWith("#EXT-X-MAP"))?.match(/URI="([^"]+)"/)?.[1];
  const segments = lines.filter((l) => l && !l.startsWith("#")).map((l) => resolveUrl(url, l));
  if (!segments.length) throw new Error("SoundCloud stream is empty");

  let decrypt: ((data: ArrayBuffer, index: number) => Promise<ArrayBuffer>) | null = null;
  if (method === "AES-128") {
    const keyUri = key!.match(/URI="([^"]+)"/)?.[1];
    const ivHex = key!.match(/IV=0x([0-9a-f]+)/i)?.[1];
    const raw = (await fetchBytes(resolveUrl(url, keyUri!))).bytes;
    const cryptoKey = await crypto.subtle.importKey("raw", raw, "AES-CBC", false, ["decrypt"]);
    const sequence = Number(lines.find((l) => l.startsWith("#EXT-X-MEDIA-SEQUENCE"))?.split(":")[1] ?? 0);
    decrypt = (data, index) => {
      const iv = new Uint8Array(16);
      if (ivHex) ivHex.padStart(32, "0").match(/../g)!.forEach((h, i) => (iv[i] = parseInt(h, 16)));
      else new DataView(iv.buffer).setUint32(12, sequence + index);
      return crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, data);
    };
  }
  // segments in parallel, a few at a time, kept in order
  const parts: ArrayBuffer[] = new Array(segments.length);
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < segments.length) {
      const i = next++;
      const data = (await fetchBytes(segments[i])).bytes;
      parts[i] = decrypt ? await decrypt(data, i) : data;
    }
  }));
  const init = mapUri ? (await fetchBytes(resolveUrl(url, mapUri))).bytes : null;
  const first = new Uint8Array(parts[0]);
  if (first[0] === 0x47) return tsToAdts(parts);                                  // MPEG-TS → ADTS
  if (init) return fmp4ToAdts(init, parts) ?? concat([init, ...parts]);        // fragmented MP4 → ADTS (or as is)
  return concat(parts);                                                         // ADTS / MP3 frames concatenate cleanly
}

function concat(parts: ArrayBuffer[]): ArrayBuffer {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0; for (const p of parts) { out.set(new Uint8Array(p), at); at += p.byteLength; }
  return out.buffer;
}

/** MPEG-TS: pull the audio PES payloads (already ADTS for AAC, or MP3 frames) out of the 188-byte packets. */
function tsToAdts(parts: ArrayBuffer[]): ArrayBuffer {
  const data = new Uint8Array(concat(parts));
  let audioPid = -1, pmtPid = -1;
  const chunks: Uint8Array[] = [];
  for (let at = 0; at + 188 <= data.length; at += 188) {
    if (data[at] !== 0x47) continue;
    const start = (data[at + 1] & 0x40) !== 0, pid = ((data[at + 1] & 0x1f) << 8) | data[at + 2];
    const afc = (data[at + 3] >> 4) & 3;
    let p = at + 4;
    if (afc === 2) continue;
    if (afc === 3) p += 1 + data[p];
    if (pid === 0 && start) { p += 1 + data[p]; pmtPid = ((data[p + 10] & 0x1f) << 8) | data[p + 11]; continue; }
    if (pid === pmtPid && start) {
      p += 1 + data[p];
      const sectionEnd = p + 3 + (((data[p + 1] & 0x0f) << 8) | data[p + 2]) - 4;
      let q = p + 12 + (((data[p + 10] & 0x0f) << 8) | data[p + 11]);
      while (q < sectionEnd) {
        const type = data[q], esPid = ((data[q + 1] & 0x1f) << 8) | data[q + 2];
        if ([0x0f, 0x03, 0x04].includes(type) && audioPid < 0) audioPid = esPid;
        q += 5 + (((data[q + 3] & 0x0f) << 8) | data[q + 4]);
      }
      continue;
    }
    if (pid !== audioPid) continue;
    if (start) p += 9 + data[p + 8];                                              // skip the PES header
    chunks.push(data.subarray(p, at + 188));
  }
  return concat(chunks.map((c) => c.slice().buffer));
}

/** Fragmented MP4 (init + moof/mdat): wrap each AAC sample in an ADTS header. Null if it isn't AAC. */
function fmp4ToAdts(init: ArrayBuffer, parts: ArrayBuffer[]): ArrayBuffer | null {
  const box = (buf: Uint8Array, from: number, to: number, path: string[]): { at: number; end: number } | null => {
    for (let at = from; at + 8 <= to;) {
      const size = new DataView(buf.buffer, buf.byteOffset + at).getUint32(0), type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
      if (size < 8) return null;
      if (type === path[0]) {
        if (path.length === 1) return { at, end: at + size };
        // stsd and the sample entry carry a header before their children
        const skip = type === "stsd" ? 16 : type === "mp4a" ? 36 : 8;
        return box(buf, at + skip, at + size, path.slice(1));
      }
      at += size;
    }
    return null;
  };
  const head = new Uint8Array(init);
  const esds = box(head, 0, head.length, ["moov", "trak", "mdia", "minf", "stbl", "stsd", "mp4a", "esds"]);
  if (!esds) return null;
  // AudioSpecificConfig: find the DecoderSpecificInfo tag (0x05)
  let p = esds.at + 12, asc: Uint8Array | null = null;
  while (p < esds.end) {
    const tag = head[p++]; let len = 0, b;
    do { b = head[p++]; len = (len << 7) | (b & 0x7f); } while (b & 0x80);
    if (tag === 0x03) { p += 3; continue; }
    if (tag === 0x04) { p += 13; continue; }
    if (tag === 0x05) { asc = head.subarray(p, p + len); break; }
    p += len;
  }
  if (!asc) return null;
  const profile = (asc[0] >> 3) - 1, freq = ((asc[0] & 7) << 1) | (asc[1] >> 7), channels = (asc[1] >> 3) & 15;
  const frames: Uint8Array[] = [];
  for (const part of parts) {
    const buf = new Uint8Array(part);
    for (let at = 0; at + 8 <= buf.length;) {
      const view = new DataView(buf.buffer, buf.byteOffset + at), size = view.getUint32(0), type = String.fromCharCode(...buf.subarray(at + 4, at + 8));
      if (size < 8) break;
      if (type === "moof") {
        const trun = box(buf, at + 8, at + size, ["traf", "trun"]);
        const tfhd = box(buf, at + 8, at + size, ["traf", "tfhd"]);
        if (trun) {
          const t = new DataView(buf.buffer, buf.byteOffset + trun.at);
          const flags = t.getUint32(8) & 0xffffff, count = t.getUint32(12);
          let q = 16; const dataOffset = flags & 1 ? t.getInt32(q) : 8 + size; if (flags & 1) q += 4; if (flags & 4) q += 4;
          let defaultSize = 0;
          if (tfhd) { const h = new DataView(buf.buffer, buf.byteOffset + tfhd.at); const hf = h.getUint32(8) & 0xffffff; let r = 16; if (hf & 1) r += 8; if (hf & 2) r += 4; if (hf & 8) r += 4; if (hf & 16) defaultSize = h.getUint32(r); }
          let sample = at + dataOffset;
          for (let i = 0; i < count; i++) {
            if (flags & 0x100) q += 4;
            const len = flags & 0x200 ? t.getUint32(q) : defaultSize; if (flags & 0x200) q += 4;
            if (flags & 0x400) q += 4; if (flags & 0x800) q += 4;
            const full = len + 7, header = new Uint8Array(7);
            header[0] = 0xff; header[1] = 0xf1; header[2] = (profile << 6) | (freq << 2) | (channels >> 2);
            header[3] = ((channels & 3) << 6) | (full >> 11); header[4] = (full >> 3) & 0xff; header[5] = ((full & 7) << 5) | 0x1f; header[6] = 0xfc;
            frames.push(header, buf.subarray(sample, sample + len)); sample += len;
          }
        }
      }
      at += size;
    }
  }
  return frames.length ? concat(frames.map((f) => f.slice().buffer)) : null;
}

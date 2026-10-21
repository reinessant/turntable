//! Our own audio decoder (Symphonia), for the files the webview cannot handle: no AAC/MP3 codec on some
//! Windows installs, m4a/ALAC the page decodes to silence, tags the JS parser chokes on. The page asks for it
//! only after its own decoder failed (or when the setting says to always use this one).
use std::{fs::File, path::{Path, PathBuf}};
use serde::Serialize;
use symphonia::core::{
    audio::SampleBuffer, codecs::{DecoderOptions, CODEC_TYPE_NULL}, errors::Error as SymError,
    formats::FormatOptions, io::MediaSourceStream, meta::{MetadataOptions, MetadataRevision, StandardTagKey},
    probe::{Hint, ProbeResult},
};

const EXTENSIONS: [&str; 6] = ["mp3", "flac", "m4a", "wav", "ogg", "opus"];

fn checked(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !EXTENSIONS.contains(&ext.as_str()) { return Err(format!("Unsupported audio format: {ext}")); }
    if !path.is_file() { return Err(format!("{} is not a file", path.display())); }
    Ok(path)
}

fn open(path: &Path) -> Result<ProbeResult, String> {
    let file = File::open(path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) { hint.with_extension(ext); }
    symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("Unrecognised audio file: {e}"))
}

/// The whole file as interleaved 16-bit samples.
pub struct Pcm { pub rate: u32, pub channels: u16, pub samples: Vec<i16> }

pub fn decode(path: &str) -> Result<Pcm, String> {
    let path = checked(path)?;
    let mut probed = open(&path)?;
    let track = probed.format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("The file has no audio track")?;
    let id = track.id;
    let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("No decoder for this file: {e}"))?;
    let (mut rate, mut channels) = (0u32, 0u16);
    let mut samples: Vec<i16> = Vec::new();
    let mut scratch: Option<SampleBuffer<i16>> = None;
    loop {
        let packet = match probed.format.next_packet() {
            Ok(packet) => packet,
            // the end of the stream is reported as an I/O error; a reset means the stream changed under us — stop either way
            Err(SymError::IoError(_)) | Err(SymError::ResetRequired) => break,
            Err(e) => { if samples.is_empty() { return Err(e.to_string()); } break; }
        };
        if packet.track_id() != id { continue; }
        match decoder.decode(&packet) {
            Ok(buffer) => {
                let spec = *buffer.spec();
                rate = spec.rate; channels = spec.channels.count() as u16;
                let needed = buffer.capacity() * channels as usize;
                if scratch.as_ref().map_or(true, |s| s.capacity() < needed) { scratch = Some(SampleBuffer::<i16>::new(buffer.capacity() as u64, spec)); }
                let out = scratch.as_mut().unwrap();
                out.copy_interleaved_ref(buffer);
                samples.extend_from_slice(out.samples());
            }
            // one damaged frame is a click, not the end of the song
            Err(SymError::DecodeError(_)) | Err(SymError::IoError(_)) => continue,
            Err(e) => { if samples.is_empty() { return Err(e.to_string()); } break; }
        }
    }
    if samples.is_empty() || rate == 0 || channels == 0 { return Err("The file decoded to nothing".into()); }
    Ok(Pcm { rate, channels, samples })
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub duration: f64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<u16>,
    pub track_number: Option<u32>,
}

fn read_tags(info: &mut Info, revision: &MetadataRevision) {
    let mut album_artist = None;
    for tag in revision.tags() {
        let value = tag.value.to_string();
        let value = value.trim();
        if value.is_empty() { continue; }
        match tag.std_key {
            Some(StandardTagKey::TrackTitle) => { info.title.get_or_insert_with(|| value.to_string()); }
            Some(StandardTagKey::Artist) => { info.artist.get_or_insert_with(|| value.to_string()); }
            Some(StandardTagKey::AlbumArtist) => { album_artist.get_or_insert_with(|| value.to_string()); }
            Some(StandardTagKey::Album) => { info.album.get_or_insert_with(|| value.to_string()); }
            Some(StandardTagKey::Date) | Some(StandardTagKey::ReleaseDate) | Some(StandardTagKey::OriginalDate) => {
                if info.year.is_none() { info.year = value.get(..4).and_then(|y| y.parse().ok()); }
            }
            Some(StandardTagKey::TrackNumber) => {
                if info.track_number.is_none() { info.track_number = value.split('/').next().and_then(|n| n.trim().parse().ok()); }
            }
            _ => {}
        }
    }
    // like the JS reader: the album artist wins over the track artist
    if let Some(artist) = album_artist { info.artist = Some(artist); }
}

/// Length and tags, for the import screen when its own parser gave up on a file.
pub fn probe(path: &str) -> Result<Info, String> {
    let checked = checked(path)?;
    let mut probed = open(&checked)?;
    let mut info = Info::default();
    if let Some(metadata) = probed.metadata.get() { if let Some(revision) = metadata.current() { read_tags(&mut info, revision); } }
    if let Some(revision) = probed.format.metadata().current() { read_tags(&mut info, revision); }
    let params = probed.format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).map(|t| t.codec_params.clone());
    if let Some(params) = params {
        if let (Some(frames), Some(rate)) = (params.n_frames, params.sample_rate) { info.duration = frames as f64 / rate as f64; }
    }
    // no length in the headers (an MP3 without a Xing frame): count the decoded samples
    if info.duration <= 0.0 {
        let pcm = decode(path)?;
        info.duration = pcm.samples.len() as f64 / pcm.channels as f64 / pcm.rate as f64;
    }
    Ok(info)
}

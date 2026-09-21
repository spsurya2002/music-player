"""Identify a song from an audio file and find it on YouTube.

Tiers, cheapest first - each one falls through to the next:
  1. Shazam fingerprint      - exact master recording
  2. AcoustID fingerprint    - second free catalog, needs ACOUSTID_API_KEY
  3. Embedded caption tags   - reels usually name the song in their caption
  4. Whisper lyrics          - survives covers, where fingerprints cannot
"""

import asyncio
import os
import re
import subprocess
from functools import lru_cache

from mutagen import File as MutagenFile
from shazamio import Shazam
from shazamio_core import SignatureError
from yt_dlp import YoutubeDL

AUDIO = "song1.mp3"
WHISPER_MODEL = "medium"  # "small" is ~30s faster but too unreliable on sung Indic
LYRIC_CONFIDENCE = -1.0  # avg_logprob below this is noise, not words

# Words reels sprinkle into tag lists that say nothing about the song itself.
GENERIC_TAGS = {
    "cover", "music", "song", "songs", "instagram", "insta", "reel", "reels",
    "explore", "explorepage", "fyp", "foryou", "viral", "trending", "trend",
    "singing", "singer", "audio", "lyrics", "shorts", "love", "sad",
}


# --- tier 1: shazam ----------------------------------------------------------

def youtube_from_shazam(track):
    """Shazam sometimes ships a VIDEO section with a direct youtube url."""
    for section in track.get("sections", []):
        if section.get("type") == "VIDEO":
            return section.get("youtubeurl")
    return None


async def query_from_shazam(path, log=print):
    try:
        out = await Shazam().recognize(path)
    except SignatureError:
        # Fires when the file is still being written, or isn't really audio.
        log(f"Could not read {path} as audio - is the conversion finished?")
        return None, None

    track = out.get("track")
    if not track:
        return None, None

    return f'{track["title"]} {track["subtitle"]}', track


# --- tier 2: acoustid --------------------------------------------------------

def query_from_acoustid(path):
    """Chromaprint against the MusicBrainz catalog. Exact recordings only."""
    api_key = os.environ.get("ACOUSTID_API_KEY")
    if not api_key:
        return None

    try:
        import acoustid
    except ImportError:
        return None

    # Drive libchromaprint off ffmpeg's PCM so we don't need the fpcalc binary.
    sample_rate = 44100
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path,
         "-f", "s16le", "-ac", "1", "-ar", str(sample_rate), "-"],
        capture_output=True,
    ).stdout
    if not pcm:
        return None

    duration = len(pcm) / (sample_rate * 2)
    fingerprint = acoustid.fingerprint(sample_rate, 1, iter([pcm]))

    try:
        results = acoustid.lookup(api_key, fingerprint, int(duration))
    except acoustid.AcoustidError:
        return None

    for result in results.get("results", []):
        for recording in result.get("recordings", []):
            title = recording.get("title")
            artists = recording.get("artists") or []
            if title:
                artist = artists[0]["name"] if artists else ""
                return f"{title} {artist}".strip()

    return None


# --- tier 3: caption metadata ------------------------------------------------

def query_from_metadata(path):
    """Reels keep the song name in their caption; Shazam can't fingerprint covers."""
    tags = MutagenFile(path)
    if tags is None or not tags.tags:
        return None

    caption = ""
    for key in ("TXXX:description", "TXXX:synopsis"):
        if key in tags.tags:
            caption = str(tags.tags[key])
            break

    # A "[ Cover , Music , Maine khud ko , Mustafa Zahid ]" list is the richest hint.
    bracketed = re.search(r"\[(.+?)\]", caption, re.DOTALL)
    if bracketed:
        parts = [p.strip() for p in bracketed.group(1).split(",")]
        keep = [p for p in parts if p and p.lower() not in GENERIC_TAGS]
        if keep:
            return " ".join(keep)

    # Otherwise fall back to the first real line of the caption.
    for line in caption.splitlines():
        line = line.strip(" .~-—•")
        if line and not line.startswith(("#", "@")):
            cleaned = re.sub(r"[^\w\s'&]", " ", line).strip()
            if cleaned:
                return cleaned

    return None


# --- tier 4: whisper lyrics --------------------------------------------------

def clean_lyrics(text):
    """Whisper renders instrumental passages as exotic-script noise - drop it."""
    # Keep the whole Devanagari block, not just letters - matras are combining marks.
    kept = [
        c for c in text
        if c.isspace() or "ऀ" <= c <= "ॿ" or (c.isascii() and c.isalpha())
    ]
    return " ".join("".join(kept).split())


@lru_cache(maxsize=1)
def load_whisper():
    """Loading the model costs seconds, so keep it around between files."""
    from faster_whisper import WhisperModel

    return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")


def query_from_lyrics(path, log=print):
    """A cover changes the fingerprint but not the words - so search the words."""
    try:
        model = load_whisper()
    except ImportError:
        return None

    log(f"Transcribing lyrics with Whisper ({WHISPER_MODEL})... this takes a few minutes.")
    segments, _ = model.transcribe(
        path,
        beam_size=5,
        temperature=0,                     # the default retries at random temperatures
        vad_filter=True,                   # skip instrumental stretches
        condition_on_previous_text=False,  # stops garbage snowballing
    )

    # Instrumental intros score terribly; only the confident segments are lyrics.
    scored = [(s.avg_logprob, clean_lyrics(s.text)) for s in segments]
    scored = [(score, text) for score, text in scored if len(text.split()) >= 3]
    if not scored:
        return None

    good = [text for score, text in scored if score > LYRIC_CONFIDENCE]
    if not good:
        # Nothing cleared the bar, so fall back to the single best segment.
        good = [max(scored)[1]]

    lyrics = " ".join(good)
    log(f"Lyrics heard: {lyrics[:110]}")

    # Skip the opening words - the hook sits past the intro and searches better.
    words = lyrics.split()
    return " ".join(words[8:24] if len(words) > 24 else words[:16])


# --- youtube -----------------------------------------------------------------

def youtube_from_search(query):
    """Resolve the top YouTube search hit for a query string."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True}
    with YoutubeDL(opts) as ydl:
        result = ydl.extract_info(f"ytsearch1:{query}", download=False)

    entries = result.get("entries") or []
    if not entries:
        return None
    return entries[0]["title"], entries[0]["url"]


async def identify(path, log=print):
    """Run the tiers over one file. Returns a dict the UI and the CLI both read."""
    result = {"source": None, "query": None, "track": None, "youtube": None, "title": None}

    query, track = await query_from_shazam(path, log)

    if track:
        log(f"[shazam] {query}")
        result.update(source="shazam", query=query, track=track)

        direct = youtube_from_shazam(track)
        if direct:
            result["youtube"] = direct
            log(f"YouTube: {direct}")
            return result
    else:
        for label, resolve in (
            ("acoustid", query_from_acoustid),
            ("caption", query_from_metadata),
            ("lyrics", query_from_lyrics),
        ):
            query = resolve(path, log) if label == "lyrics" else resolve(path)
            if query:
                log(f"[{label}] {query}")
                result.update(source=label, query=query)
                break
        else:
            log("No match found - fingerprints, tags and lyrics all came up empty.")
            return result

    hit = youtube_from_search(query)
    if not hit:
        log("YouTube: not found")
        return result

    title, url = hit
    result.update(youtube=url, title=title)
    log(f"YouTube: {url}\n         ({title})")
    return result


if __name__ == "__main__":
    asyncio.run(identify(AUDIO))

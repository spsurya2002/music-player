"""Work out which song a reel used, then find it on YouTube.

Two ways to name the song:
  1. Instagram's own music credit, when the post carries one (free, instant, exact).
  2. Audio fingerprinting via Shazam, for original-audio posts that carry no credit.

Then yt-dlp's search backend finds candidates and they get scored against the
song name, so an official upload beats a random re-upload or a sped-up edit.
"""

import asyncio
import contextlib
import difflib
import json
import os
import re
import unicodedata
import urllib.request

from yt_dlp import YoutubeDL

IG_APP_ID = "936619743392459"  # Instagram's public web client id
SHORTCODE_AB = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# Words that say nothing about *which* song a video is
NOISE = {
    "official", "video", "music", "audio", "lyric", "lyrics", "hd", "hq", "4k",
    "mv", "full", "song", "track", "remastered", "version", "original", "new",
    "feat", "ft", "featuring", "prod", "by", "the", "a", "an", "with",
    "visualizer", "explicit", "clean", "release", "premiere", "out", "now",
}

# Edits that are *not* the song you heard, even when the title matches well
EDIT_MARKERS = (
    "slowed", "reverb", "nightcore", "sped up", "spedup", "8d", "bass boosted",
    "mashup", "remix", "cover", "karaoke", "instrumental", "ringtone", "loop",
    "1 hour", "one hour", "10 hours", "compilation", "mix", "megamix", "dj ",
)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").lower()
    text = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", text)  # drop bracketed asides
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(text: str) -> set[str]:
    return {w for w in normalize(text).split() if w and w not in NOISE}


def similarity(a: str, b: str) -> float:
    """0-1 blend of token overlap and raw sequence closeness."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    # Containment, not Jaccard: a YouTube title legitimately carries extra words
    overlap = len(ta & tb) / len(ta)
    seq = difflib.SequenceMatcher(None, normalize(a), normalize(b)).ratio()
    return 0.7 * overlap + 0.3 * seq


# --------------------------------------------------------------------------
# naming the song
# --------------------------------------------------------------------------

def from_metadata(info: dict) -> dict | None:
    """Music credit Instagram attached to the post, if any."""
    track = (info.get("track") or "").strip()
    artist = (info.get("artist") or info.get("creator") or "").strip()
    if not track:
        return None
    return {
        "track": track,
        "artist": artist,
        "source": "Instagram music credit",
        "confidence": "high",
    }


@contextlib.contextmanager
def _muted_stderr():
    """Silence fd 2 — the decoder shells out to ffmpeg, which is chatty about
    every frame it skips. A Python-level redirect wouldn't catch a subprocess."""
    saved = os.dup(2)
    devnull = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(devnull, 2)
        yield
    finally:
        os.dup2(saved, 2)
        os.close(devnull)
        os.close(saved)


def shortcode_to_media_id(shortcode: str) -> int:
    n = 0
    for ch in shortcode:
        n = n * 64 + SHORTCODE_AB.index(ch)
    return n


def from_instagram_api(url: str, cookiejar=None) -> dict | None:
    """Read the music sticker straight off Instagram's own API.

    This is the only source that gives the *exact* song for a post where someone
    sings or speaks over a track, so it's tried first — but the endpoint 404s
    without a logged-in session, so it only works once cookies are set up.
    """
    if cookiejar is None:
        return None

    m = re.search(r"/(?:reel|reels|p|tv)/([\w-]+)", url)
    if not m:
        return None

    try:
        media_id = shortcode_to_media_id(m.group(1))
    except ValueError:
        return None

    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar))
    req = urllib.request.Request(
        f"https://i.instagram.com/api/v1/media/{media_id}/info/",
        headers={"X-IG-App-ID": IG_APP_ID, "User-Agent": UA, "Accept": "*/*"},
    )
    try:
        data = json.loads(opener.open(req, timeout=20).read())
    except Exception:
        return None

    items = data.get("items") or []
    if not items:
        return None
    clips = items[0].get("clips_metadata") or {}

    asset = (clips.get("music_info") or {}).get("music_asset_info") or {}
    if asset.get("title"):
        return {
            "track": asset["title"].strip(),
            "artist": (asset.get("display_artist") or "").strip(),
            "cover": asset.get("cover_artwork_uri"),
            "source": "Instagram music sticker",
            "confidence": "high",
        }

    # No licensed track attached, but the creator may have named their own audio
    orig = clips.get("original_sound_info") or {}
    title = (orig.get("original_audio_title") or "").strip()
    if title and title.lower() != "original audio":
        return {
            "track": title,
            "artist": (orig.get("ig_artist") or {}).get("username", "").strip(),
            "source": "Instagram original-audio name",
            "confidence": "medium",
        }
    return None


def from_caption(info: dict) -> dict | None:
    """Last resort: creators who sing a song often name it in the caption.

    Only a guess, and flagged as one — the caption is free text, so this finds a
    song title when one is written there and nothing when it isn't.
    """
    text = info.get("description") or ""
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"[#@][\w.]+", " ", text)  # hashtags and mentions say nothing
    # Drop emoji and pictographs, keep letters from any script
    text = "".join(c for c in text if unicodedata.category(c) not in ("So", "Sk", "Cs"))
    text = re.sub(r"\s+", " ", text).strip(" -–—|·.,")

    words = [w for w in text.split() if len(w) > 1]
    if len(words) < 2 or len(text) < 5:
        return None

    return {
        "track": " ".join(words[:10]),
        "artist": "",
        "source": "post caption (guess)",
        "confidence": "low",
    }


def from_fingerprint(path) -> dict | None:
    """Identify the audio by fingerprint. Returns None if nothing matches."""
    try:
        from shazamio import Shazam
    except ImportError:
        return None

    async def go():
        return await Shazam().recognize(str(path))

    try:
        with _muted_stderr():
            out = asyncio.run(go())
    except Exception:
        return None

    track = (out or {}).get("track")
    if not track:
        return None

    return {
        "track": (track.get("title") or "").strip(),
        "artist": (track.get("subtitle") or "").strip(),
        "shazam_url": track.get("url"),
        "cover": (track.get("images") or {}).get("coverart"),
        "source": "audio fingerprint",
        "confidence": "high",
    }


def identify(info: dict, path, url: str = "", cookiejar=None) -> dict | None:
    """Best source first, down to an outright guess.

    The music sticker and yt-dlp's metadata are exact when present. Fingerprinting
    covers posts that play a commercial recording. Nothing fingerprints a person
    singing the song themselves, which is where the caption guess earns its keep.
    """
    return (
        from_instagram_api(url, cookiejar)
        or from_metadata(info)
        or from_fingerprint(path)
        or from_caption(info)
    )


# --------------------------------------------------------------------------
# finding it on YouTube
# --------------------------------------------------------------------------

def youtube_search(query: str, limit: int = 8) -> list[dict]:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        "socket_timeout": 20,
    }
    try:
        with YoutubeDL(opts) as ydl:
            res = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    except Exception:
        return []

    out = []
    for e in (res or {}).get("entries") or []:
        if not e or not e.get("id"):
            continue
        out.append(
            {
                "id": e["id"],
                "title": e.get("title") or "",
                "channel": e.get("channel") or e.get("uploader") or "",
                "duration": e.get("duration"),
                "views": e.get("view_count"),
                "url": f"https://www.youtube.com/watch?v={e['id']}",
                "thumbnail": f"https://i.ytimg.com/vi/{e['id']}/mqdefault.jpg",
            }
        )
    return out


def score(candidate: dict, track: str, artist: str) -> float:
    """How likely this video is the song, as a normal upload of it.

    Uncapped on purpose so ties break sensibly; the caller clamps for display.
    The track name carries most of the weight — the same artist's *other*
    songs are the trap a pure artist-name match falls into.
    """
    title = candidate["title"]
    channel = candidate["channel"]

    tt, ti = tokens(track), tokens(title)
    if tt:
        track_match = len(tt & ti) / len(tt)
    else:  # track name was all filler words — fall back to raw closeness
        track_match = difflib.SequenceMatcher(None, normalize(track), normalize(title)).ratio()

    ta = tokens(artist)
    artist_match = len(ta & (ti | tokens(channel))) / len(ta) if ta else 0.0

    name_score = 70 * track_match + 30 * artist_match

    # Wrong song by the right artist — the single most common false positive.
    # Safe to be strict here because the song name is known; free text goes
    # through search_query() instead, which doesn't score on word overlap.
    if tt and track_match < 0.5:
        name_score -= 25

    return max(0.0, name_score + adjustments(candidate, artist))


def adjustments(candidate: dict, artist: str = "") -> float:
    """Upload-quality signals, independent of how well the *name* matched.

    Shared by both scoring modes: which upload of a song is the good one is the
    same question whether the song was identified or typed in by hand.
    """
    title, channel = candidate["title"], candidate["channel"]
    ti, ta = tokens(title), tokens(artist)
    delta = 0.0

    # The artist's name should show up somewhere — channel is the stronger signal
    if ta:
        if ta & tokens(channel):
            delta += 12
        elif ta & ti:
            delta += 6

    # "Artist - Topic" is YouTube's own auto-generated official audio, and VEVO is
    # label-verified. Deliberately nothing looser: re-upload channels call
    # themselves things like "XYZ Records Music", so keyword bonuses hand the top
    # slot to exactly the channels we don't want.
    low_channel = channel.lower()
    if low_channel.endswith("- topic"):
        delta += 14
    elif "vevo" in low_channel:
        delta += 10
    if "official" in title.lower():
        delta += 5

    # Edits and hour-loops are the wrong result even when the words line up
    if any(m in title.lower() for m in EDIT_MARKERS):
        delta -= 30

    dur = candidate.get("duration") or 0
    if dur:
        if dur > 900:        # 15min+ — a mix or compilation
            delta -= 35
        elif dur > 480:      # long for a single
            delta -= 12
        elif dur < 60:       # a Short, not the track
            delta -= 15

    return delta


def find_on_youtube(track: str, artist: str, limit: int = 5) -> list[dict]:
    """Rank candidates for a song we actually identified, by name."""
    query = f"{artist} {track}".strip() if artist else track
    if not query:
        return []

    results = youtube_search(query, limit=8)
    for r in results:
        r["_raw"] = score(r, track, artist)
    results.sort(key=lambda r: r["_raw"], reverse=True)

    for r in results:
        r["score"] = min(100, round(r.pop("_raw")))
    return results[:limit]


def search_query(query: str, limit: int = 6) -> list[dict]:
    """Free-text search, for when you recognise the song but the app didn't.

    Type a title or a line you caught. Word-overlap scoring is no use here — a
    half-remembered lyric matches every candidate about equally badly, which just
    demotes the official upload to noise. YouTube's own relevance is the better
    judge for free text, so it sets the base and we only adjust for upload
    quality: official channels up, slowed edits and hour-loops down.
    """
    query = (query or "").strip()
    if not query:
        return []

    results = youtube_search(query, limit=8)
    for i, r in enumerate(results):
        r["_raw"] = (100 - i * 6) + adjustments(r)
    results.sort(key=lambda r: r["_raw"], reverse=True)

    for r in results:
        r["score"] = min(100, round(r.pop("_raw")))
    return results[:limit]

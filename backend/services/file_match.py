"""Deciding what to search for, and which YouTube result to believe.

`file_identify.py` holds the tiers exactly as the standalone tool has them and is
deliberately not touched: how Shazam, AcoustID, the caption tags and Whisper each
*detect* a name is unchanged. What lives here is everything around them, which is
where the accuracy problems actually were:

1. **A caption is a guess, not an answer.** The tags carry the reel's caption,
   which is free text about anything at all — one real file's caption read "First
   10 days of a 30 day program" (an event announcement), which searched YouTube
   for a fitness video and returned it with complete confidence. Worse, a caption
   that matched *stopped the run*, so the lyrics tier never got to speak. Now only
   Instagram's own bracketed credit list is trusted outright; free prose is held
   back as a fallback, tried after the audio has had its say.

2. **Search results are ranked, not taken in order.** The tiers resolved a link
   with `ytsearch1:` — literally YouTube's first hit, with nothing filtering out a
   slowed edit, an hour-long loop or an unrelated video that happens to match the
   words. `services/identify.py` already scores candidates for the reel flow;
   this uses the same ranker so both halves of the app judge a result the same way.

The caller gets the ranked list, not one link, so the UI can show alternatives and
the user can overrule the winner.
"""

import re

from backend.services import identify as ranker
from backend.services.file_identify import (
    query_from_acoustid,
    query_from_metadata,
    query_from_lyrics,
    query_from_shazam,
    youtube_from_shazam,
)

# Which tier named the song, in words a person can read.
SOURCE_LABELS = {
    "shazam": "audio fingerprint (Shazam)",
    "acoustid": "audio fingerprint (AcoustID)",
    "caption": "the file's own caption tags",
    "lyrics": "the lyrics, transcribed",
}

# A fingerprint identifies the exact recording. Heard words are a strong lead.
# A caption is someone writing about their post and is treated as such.
SOURCE_CONFIDENCE = {
    "shazam": "high",
    "acoustid": "high",
    "lyrics": "medium",
    "caption": "low",
}

# Song titles are short. Prose is not: the giveaway on the caption that started
# all this was that it ran to eight words and read as a sentence. A cutoff can
# only ever be a trade — a few long titles are given up to stop a caption about
# something else being searched as though it were one.
MAX_CAPTION_WORDS = 6

YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/)|youtu\.be/)([\w-]{11})"
)


def video_id(url: str) -> str | None:
    """The 11-character id, so a hit can play in the embedded player."""
    m = YOUTUBE_ID_RE.search(url or "")
    return m.group(1) if m else None


def _match_from_id(vid: str, title: str) -> dict:
    """A YouTubeMatch built from an id we were handed rather than found."""
    return {
        "id": vid,
        "url": f"https://www.youtube.com/watch?v={vid}",
        "title": title or "",
        "channel": "",
        "duration": None,
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg",
        "score": 100,
    }


def _has_credit_list(path) -> bool:
    """Did the caption carry Instagram's bracketed credit list?

    That list ("[ Cover , Music , Maine khud ko , Mustafa Zahid ]") is structured
    metadata about the audio, so it's worth trusting immediately; the rest of a
    caption is prose and isn't. This only *inspects* the caption to decide how far
    to trust the tier — extracting the name from it stays in file_identify.
    """
    try:
        from mutagen import File as MutagenFile

        tags = MutagenFile(str(path))
        if tags is None or not tags.tags:
            return False
        for key in ("TXXX:description", "TXXX:synopsis"):
            if key in tags.tags:
                return bool(re.search(r"\[(.+?)\]", str(tags.tags[key]), re.DOTALL))
    except Exception:
        return False
    return False


def caption_is_trustworthy(query: str, path) -> bool:
    return bool(query) and (_has_credit_list(path) or len(query.split()) <= MAX_CAPTION_WORDS)


def _result(source=None, query=None, track=None, results=None) -> dict:
    return {
        "source": source,
        "source_label": SOURCE_LABELS.get(source),
        "confidence": SOURCE_CONFIDENCE.get(source),
        "guess": source == "caption",
        "query": query,
        "track": track,
        "results": results or [],
    }


async def identify(path, log=print) -> dict:
    """Work out the song in one file and rank its YouTube candidates."""
    path = str(path)

    # --- tier 1: the fingerprint, which names the recording outright ---------
    query, track = await query_from_shazam(path, log)
    if track:
        title = (track.get("title") or "").strip()
        artist = (track.get("subtitle") or "").strip()
        log(f"[shazam] {query}")

        results = ranker.find_on_youtube(title, artist)

        # Shazam sometimes ships its own video link. It's a good hint, not a
        # verdict, so it goes to the top and the ranked candidates stay as
        # alternatives underneath it.
        direct = video_id(youtube_from_shazam(track) or "")
        if direct:
            log(f"YouTube (Shazam's own link): https://www.youtube.com/watch?v={direct}")
            pinned = next((r for r in results if r["id"] == direct), None)
            results = [pinned or _match_from_id(direct, title)] + [
                r for r in results if r["id"] != direct
            ]

        _log_results(results, log)
        return _result(
            "shazam",
            query,
            {
                "title": title,
                "artist": artist,
                "cover": (track.get("images") or {}).get("coverart"),
                "shazam_url": track.get("url"),
            },
            results,
        )

    # --- tier 2: the second catalog -----------------------------------------
    query = query_from_acoustid(path)
    if query:
        log(f"[acoustid] {query}")
        results = ranker.search_query(query)
        _log_results(results, log)
        return _result("acoustid", query, None, results)

    # --- tier 3: the caption, held back unless it looks like a credit --------
    caption = query_from_metadata(path)
    if caption and not caption_is_trustworthy(caption, path):
        log(f"[caption] {caption!r} — reads like prose, not a song name. Holding it as a")
        log("          fallback and asking the audio first.")
        held, caption = caption, None
    else:
        held = None
        if caption:
            log(f"[caption] {caption}")
            results = ranker.search_query(caption)
            _log_results(results, log)
            return _result("caption", caption, None, results)

    # --- tier 4: the words themselves ---------------------------------------
    query = query_from_lyrics(path, log)
    if query:
        log(f"[lyrics] {query}")
        results = ranker.search_query(query)
        _log_results(results, log)
        return _result("lyrics", query, None, results)

    # --- nothing heard: fall back to the caption we set aside ---------------
    if held:
        log(f"[caption] Nothing in the audio matched, so falling back to the caption: {held}")
        log("          This is a guess from what was written about the post, not from")
        log("          the audio — check it, or search by name yourself.")
        results = ranker.search_query(held)
        _log_results(results, log)
        return _result("caption", held, None, results)

    log("No match found - fingerprints, tags and lyrics all came up empty.")
    return _result()


def _log_results(results: list[dict], log) -> None:
    if not results:
        log("YouTube: nothing came back for that.")
        return
    best = results[0]
    log(f"YouTube: {best['url']}")
    log(f"         ({best['title']})")
    if len(results) > 1:
        log(f"         and {len(results) - 1} more, ranked below it.")

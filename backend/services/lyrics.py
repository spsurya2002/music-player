"""Lyrics and what they mean, with no HTTP concepts in it.

This is the only module that knows the lyrics sidecar exists. It runs next door
on loopback (lyrics-node/, started by run.sh), holds the crawler and the Gemini
key, and has no idea who is asking — everything about *whose* song this is was
settled by the router before anything here is called.

Two stages, asked for separately, and the split matters:

- finding the words. The sidecar asks the open lyrics databases first, and only
  scrapes search engines when they come up empty. It refuses to return a page it
  isn't confident about, which arrives here as a 404 and leaves as
  `state="not_found"` — an answer, not a failure. A confident wrong answer would
  be worse, and the crawl log says which of "nothing is online" and "we were
  turned away" happened.
- explaining them. One Gemini call, structured, and only when asked. Finding
  words costs a crawl; explaining them costs money, so that is the step that
  spends a use and the one you have to press a button for. It is also allowed
  to fail quietly — words with no reading are still worth having, so a missing
  key or a bad response becomes a note beside them rather than an error.

Outbound HTTP is stdlib urllib on a worker thread, the way
backend/services/identify.py already talks to Instagram. One loopback caller at
a time doesn't justify adding an async HTTP client to requirements.txt, and the
only caller is a single background worker, so the thread it blocks is free.
"""

import asyncio
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import NamedTuple

from backend import errors
from backend.config import LYRICS_SIDECAR_URL, LYRICS_TIMEOUT

log = logging.getLogger("reel_audio.lyrics")


class Looked(NamedTuple):
    """`fields` is what to write onto the row; `found` decides whether the use
    is kept. Like pipeline.Saved, it reports the outcome rather than deciding
    what to do about it — the worker owns the quota call."""

    fields: dict
    found: bool


class _Reply(NamedTuple):
    status: int
    body: dict


def _call(path: str, params: dict | None = None, payload: dict | None = None) -> _Reply:
    """One blocking request to the sidecar. Returns the status and the parsed
    body even for a 4xx, because the useful ones say something: a 404 carries
    the crawl log, a 503 carries the reason the key is missing."""
    url = LYRICS_SIDECAR_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)

    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=LYRICS_TIMEOUT) as res:
            return _Reply(res.status, json.loads(res.read() or b"{}"))
    except urllib.error.HTTPError as exc:
        try:
            return _Reply(exc.code, json.loads(exc.read() or b"{}"))
        except (ValueError, OSError):
            return _Reply(exc.code, {})
    except urllib.error.URLError as exc:
        # Nothing listening, or it died mid-crawl. Not the user's problem to
        # decode, so say the one thing that helps.
        log.warning("lyrics sidecar unreachable at %s: %s", LYRICS_SIDECAR_URL, exc.reason)
        raise errors.AppError(errors.LYRICS_OFFLINE, 503) from exc
    except TimeoutError as exc:
        log.warning("lyrics sidecar timed out after %ss", LYRICS_TIMEOUT)
        raise errors.AppError(errors.LYRICS_OFFLINE, 503) from exc


def query_for(song: dict) -> str:
    """What to ask the finder. "Artist - Track" is what the lyrics databases
    match best, so prefer it whenever we have both.

    Falls back through the same ladder the song page titles itself by, and ends
    at `identify_query` — the words a lyrics-tier identification searched for.
    Those songs have no `track` at all, and the half-heard line it did find is
    the only description of them we have.
    """
    artist = (song.get("artist") or "").strip()
    track = (song.get("track") or "").strip()
    if artist and track:
        return f"{artist} - {track}"
    if track:
        return track
    for key in ("identify_query", "title"):
        value = (song.get(key) or "").strip()
        if value:
            return value
    return ""


def _candidate(raw: dict, with_text: bool = False) -> dict:
    """One result, in this app's spelling. The sidecar speaks camelCase; every
    shape that reaches the client here is snake_case (docs/API.md).

    `with_text` carries the words themselves. The alternatives need them so the
    Lyrics page can offer the same version in اردو, हिन्दी and Roman — that
    choice is the whole reason the finder keeps the best candidate per script
    instead of only the top one.
    """
    out = {
        "url": raw.get("url"),
        "site": raw.get("site"),
        "page_title": raw.get("pageTitle"),
        "detected_title": raw.get("detectedTitle"),
        "detected_artist": raw.get("detectedArtist"),
        "score": raw.get("score"),
        "script": raw.get("script"),
        # True when the sidecar romanised this itself rather than finding it
        # written that way. The page has to say so, and the meaning layer must
        # never be fed one (see _explainable).
        "transliterated": bool(raw.get("transliterated")),
        # Plain-language scoring notes, written to be read by a person.
        "reasons": raw.get("reasons") or [],
    }
    if with_text:
        out["text"] = raw.get("lyrics") or ""
    return out


def _explainable(best: dict, alternatives: list[dict]) -> dict | None:
    """The first version actually written in its own script.

    Our romanisation guesses the short vowels Urdu does not write, and a guess
    must not feed an explanation — so if every version we have is one of ours,
    the song gets its words and no meaning.
    """
    for raw in [best, *alternatives]:
        if raw and raw.get("lyrics") and not raw.get("transliterated"):
            return raw
    return None


def _explain(title: str, artist: str, text: str) -> tuple[dict | None, str | None]:
    """The meaning, or the reason there isn't one. Never raises: this stage is
    allowed to come back empty-handed."""
    try:
        reply = _call("/api/meaning", payload={"title": title, "artist": artist, "lyrics": text})
    except errors.AppError as exc:
        return None, exc.message

    if reply.status == 200 and reply.body.get("summary"):
        m = reply.body
        return {
            "summary": m.get("summary") or "",
            "tradition": m.get("tradition") or "",
            "poet": m.get("poet") or "",
            "themes": m.get("themes") or [],
            "lines": [
                {
                    "n": line.get("n"),
                    "text": line.get("text") or "",
                    "roman": line.get("roman") or "",
                    "matlab": line.get("matlab") or "",
                    "note": line.get("note") or "",
                    # Where else this line appears, for songs that repeat a
                    # refrain — explained once, marked everywhere.
                    "repeats_at": line.get("repeatsAt") or [],
                }
                for line in (m.get("lines") or [])
            ],
            # A union by design: words the Rekhta dictionary knew carry an
            # origin and a link, ones only the model glossed carry just senses.
            "terms": [
                {
                    "word": t.get("word") or "",
                    "roman": t.get("roman") or "",
                    "hindi": t.get("hindi") or "",
                    "urdu": t.get("urdu") or "",
                    "origin": t.get("origin") or "",
                    "part_of_speech": t.get("partOfSpeech") or "",
                    "senses": t.get("senses") or [],
                    "url": t.get("url") or "",
                }
                for t in (m.get("terms") or [])
            ],
            "model": m.get("model") or "",
        }, None

    # 503 (no key), 413 (too long), 502 (model refused or returned nonsense).
    # All of them are "here are the words, here's why there's no meaning".
    note = reply.body.get("error") or "Couldn't work out what this one means."
    log.info("meaning unavailable (%s): %s", reply.status, note)
    return None, note


async def lookup(song: dict, refresh: bool = False) -> Looked:
    """Find a library song's words, then what they mean."""
    query = query_for(song)
    if not query:
        raise errors.AppError(errors.UNNAMED_SONG, 400)
    return await lookup_query(query, refresh=refresh)


async def lookup_query(query: str, refresh: bool = False) -> Looked:
    """Find the words behind a song name or a YouTube link. Blocking, tens of
    seconds. The reading is a separate step — see `explain_stored`.

    The sidecar does the parsing: a YouTube URL (or a bare video id) is resolved
    through oEmbed and then canonicalised against the iTunes catalogue, so what
    comes back is a real artist and title rather than a channel name and a video
    heading. That is why this takes the raw text the person typed and not a
    pre-split title/artist.

    Raises AppError only for things that are genuinely wrong — an empty query, a
    sidecar that isn't there. "Found nothing" comes back as a Looked with
    found=False, because the crawler declining to guess is it working.
    """
    query = (query or "").strip()
    if not query:
        raise errors.AppError(errors.UNNAMED_SONG, 400)

    params = {"q": query}
    if refresh:
        params["refresh"] = "1"
    reply = await asyncio.to_thread(_call, "/api/lyrics", params)

    if reply.status == 404:
        crawled = reply.body.get("crawled") or []
        # "We were turned away" and "this song isn't out there" both arrive as a
        # 404, and the difference is the only thing that tells someone whether
        # waiting will help. A page that was fetched and judged not to be the
        # song is also `ok: false`, so the count of failures says nothing — the
        # sidecar logs a reason starting with this exact phrase for an engine
        # that actually refused us, and that is the only reliable marker
        # (lyrics-node/src/services/lyricsFinder.ts).
        blocked = any(
            str(c.get("reason") or "").startswith("blocked our request") for c in crawled
        )
        return Looked(
            {
                "state": "not_found",
                "query": query,
                "error": errors.LYRICS_BLOCKED if blocked else errors.NO_LYRICS_FOUND,
                "crawled": crawled,
                "text": None,
                "source": None,
                "alternatives": [],
                "meaning": None,
                "meaning_note": None,
                "resolved": None,
                "video": None,
            },
            False,
        )

    if reply.status != 200 or not reply.body.get("best"):
        raise errors.AppError(reply.body.get("error") or errors.NO_LYRICS_FOUND, 502)

    best = reply.body["best"]
    alternatives = reply.body.get("alternatives") or []
    parsed = reply.body.get("query") or {}
    video = parsed.get("youtube") or {}

    fields = {
        "state": "done",
        "query": query,
        "error": None,
        "text": best.get("lyrics") or "",
        "source": _candidate(best),
        "alternatives": [_candidate(a, with_text=True) for a in alternatives],
        "crawled": reply.body.get("crawled") or [],
        # What the finder decided the query actually was. Worth keeping: for a
        # pasted link this is the only place the real artist and title exist,
        # and it is what the page puts at the top instead of the raw URL.
        "resolved": {
            "title": parsed.get("title") or "",
            "artist": parsed.get("artist") or "",
            "source": parsed.get("source") or "text",
            "resolved_by": parsed.get("resolvedBy") or "",
        },
        "video": {
            "id": video.get("videoId") or "",
            "title": video.get("videoTitle") or "",
            "channel": video.get("channel") or "",
            "thumbnail": video.get("thumbnail") or "",
        }
        if video.get("videoId")
        else None,
    }

    return Looked(fields, True)


def _versions_of(row: dict) -> list[dict]:
    """Every version stored on a row, in the shape `_explainable` expects.

    The top candidate's words live at the row's top level and the rest carry
    their own, so this puts them back together rather than asking the finder
    again — the crawl already happened and its answer is what was saved.
    """
    out = []
    source = row.get("source")
    if source and row.get("text"):
        out.append({**source, "lyrics": row["text"]})
    for alt in row.get("alternatives") or []:
        if alt.get("text"):
            out.append({**alt, "lyrics": alt["text"]})
    return out


async def explain_stored(row: dict) -> tuple[dict | None, str | None]:
    """Read a row's words and say what they mean.

    Separate from finding them because the two cost different things: a crawl
    is ours to spend, a model call is money. So this is the step behind a button
    and the step that spends a use.

    Never raises for a bad answer — it returns the reason instead, which the
    page shows beside the words it already has.
    """
    versions = _versions_of(row)
    if not versions:
        return None, "There are no words on this one to explain yet."

    explain_from = _explainable(versions[0], versions[1:])
    if explain_from is None:
        # Our romanisation guesses the short vowels Urdu does not write, and a
        # guess must not feed an explanation.
        return None, (
            "These words are our own romanisation, which guesses vowels the "
            "original doesn't write — too shaky to explain from."
        )

    resolved = row.get("resolved") or {}
    return await asyncio.to_thread(
        _explain,
        resolved.get("title") or "",
        resolved.get("artist") or "",
        explain_from["lyrics"],
    )

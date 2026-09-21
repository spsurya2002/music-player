"""Relevance search over the song library.

A plain Mongo regex misses two things people actually do. First, it only looked at
title/artist/uploader, while the library screen shows each row as *artist — track*
— so the most prominent text on screen wasn't searchable at all. Second, a regex
demands perfect spelling, and song titles transliterated from another script
rarely get typed the same way twice ("parakh" / "parkh" / "paarakh").

So: match across every name-ish field, rank the hits, and fall back to fuzzy
matching when nothing matches exactly. A personal library is thousands of rows at
most, so scoring in Python is cheap and keeps the logic legible.
"""

import difflib
import re
import unicodedata

# Which fields to search, and how much a hit in each is worth. `track` outranks
# `title` because `title` is often just yt-dlp's "Video by <account>" fallback.
FIELD_WEIGHTS = {
    "track": 1.0,
    "artist": 0.95,
    "title": 0.9,
    "uploader": 0.75,
}

# Below this, a fuzzy match is noise rather than a typo.
FUZZY_FLOOR = 0.78

# Don't fuzzy-scan an unbounded collection.
SCAN_CAP = 5000

_MARKS = re.compile(r"[̀-ͯ]")


def normalize(text: str) -> str:
    """Casefold and strip accents so "Mulaqat" matches "Mulāqāt"."""
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = _MARKS.sub("", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _token_score(token: str, field_value: str) -> float:
    """0-100: how well one query word matches one field."""
    field = normalize(field_value)
    if not field or not token:
        return 0.0

    if field == token:
        return 100.0
    if field.startswith(token):
        return 92.0
    if token in field:
        return 85.0

    words = field.split()
    if any(w.startswith(token) for w in words):
        return 80.0

    # Typo tolerance: compare against each word and the whole field, take the best.
    best = difflib.SequenceMatcher(None, token, field).ratio()
    for w in words:
        best = max(best, difflib.SequenceMatcher(None, token, w).ratio())
    return best * 75.0 if best >= FUZZY_FLOOR else 0.0


def score(doc: dict, query: str) -> float:
    """0-100 relevance of one song for a query.

    Multi-word queries are AND-ish: every word has to land somewhere, so
    "nusrat mulaqat" doesn't match a song that only has one of them.
    """
    tokens = normalize(query).split()
    if not tokens:
        return 0.0

    total = 0.0
    for token in tokens:
        best = 0.0
        for field, weight in FIELD_WEIGHTS.items():
            value = doc.get(field)
            if value:
                best = max(best, _token_score(token, value) * weight)
        if best == 0.0:
            return 0.0  # this word matched nothing — not a hit
        total += best

    return total / len(tokens)


def mongo_prefilter(query: str) -> dict:
    """Cheap server-side filter for the common case of correct spelling."""
    pattern = re.compile(re.escape(query.strip()), re.IGNORECASE)
    return {"$or": [{field: pattern} for field in FIELD_WEIGHTS]}


def rank(docs: list[dict], query: str, floor: float = 1.0) -> list[dict]:
    """Sort matching docs by relevance, dropping non-matches."""
    scored = []
    for doc in docs:
        value = score(doc, query)
        if value >= floor:
            scored.append((value, doc))

    # Newest first among equally relevant hits, so ties stay predictable.
    scored.sort(key=lambda pair: (pair[0], pair[1].get("created_at") or 0), reverse=True)
    return [doc for _, doc in scored]

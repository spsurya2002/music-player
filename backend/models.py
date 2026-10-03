"""Request bodies, validated with pydantic. Response shapes are plain dicts
built in the routers (they mix stored + computed fields per docs/API.md), so
there are no response models here — only what the client is allowed to send.
"""

from typing import Literal

from pydantic import BaseModel, Field


class GoogleSignInRequest(BaseModel):
    """The ID token Google Identity Services handed the browser. Nothing else —
    the email, name and picture are read from the token's verified claims, never
    from anything the client says about itself."""

    credential: str = ""


class ExtractRequest(BaseModel):
    url: str = ""


class IngestRequest(BaseModel):
    """One reel, queued for automatic extraction. `origin` records how it
    arrived (the Android share sheet, so far) and is only ever a label."""

    url: str = ""
    origin: str = "share"


class SearchRequest(BaseModel):
    q: str = ""


class SaveSongRequest(BaseModel):
    """Exactly one of token (a reel extraction) or job (an identified upload)."""

    token: str | None = None
    job: str | None = None
    playlist_id: str | None = None


class LyricsRequest(BaseModel):
    """Start a lyrics lookup. `refresh` re-runs one that already finished:
    the sidecar caches a crawl for six hours, so this is also how you get
    past that after correcting a song's title or artist."""

    refresh: bool = False


class LyricsSearchRequest(BaseModel):
    """A pasted YouTube link, or a typed song name. Sent to the finder as-is:
    it does its own parsing, and a link resolves through oEmbed and the iTunes
    catalogue into a real artist and title."""

    q: str = ""
    refresh: bool = False


class CreateLyricsSetRequest(BaseModel):
    name: str
    description: str = ""


class LyricsSetPatchRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class AddLyricsRequest(BaseModel):
    """Exactly what AddSongsRequest is for playlists: one, or several at once."""

    lyrics_id: str | None = None
    lyrics_ids: list[str] | None = None


class SongPatchRequest(BaseModel):
    title: str | None = None
    track: str | None = None
    artist: str | None = None


class CreatePlaylistRequest(BaseModel):
    name: str
    description: str = ""


class PlaylistPatchRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    loop: Literal["off", "all", "one"] | None = None
    # Sharing is a property of the playlist, not an action of its own, so it
    # rides the same PATCH as the name: is_public true puts it on the Shared
    # page for everyone, false takes it straight back off.
    is_public: bool | None = None


class CopyPlaylistRequest(BaseModel):
    """Take a copy of somebody else's shared playlist. `name` is optional — the
    server falls back to the original's, made unique for this library."""

    name: str | None = None


class AddSongsRequest(BaseModel):
    song_id: str | None = None
    song_ids: list[str] | None = None


class OrderRequest(BaseModel):
    song_ids: list[str] = Field(default_factory=list)


# --- limits -----------------------------------------------------------------


class LimitRequestCreate(BaseModel):
    """Asking for more. Free text only — what to grant is the admin's call."""

    message: str = Field(default="", max_length=1000)


class RequestNoteCreate(BaseModel):
    """A line on an open request's thread — a question from the sender, or the
    admin answering one without yet deciding the request itself."""

    text: str = Field(default="", max_length=600)


class FeedbackRequest(BaseModel):
    """What someone thinks of the app.

    Both halves are required. The rating is the only part that can be counted
    and it is one tap; the words are where anything actionable ever is, and a
    two-letter "ok" is not worth the row it sits in.
    """

    rating: int = Field(ge=1, le=5)
    # The floor is checked in the router, after trimming — ten spaces is not
    # ten characters, and a pydantic min_length would accept them. Only the
    # ceiling belongs here, where it can stop a huge body before it is read.
    message: str = Field(default="", max_length=2000)


class LimitsBody(BaseModel):
    """New totals for the paid features. A key left out is left alone; a key
    sent as null means unlimited — so which keys were sent matters, and the
    routers read `model_fields_set` rather than the values alone."""

    reel: int | None = Field(default=None, ge=0, le=100_000)
    file: int | None = Field(default=None, ge=0, le=100_000)
    lyrics: int | None = Field(default=None, ge=0, le=100_000)

    def changes(self) -> dict:
        return {
            f: getattr(self, f)
            for f in ("reel", "file", "lyrics")
            if f in self.model_fields_set
        }


class ResolveLimitRequest(BaseModel):
    decision: Literal["approve", "decline"]
    reply: str = Field(default="", max_length=1000)
    limits: LimitsBody | None = None

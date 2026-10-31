"""Request bodies, validated with pydantic. Response shapes are plain dicts
built in the routers (they mix stored + computed fields per docs/API.md), so
there are no response models here — only what the client is allowed to send.
"""

from typing import Literal

from pydantic import BaseModel, Field

from backend.services import about_defaults


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


class MeaningRequest(BaseModel):
    """Which version to read. `None` means the best one the crawler found,
    which is what every request meant before versions could be yours.

    A row carries one reading, so naming a different version here replaces the
    one already there — and spends another use doing it.
    """

    version: str | None = None


class AddMyLyricsRequest(BaseModel):
    """Words someone typed or pasted in themselves.

    `label` is what the switcher calls this version. Left out, it is named
    after the script the words are written in, the way the crawler's own
    versions are — so "हिन्दी" sits next to "हिन्दी" and reads as the same kind
    of thing rather than as an exception.
    """

    text: str = ""
    label: str | None = None


class MyLyricsPatchRequest(BaseModel):
    """Correct a version already saved. Both fields are optional: sent as null
    means "leave it", which is why neither has a default of empty string."""

    text: str | None = None
    label: str | None = None


class LyricsNamesRequest(BaseModel):
    """What to call a lookup. A crawl that found nothing has no `resolved`
    names, so the only title it has is the raw thing that was pasted — these
    are what the page shows instead, and what the reading is asked about."""

    title: str | None = None
    artist: str | None = None


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
    meaning: int | None = Field(default=None, ge=0, le=100_000)

    def changes(self) -> dict:
        return {
            f: getattr(self, f)
            for f in ("reel", "file", "lyrics", "meaning")
            if f in self.model_fields_set
        }


class ResolveLimitRequest(BaseModel):
    decision: Literal["approve", "decline"]
    reply: str = Field(default="", max_length=1000)
    limits: LimitsBody | None = None


# --- the About page ---------------------------------------------------------


class AboutSection(BaseModel):
    """One headed block on /about. The body is plain text; a blank line starts
    a new paragraph and that is the whole of the formatting."""

    id: str = Field(default="", max_length=60)
    heading: str = Field(default="", max_length=about_defaults.MAX_HEADING)
    body: str = Field(default="", max_length=about_defaults.MAX_BODY)


class AboutLink(BaseModel):
    """One entry in the contact strip. An empty `value` is how a link is
    hidden — that is what keeps the Résumé button off the page until there is
    a URL to put behind it, without needing a second flag per link."""

    kind: str = Field(default="site", max_length=20)
    label: str = Field(default="", max_length=40)
    value: str = Field(default="", max_length=500)


class AboutBody(BaseModel):
    """The whole About document, replaced in one go.

    One Save button on the form, so one PUT — a field-level patch API would be
    three times the code to express the same edit, and the admin is a single
    person who is not racing themselves.
    """

    enabled: bool = True
    # Separate from `enabled` on purpose: taking the rail entry down is not the
    # same as taking the page down. A URL already sitting in a résumé keeps
    # working while the app stops advertising it.
    in_nav: bool = True
    nav_label: str = Field(default="", max_length=30)
    nav_mini_label: str = Field(default="", max_length=12)
    title: str = Field(default="", max_length=80)
    subtitle: str = Field(default="", max_length=300)
    sections: list[AboutSection] = Field(
        default_factory=list, max_length=about_defaults.MAX_SECTIONS
    )
    links: list[AboutLink] = Field(default_factory=list, max_length=about_defaults.MAX_LINKS)
    contact_enabled: bool = True
    contact_heading: str = Field(default="", max_length=80)
    contact_hint: str = Field(default="", max_length=300)
    contact_sent: str = Field(default="", max_length=300)


class JoinRoomRequest(BaseModel):
    code: str = ""


class RoomDecisionRequest(BaseModel):
    allow: bool = False


class RoomCommandRequest(BaseModel):
    """What the host's player reports. Guests never send one of these."""

    type: Literal["play", "pause", "seek", "queue", "skip", "loop", "ended"]
    position_ms: int = Field(default=0, ge=0, le=86_400_000)
    song_ids: list[str] = Field(default_factory=list, max_length=500)
    index: int = Field(default=0, ge=0)
    loop: Literal["off", "all", "one"] | None = None
    restart: bool = False


class SupportNoteRequest(BaseModel):
    """A thank-you left on /support, with or without an account.

    `website` is a honeypot, same as ContactRequest: hidden, so anything in
    it was filled by something that fills every field it finds. The floor on
    `message` is checked after trimming, in the router.
    """

    message: str = Field(default="", max_length=500)
    website: str = Field(default="", max_length=200)


class ContactRequest(BaseModel):
    """Someone writing in from /about — possibly with no account at all.

    `website` is a honeypot: it is hidden from people and left empty by them,
    so anything in it came from something filling every field it found.
    """

    name: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=200)
    # The floor is checked in the router after trimming, as FeedbackRequest
    # does, because ten spaces are not ten characters.
    message: str = Field(default="", max_length=2000)
    website: str = Field(default="", max_length=200)

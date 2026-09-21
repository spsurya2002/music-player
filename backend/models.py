"""Request bodies, validated with pydantic. Response shapes are plain dicts
built in the routers (they mix stored + computed fields per docs/API.md), so
there are no response models here — only what the client is allowed to send.
"""

from typing import Literal

from pydantic import BaseModel, Field


class ExtractRequest(BaseModel):
    url: str = ""


class SearchRequest(BaseModel):
    q: str = ""


class SaveSongRequest(BaseModel):
    """Exactly one of token (a reel extraction) or job (an identified upload)."""

    token: str | None = None
    job: str | None = None
    playlist_id: str | None = None


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


class AddSongsRequest(BaseModel):
    song_id: str | None = None
    song_ids: list[str] | None = None


class OrderRequest(BaseModel):
    song_ids: list[str] = Field(default_factory=list)

"""Motor client, collections, GridFS bucket, and startup index creation.

The AsyncIOMotorClient is created lazily in `connect()`, called from FastAPI's
startup event — creating it at import time binds it to whatever event loop
happens to be current then, which is not necessarily the loop uvicorn/uvloop
actually runs the app on, and blows up with "Future attached to a different
loop". Routers access collections via `db.songs_col` / `db.playlists_col` /
`db.storage` (attribute lookup at call time), not `from backend.db import x`,
so they always see the connected instances.

Every song and playlist carries a `user_id`, so every uniqueness rule is
per-user: two people may each save the same reel, and each may have a playlist
called "Gym". The indexes below are therefore compound, which is also why they
carry explicit names — an instance upgraded from the single-user version still
has the old single-key ones under Mongo's default names.
"""

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import OperationFailure

from backend.config import DB_NAME, MONGO_URL
from backend.storage import Storage

client: AsyncIOMotorClient | None = None
db = None
songs_col = None
playlists_col = None
users_col = None
sessions_col = None
ingest_col = None
lyrics_col = None
lyrics_sets_col = None
holds_col = None
requests_col = None
feedback_col = None
contact_col = None
settings_col = None
rooms_col = None
room_members_col = None
storage: Storage | None = None


def connect() -> None:
    global client, db, songs_col, playlists_col, users_col, sessions_col, ingest_col, storage
    global holds_col, requests_col, lyrics_col, lyrics_sets_col, feedback_col
    global contact_col, settings_col, rooms_col, room_members_col
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    songs_col = db["songs"]
    playlists_col = db["playlists"]
    users_col = db["users"]
    sessions_col = db["sessions"]
    ingest_col = db["ingest_jobs"]
    lyrics_col = db["lyrics"]
    lyrics_sets_col = db["lyrics_sets"]
    holds_col = db["quota_holds"]
    requests_col = db["limit_requests"]
    feedback_col = db["feedback"]
    contact_col = db["contact_messages"]
    # One document per setting, keyed by a string _id ("about"). Not a
    # config file: these are things the admin changes at runtime, from a
    # form, on an instance nobody is going to redeploy to fix a typo.
    settings_col = db["settings"]
    rooms_col = db["rooms"]
    room_members_col = db["room_members"]
    storage = Storage(db)


async def _replace_index(collection, name: str, keys, **options) -> None:
    """Create an index, dropping whatever already sits under that name.

    Mongo refuses to create an index whose name exists with different keys or
    options, and the pre-login database has exactly that: `instagram_url_1` on
    one key, `name_1` unique across all playlists. Dropping first turns the
    upgrade into a no-op on a fresh database and a migration on an old one.
    """
    try:
        await collection.create_index(keys, name=name, **options)
    except OperationFailure:
        try:
            await collection.drop_index(name)
        except OperationFailure:
            pass
        await collection.create_index(keys, name=name, **options)


async def _ensure_song_indexes() -> None:
    """One song per reel per person — but only for songs that came from a reel.

    A plain unique index treats every missing field as the same null, so with
    uploaded files in the same collection the second upload would collide with
    the first. The partial filter indexes only documents where instagram_url is
    actually a string, which is why uploads omit the field rather than store null.
    """
    await _replace_index(
        songs_col,
        "instagram_url_1",
        [("user_id", 1), ("instagram_url", 1)],
        unique=True,
        partialFilterExpression={"instagram_url": {"$type": "string"}},
    )
    # The library list is "this user's songs, newest first" — one index serves it.
    await songs_col.create_index([("user_id", 1), ("created_at", -1)])
    await songs_col.create_index([("title", "text"), ("artist", "text"), ("uploader", "text")])
    # Copying a shared playlist points a second song document at the same GridFS
    # file rather than duplicating the bytes, so deleting a song has to ask
    # whether anyone else still refers to them. This is the index for that
    # question — and for spotting a song the caller has already copied.
    await songs_col.create_index("gridfs_id")


async def _ensure_playlist_indexes() -> None:
    await _replace_index(
        playlists_col, "name_1", [("user_id", 1), ("name", 1)], unique=True
    )
    # The Shared page: every public playlist across all users, most recently
    # shared first. Partial, because the overwhelming majority of rows are
    # private and have no business in this index.
    await playlists_col.create_index(
        [("shared_at", -1)],
        name="public_shared_at",
        partialFilterExpression={"is_public": True},
    )


async def _ensure_user_indexes() -> None:
    # google_sub is the account's stable id; an email can be reassigned, and a
    # person can change theirs, so the sub is what a user document is keyed on.
    await users_col.create_index("google_sub", unique=True)
    await users_col.create_index("email")
    # Sessions expire on their own — Mongo's TTL monitor deletes them, so a
    # forgotten browser tab can't hold a login open forever.
    await sessions_col.create_index("expires_at", expireAfterSeconds=0)
    await sessions_col.create_index("user_id")


async def _ensure_ingest_indexes() -> None:
    """The auto-ingest queue (backend/services/ingest.py).

    Two reads to serve: the worker claiming the oldest queued row across every
    user, and one person's Inbox listing their own newest first.
    """
    await ingest_col.create_index([("state", 1), ("created_at", 1)])
    await ingest_col.create_index([("user_id", 1), ("created_at", -1)])


async def _ensure_limit_indexes() -> None:
    """Asking for more (backend/routers/limits.py, backend/routers/admin.py).

    The partial unique index is the "one open request at a time" rule: a second
    pending row for the same person is refused by Mongo, so two quick clicks
    can't slip past a check-then-insert in the router.
    """
    await requests_col.create_index([("user_id", 1), ("created_at", -1)])
    await requests_col.create_index([("state", 1), ("created_at", 1)])
    await requests_col.create_index(
        "user_id",
        name="one_pending_per_user",
        unique=True,
        partialFilterExpression={"state": "pending"},
    )


async def _ensure_lyrics_indexes() -> None:
    """One row per person per thing looked up (backend/services/lyrics_jobs.py).

    Two kinds of lookup share this collection: one attached to a song in the
    library (`song:<id>`) and one started from a pasted link or a typed name on
    the Lyrics page (`q:<normalised query>`). `key` is whichever it is, so the
    unique index does the same double duty for both — it keeps a second lookup
    for the same thing from queueing behind the first, and scoping every read to
    (user_id, key) means guessing someone else's id finds nothing.
    """
    await _replace_index(
        lyrics_col, "user_id_1_key_1", [("user_id", 1), ("key", 1)], unique=True
    )
    # The saved-lyrics list, newest first.
    await lyrics_col.create_index([("user_id", 1), ("created_at", -1)])
    # What the worker claims from, oldest first.
    await lyrics_col.create_index([("state", 1), ("created_at", 1)])


async def _ensure_lyrics_set_indexes() -> None:
    """Collections of saved lookups — the lyrics answer to playlists.

    Unique on (user_id, name) like playlists, and for the same reason: two
    people may both have a "Qawwali", but one person may not have two.
    """
    await lyrics_sets_col.create_index([("user_id", 1), ("name", 1)], unique=True)
    await lyrics_sets_col.create_index([("user_id", 1), ("created_at", -1)])


async def _ensure_feedback_indexes() -> None:
    """What people think of the app (backend/routers/feedback.py).

    Unlike everything else here this is read across users — by an admin, on the
    Admin page — so the index the dashboard needs is the plain newest-first
    one. The per-user index is for the "you have already said this" check the
    form does before it lets someone send the same thing twice.
    """
    await feedback_col.create_index([("created_at", -1)])
    await feedback_col.create_index([("user_id", 1), ("created_at", -1)])


async def _ensure_contact_indexes() -> None:
    """Messages sent from the About page (backend/routers/contact.py).

    Read across users like feedback, and by an admin only, so newest-first is
    the one index the inbox needs. There is deliberately no per-sender index:
    a sender has no account to key on, which is the whole reason that route
    carries its own rate limiting instead of a session.
    """
    await contact_col.create_index([("created_at", -1)])


async def _ensure_room_indexes() -> None:
    """Listening rooms (backend/services/rooms.py).

    `code` stays unique after a room ends, so an old link can't be reissued to
    a different host. Membership is one row per person per room — asking again
    updates that row rather than stacking a second request.
    """
    await rooms_col.create_index("code", unique=True)
    await rooms_col.create_index([("host_id", 1), ("status", 1)])
    await rooms_col.create_index("host_grace_until")
    await room_members_col.create_index([("room_id", 1), ("user_id", 1)], unique=True)
    await room_members_col.create_index([("user_id", 1), ("status", 1)])


async def create_indexes() -> None:
    await _ensure_song_indexes()
    await _ensure_playlist_indexes()
    await _ensure_user_indexes()
    await _ensure_ingest_indexes()
    await _ensure_limit_indexes()
    await _ensure_lyrics_indexes()
    await _ensure_lyrics_set_indexes()
    await _ensure_feedback_indexes()
    await _ensure_contact_indexes()
    await _ensure_room_indexes()
    await _drop_legacy_indexes()


async def _drop_legacy_indexes() -> None:
    """Indexes an earlier shape of the app created and this one must not keep.

    `lyrics.user_id_1_song_id_1` was unique when a lookup could only belong to a
    song. Searches started from the Lyrics page have no song, and a unique index
    treats every one of their null song_ids as the same value — so the second
    search anyone ran would be refused. The key index above replaces it.
    """
    try:
        await lyrics_col.drop_index("user_id_1_song_id_1")
    except OperationFailure:
        pass  # already gone, or never existed on a fresh database


async def close() -> None:
    if client is not None:
        client.close()

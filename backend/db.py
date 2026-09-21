"""Motor client, collections, GridFS bucket, and startup index creation.

The AsyncIOMotorClient is created lazily in `connect()`, called from FastAPI's
startup event — creating it at import time binds it to whatever event loop
happens to be current then, which is not necessarily the loop uvicorn/uvloop
actually runs the app on, and blows up with "Future attached to a different
loop". Routers access collections via `db.songs_col` / `db.playlists_col` /
`db.storage` (attribute lookup at call time), not `from backend.db import x`,
so they always see the connected instances.
"""

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import OperationFailure

from backend.config import DB_NAME, MONGO_URL
from backend.storage import Storage

client: AsyncIOMotorClient | None = None
db = None
songs_col = None
playlists_col = None
storage: Storage | None = None


def connect() -> None:
    global client, db, songs_col, playlists_col, storage
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    songs_col = db["songs"]
    playlists_col = db["playlists"]
    storage = Storage(db)


async def _ensure_instagram_url_index() -> None:
    """One song per reel — but only for songs that came from a reel.

    A plain unique index treats every missing field as the same null, so with
    uploaded files in the same collection the second upload would collide with
    the first. The partial filter indexes only documents where instagram_url is
    actually a string, which is why uploads omit the field rather than store null.
    """
    options = dict(
        name="instagram_url_1",
        unique=True,
        partialFilterExpression={"instagram_url": {"$type": "string"}},
    )
    try:
        await songs_col.create_index("instagram_url", **options)
    except OperationFailure:
        # A database created before uploads existed has the plain unique index
        # under this name; same keys, different options, so it must go first.
        await songs_col.drop_index("instagram_url_1")
        await songs_col.create_index("instagram_url", **options)


async def create_indexes() -> None:
    await _ensure_instagram_url_index()
    await songs_col.create_index([("created_at", -1)])
    await songs_col.create_index([("title", "text"), ("artist", "text"), ("uploader", "text")])
    await playlists_col.create_index("name", unique=True)


async def close() -> None:
    if client is not None:
        client.close()

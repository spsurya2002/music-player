"""GridFS put/open/delete helpers, via motor's AsyncIOMotorGridFSBucket."""

import asyncio
from pathlib import Path

from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

CHUNK_SIZE = 256 * 1024


class Storage:
    def __init__(self, db):
        self.bucket = AsyncIOMotorGridFSBucket(db)

    async def put_file(self, path: Path, filename: str, content_type: str = "audio/mpeg") -> ObjectId:
        data = await asyncio.to_thread(path.read_bytes)
        file_id = await self.bucket.upload_from_stream(
            filename, data, metadata={"contentType": content_type}
        )
        return file_id

    async def open_stream(self, file_id: ObjectId):
        """An AsyncIOMotorGridOut positioned at 0; caller may .seek() then .read()."""
        return await self.bucket.open_download_stream(file_id)

    async def delete_file(self, file_id: ObjectId) -> None:
        try:
            await self.bucket.delete(file_id)
        except Exception:
            pass


def to_object_id(value: str) -> ObjectId | None:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None

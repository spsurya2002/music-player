"""Range-request streaming of a GridFS-backed file (GET /api/songs/{id}/audio).

FileResponse gives us Range support for free on local disk (used for the temp
preview), but GridFS has no filesystem path, so this implements the same
contract by hand: parse `Range: bytes=start-end`, reply 206 + Content-Range +
Accept-Ranges + Content-Length, and stream chunks via GridOut.seek()/read().
A request with no Range header gets a plain 200 with the whole file.
"""

import re
from urllib.parse import quote

from bson import ObjectId
from fastapi import Request
from fastapi.responses import Response, StreamingResponse

from backend.storage import Storage

CHUNK_SIZE = 256 * 1024
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def content_disposition(disposition: str, filename: str) -> str:
    """Build a Content-Disposition that survives a non-ASCII title.

    HTTP headers are encoded as latin-1, and Instagram titles routinely carry
    Arabic or Devanagari script and emoji. Interpolating one raw raises
    UnicodeEncodeError inside the server and 500s the whole request, so the
    track simply won't play. RFC 6266: an ASCII-safe `filename` for old clients
    plus a percent-encoded `filename*` carrying the real name.
    """
    ascii_name = filename.encode("ascii", "ignore").decode().strip(" .")
    ascii_name = ascii_name.replace('"', "'").replace("\\", "") or "audio.mp3"
    return (
        f'{disposition}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(filename, safe='')}"
    )


async def stream_audio(
    request: Request,
    storage: Storage,
    file_id: ObjectId,
    total: int,
    filename: str,
    download: bool = False,
) -> Response:
    headers = {"Accept-Ranges": "bytes"}
    disposition = "attachment" if download else "inline"
    headers["Content-Disposition"] = content_disposition(disposition, filename)

    range_header = request.headers.get("range")

    if not range_header:
        headers["Content-Length"] = str(total)

        async def full_body():
            gout = await storage.open_stream(file_id)
            try:
                while True:
                    chunk = await gout.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    yield chunk
            finally:
                gout.close()

        return StreamingResponse(
            full_body(), status_code=200, media_type="audio/mpeg", headers=headers
        )

    m = RANGE_RE.match(range_header.strip())
    if not m or (not m.group(1) and not m.group(2)):
        headers["Content-Range"] = f"bytes */{total}"
        return Response(status_code=416, headers=headers)

    start_s, end_s = m.groups()
    if start_s == "":
        # suffix range: last N bytes
        length = int(end_s)
        start = max(total - length, 0)
        end = total - 1
    else:
        start = int(start_s)
        end = int(end_s) if end_s != "" else total - 1

    end = min(end, total - 1)
    if start > end or start >= total:
        headers["Content-Range"] = f"bytes */{total}"
        return Response(status_code=416, headers=headers)

    chunk_len = end - start + 1
    headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    headers["Content-Length"] = str(chunk_len)

    async def ranged_body():
        gout = await storage.open_stream(file_id)
        try:
            gout.seek(start)
            remaining = chunk_len
            while remaining > 0:
                chunk = await gout.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
        finally:
            gout.close()

    return StreamingResponse(
        ranged_body(), status_code=206, media_type="audio/mpeg", headers=headers
    )

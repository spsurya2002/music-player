"""Listening rooms: one host, a queue, a shared clock.

Each browser plays the file itself. This module only stores what is playing
and where in the track that was true, anchored to server time, then tells
every open socket. Audio bytes stay on the room route, which asks "is this
person allowed in, and is this song still queued?" on every request.

One process serves the app, so the sockets live in memory here. Mongo is the
copy a reconnect reads. There is no second server to publish to.
"""

import asyncio
import logging
import secrets
import time
from datetime import timedelta

from fastapi import WebSocket
from pymongo.errors import DuplicateKeyError

from backend import db, errors
from backend.auth import User
from backend.serializers import iso, now, person_to_dict, room_song_to_dict
from backend.storage import to_object_id

log = logging.getLogger("reel_audio.rooms")

ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
CODE_LENGTH = 8
MAX_QUEUE = 500
HOST_GRACE = timedelta(seconds=60)
# How often a socket must hear something. The tunnel in front of this app
# drops a quiet connection; a ping is not a playback command.
HEARTBEAT_S = 20

_join_hits: dict[str, list[float]] = {}
_task: asyncio.Task | None = None


class Hub:
    """Sockets currently attached to a room, on this process only."""

    def __init__(self) -> None:
        self._rooms: dict[str, dict[WebSocket, str]] = {}
        # One socket must not send two messages at once — a heartbeat and a
        # state update otherwise interleave on the same connection.
        self._locks: dict[WebSocket, asyncio.Lock] = {}

    def add(self, room_id: str, ws: WebSocket, user_id: str) -> None:
        self._rooms.setdefault(room_id, {})[ws] = user_id
        self._locks.setdefault(ws, asyncio.Lock())

    def remove(self, room_id: str, ws: WebSocket) -> None:
        room = self._rooms.get(room_id)
        if not room:
            return
        room.pop(ws, None)
        self._locks.pop(ws, None)
        if not room:
            self._rooms.pop(room_id, None)

    def user_ids(self, room_id: str) -> list[str]:
        return list(self._rooms.get(room_id, {}).values())

    def count_user(self, room_id: str, user_id: str) -> int:
        return sum(1 for uid in self.user_ids(room_id) if uid == user_id)

    async def send(self, ws: WebSocket, payload: dict) -> None:
        lock = self._locks.get(ws)
        if lock is None:
            return
        try:
            async with lock:
                await ws.send_json(payload)
        except Exception:
            self._drop_socket(ws)

    async def broadcast(self, room_id: str, payload_for) -> None:
        """payload_for(user_id) -> dict | None. None skips that socket."""
        room = list(self._rooms.get(room_id, {}).items())
        for ws, user_id in room:
            payload = payload_for(user_id)
            if payload is not None:
                await self.send(ws, payload)

    async def close_user(self, room_id: str, user_id: str) -> None:
        room = self._rooms.get(room_id, {})
        for ws, uid in list(room.items()):
            if uid == user_id:
                await self._close(room_id, ws)

    async def close_room(self, room_id: str) -> None:
        for ws in list(self._rooms.get(room_id, {})):
            await self._close(room_id, ws)

    async def _close(self, room_id: str, ws: WebSocket) -> None:
        self.remove(room_id, ws)
        try:
            await ws.close()
        except Exception:
            pass

    def _drop_socket(self, ws: WebSocket) -> None:
        for room_id, room in list(self._rooms.items()):
            if ws in room:
                self.remove(room_id, ws)


hub = Hub()


def normalize_code(raw: str) -> str:
    return "".join(ch for ch in (raw or "").upper() if ch.isalnum())


def _check_code(code: str) -> str:
    code = normalize_code(code)
    if len(code) != CODE_LENGTH or any(ch not in ALPHABET for ch in code):
        raise errors.AppError(errors.ROOM_BAD_CODE, 400)
    return code


def server_now_iso() -> str:
    return iso(now())


def _too_many_joins(user_id: str) -> bool:
    moment = time.monotonic()
    hits = [t for t in _join_hits.get(user_id, []) if moment - t < 60]
    if len(hits) >= 12:
        _join_hits[user_id] = hits
        return True
    hits.append(moment)
    _join_hits[user_id] = hits
    return False


async def _new_code() -> str:
    for _ in range(8):
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        if await db.rooms_col.find_one({"code": code}, {"_id": 1}) is None:
            return code
    raise errors.AppError("Could not start a room — try again.", 500)


async def _open_by_code(code: str) -> dict | None:
    return await db.rooms_col.find_one({"code": code, "status": "open"})


async def _by_code(code: str) -> dict | None:
    return await db.rooms_col.find_one({"code": code})


async def _member(room_id: str, user_id: str) -> dict | None:
    return await db.room_members_col.find_one({"room_id": room_id, "user_id": user_id})


async def _hosted_open(user_id: str) -> dict | None:
    return await db.rooms_col.find_one({"host_id": user_id, "status": "open"})


async def _people(user_ids: list[str]) -> dict[str, dict]:
    oids = [to_object_id(uid) for uid in user_ids]
    oids = [oid for oid in oids if oid]
    if not oids:
        return {}
    docs = await db.users_col.find({"_id": {"$in": oids}}).to_list(len(oids))
    return {str(doc["_id"]): doc for doc in docs}


async def _songs_in_order(host_id: str, song_ids: list[str]) -> list[dict]:
    oids = [to_object_id(sid) for sid in song_ids]
    oids = [oid for oid in oids if oid]
    if not oids:
        return []
    docs = await db.songs_col.find({"_id": {"$in": oids}, "user_id": host_id}).to_list(len(oids))
    by_id = {str(doc["_id"]): doc for doc in docs}
    return [by_id[sid] for sid in song_ids if sid in by_id]


async def _require_owned(host_id: str, song_ids: list[str]) -> list[str]:
    if len(song_ids) > MAX_QUEUE:
        raise errors.AppError(errors.ROOM_TOO_MANY, 400)
    cleaned: list[str] = []
    for sid in song_ids:
        if to_object_id(sid):
            cleaned.append(str(sid))
    if not cleaned:
        return []
    owned = await _songs_in_order(host_id, cleaned)
    found = {str(doc["_id"]) for doc in owned}
    if any(sid not in found for sid in cleaned):
        raise errors.AppError(errors.ROOM_LIBRARY, 400)
    return cleaned


def _clamp_index(index: int, length: int) -> int:
    if length <= 0:
        return 0
    return max(0, min(int(index), length - 1))


async def room_view(room: dict, viewer_id: str, members: list[dict] | None = None) -> dict:
    """The snapshot a host or an accepted guest is allowed to see."""
    host_id = room["host_id"]
    role = "host" if viewer_id == host_id else "guest"
    if members is None:
        members = await db.room_members_col.find(
            {"room_id": str(room["_id"]), "status": {"$in": ["pending", "accepted"]}}
        ).to_list(200)

    people = await _people([host_id] + [m["user_id"] for m in members])
    songs = await _songs_in_order(host_id, room.get("queue") or [])
    code = room["code"]
    visible = []
    accepted = 0
    for member in members:
        status = member.get("status")
        if status == "accepted":
            accepted += 1
        if status == "pending" and role != "host":
            continue
        if status not in ("pending", "accepted"):
            continue
        person = person_to_dict(people.get(member["user_id"]), status)
        if person:
            visible.append(person)

    moment = now()
    return {
        "id": str(room["_id"]),
        "code": code,
        "status": "open",
        "role": role,
        "host": person_to_dict(people.get(host_id)),
        "index": int(room.get("index") or 0),
        "loop": room.get("loop") or "off",
        "playing": bool(room.get("playing")),
        "position_ms": int(room.get("position_ms") or 0),
        "anchored_at": iso(room.get("anchored_at")),
        "server_now": iso(moment),
        "queue": [room_song_to_dict(doc, code) for doc in songs],
        "members": visible,
        # The host counts, whether or not their socket is up.
        "listeners": accepted + 1,
    }


def _waiting(room: dict, host: dict | None) -> dict:
    return {
        "code": room["code"],
        "status": "pending",
        "role": "guest",
        "host": person_to_dict(host),
    }


def _ended(code: str) -> dict:
    return {"code": code, "status": "ended"}


async def _host_doc(host_id: str) -> dict | None:
    oid = to_object_id(host_id)
    return await db.users_col.find_one({"_id": oid}) if oid else None


async def broadcast(room: dict) -> None:
    room_id = str(room["_id"])
    if room.get("status") != "open":
        payload = {"type": "state", "room": _ended(room.get("code") or "")}

        def everyone(_user_id: str) -> dict:
            return payload

        await hub.broadcast(room_id, everyone)
        await hub.close_room(room_id)
        return

    members = await db.room_members_col.find(
        {"room_id": room_id, "status": {"$in": ["pending", "accepted"]}}
    ).to_list(200)
    by_status = {m["user_id"]: m.get("status") for m in members}
    host_id = room["host_id"]
    full_host = await room_view(room, host_id, members)
    # Guests share one view: no pending names.
    full_guest = await room_view(room, "guest-view", members)
    full_guest["role"] = "guest"
    host = await _host_doc(host_id)
    waiting = _waiting(room, host)

    def payload_for(user_id: str) -> dict | None:
        if user_id == host_id:
            return {"type": "state", "room": full_host}
        status = by_status.get(user_id)
        if status == "accepted":
            return {"type": "state", "room": full_guest}
        if status == "pending":
            return {"type": "state", "room": waiting}
        return {"type": "state", "room": {"code": room["code"], "status": "denied"}}

    await hub.broadcast(room_id, payload_for)


async def _leave_memberships(user_id: str, except_room_id: str | None = None) -> None:
    query: dict = {"user_id": user_id, "status": {"$in": ["pending", "accepted"]}}
    if except_room_id:
        query["room_id"] = {"$ne": except_room_id}
    await db.room_members_col.update_many(
        query, {"$set": {"status": "left", "decided_at": now()}}
    )


async def end_room(room: dict) -> None:
    moment = now()
    result = await db.rooms_col.update_one(
        {"_id": room["_id"], "status": "open"},
        {
            "$set": {"status": "ended", "playing": False, "ended_at": moment, "updated_at": moment},
            "$unset": {"host_grace_until": ""},
        },
    )
    if result.modified_count:
        fresh = await db.rooms_col.find_one({"_id": room["_id"]})
        await broadcast(fresh or {**room, "status": "ended"})


async def create_room(user: User) -> dict:
    """One open room per host. Starting another ends the previous one."""
    existing = await _hosted_open(user.id)
    if existing:
        await end_room(existing)
    await _leave_memberships(user.id)
    moment = now()
    doc = {
        "code": await _new_code(),
        "host_id": user.id,
        "status": "open",
        "queue": [],
        "index": 0,
        "loop": "off",
        "playing": False,
        "position_ms": 0,
        "anchored_at": moment,
        "created_at": moment,
        "updated_at": moment,
    }
    result = await db.rooms_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return await room_view(doc, user.id, [])


async def join_room(user: User, raw_code: str) -> dict:
    if _too_many_joins(user.id):
        raise errors.AppError(errors.ROOM_JOIN_FAST, 429)
    code = _check_code(raw_code)
    room = await _by_code(code)
    if not room:
        raise errors.AppError(errors.MISSING_ROOM, 404)
    if room.get("status") != "open":
        raise errors.AppError(errors.ROOM_ENDED, 404)
    if room["host_id"] == user.id:
        return await room_view(room, user.id)

    hosted = await _hosted_open(user.id)
    if hosted:
        raise errors.AppError(errors.ROOM_HOSTING, 400)

    room_id = str(room["_id"])
    await _leave_memberships(user.id, except_room_id=room_id)
    member = await _member(room_id, user.id)
    moment = now()
    if member and member.get("status") in ("denied", "kicked"):
        raise errors.AppError(errors.ROOM_DENIED, 404)
    if member and member.get("status") == "accepted":
        return await room_view(room, user.id)
    if member and member.get("status") == "pending":
        return _waiting(room, await _host_doc(room["host_id"]))

    if member:
        await db.room_members_col.update_one(
            {"_id": member["_id"]},
            {"$set": {"status": "pending", "asked_at": moment, "decided_at": None}},
        )
    else:
        try:
            await db.room_members_col.insert_one(
                {
                    "room_id": room_id,
                    "user_id": user.id,
                    "status": "pending",
                    "asked_at": moment,
                    "decided_at": None,
                }
            )
        except DuplicateKeyError:
            # Two requests at once both miss the row and one loses the unique
            # index. The row that won is still a pending ask.
            pass
    await broadcast(room)
    return _waiting(room, await _host_doc(room["host_id"]))


async def read_room(user: User, raw_code: str) -> dict:
    code = normalize_code(raw_code)
    if len(code) != CODE_LENGTH:
        raise errors.AppError(errors.ROOM_BAD_CODE, 400)
    room = await _by_code(code)
    if not room:
        raise errors.AppError(errors.MISSING_ROOM, 404)
    if room.get("status") != "open":
        raise errors.AppError(errors.ROOM_ENDED, 404)
    if room["host_id"] == user.id:
        return await room_view(room, user.id)
    member = await _member(str(room["_id"]), user.id)
    status = member.get("status") if member else None
    if status == "accepted":
        return await room_view(room, user.id)
    if status == "pending":
        return _waiting(room, await _host_doc(room["host_id"]))
    if status in ("denied", "kicked"):
        raise errors.AppError(errors.ROOM_DENIED, 404)
    return {"code": code, "status": "joinable"}


async def current_room(user: User) -> dict | None:
    hosted = await _hosted_open(user.id)
    if hosted:
        return await room_view(hosted, user.id)
    member = await db.room_members_col.find_one(
        {"user_id": user.id, "status": {"$in": ["pending", "accepted"]}},
        sort=[("asked_at", -1)],
    )
    if not member:
        return None
    room = await db.rooms_col.find_one({"_id": to_object_id(member["room_id"]), "status": "open"})
    if not room:
        return None
    if member.get("status") == "accepted":
        return await room_view(room, user.id)
    return _waiting(room, await _host_doc(room["host_id"]))


async def _host_room(user: User, raw_code: str) -> dict:
    code = _check_code(raw_code)
    room = await _open_by_code(code)
    if not room:
        found = await _by_code(code)
        raise errors.AppError(errors.ROOM_ENDED if found else errors.MISSING_ROOM, 404)
    if room["host_id"] != user.id:
        raise errors.AppError(errors.ROOM_NOT_HOST, 403)
    return room


async def decide(user: User, raw_code: str, member_id: str, allow: bool) -> dict:
    room = await _host_room(user, raw_code)
    room_id = str(room["_id"])
    member = await _member(room_id, member_id)
    if not member or member.get("status") != "pending":
        raise errors.AppError(errors.ROOM_DENIED, 404)
    status = "accepted" if allow else "denied"
    await db.room_members_col.update_one(
        {"_id": member["_id"]},
        {"$set": {"status": status, "decided_at": now()}},
    )
    if not allow:
        note = {"type": "state", "room": {"code": room["code"], "status": "denied"}}
        await hub.broadcast(room_id, lambda uid: note if uid == member_id else None)
        await hub.close_user(room_id, member_id)
    await broadcast(room)
    return await room_view(room, user.id)


async def kick(user: User, raw_code: str, member_id: str) -> dict:
    room = await _host_room(user, raw_code)
    room_id = str(room["_id"])
    member = await _member(room_id, member_id)
    if not member or member.get("status") != "accepted":
        raise errors.AppError(errors.ROOM_DENIED, 404)
    await db.room_members_col.update_one(
        {"_id": member["_id"]},
        {"$set": {"status": "kicked", "decided_at": now()}},
    )
    note = {"type": "state", "room": {"code": room["code"], "status": "kicked"}}
    # Tell them before the socket goes, or the close looks like a blip and
    # they reconnect into a room they are no longer in.
    await hub.broadcast(room_id, lambda uid: note if uid == member_id else None)
    await hub.close_user(room_id, member_id)
    await broadcast(room)
    return await room_view(room, user.id)


async def leave(user: User, raw_code: str) -> dict:
    code = _check_code(raw_code)
    room = await _by_code(code)
    if not room or room.get("status") != "open":
        raise errors.AppError(errors.ROOM_ENDED if room else errors.MISSING_ROOM, 404)
    if room["host_id"] == user.id:
        await end_room(room)
        return _ended(code)
    member = await _member(str(room["_id"]), user.id)
    if member and member.get("status") in ("pending", "accepted"):
        await db.room_members_col.update_one(
            {"_id": member["_id"]},
            {"$set": {"status": "left", "decided_at": now()}},
        )
        await hub.close_user(str(room["_id"]), user.id)
        await broadcast(room)
    return {"code": code, "status": "left"}


def _advance(room: dict, moment) -> dict:
    queue = room.get("queue") or []
    index = int(room.get("index") or 0)
    loop = room.get("loop") or "off"
    update = {"updated_at": moment, "anchored_at": moment, "position_ms": 0}
    if not queue:
        update["playing"] = False
        return update
    if loop == "one":
        update["index"] = index
        update["playing"] = True
    elif index + 1 < len(queue):
        update["index"] = index + 1
        update["playing"] = True
    elif loop == "all":
        update["index"] = 0
        update["playing"] = True
    else:
        update["index"] = index
        update["playing"] = False
        update["position_ms"] = int(room.get("position_ms") or 0)
    return update


def _as_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _position_ms(body: dict) -> int:
    return max(0, min(_as_int(body.get("position_ms")), 86_400_000))


async def apply_command(user: User, raw_code: str, body: dict) -> dict:
    room = await _host_room(user, raw_code)
    kind = body.get("type")
    moment = now()
    update: dict = {"updated_at": moment}
    queue = list(room.get("queue") or [])

    if kind in ("play", "pause", "seek"):
        if not queue:
            update["playing"] = False
        else:
            if kind != "seek":
                update["playing"] = kind == "play"
            update["position_ms"] = _position_ms(body)
            update["anchored_at"] = moment
    elif kind == "queue":
        raw_ids = body.get("song_ids") or []
        if not isinstance(raw_ids, list):
            raw_ids = []
        song_ids = await _require_owned(room["host_id"], raw_ids)
        update["queue"] = song_ids
        update["index"] = _clamp_index(_as_int(body.get("index")), len(song_ids))
        loop = body.get("loop")
        if loop in ("off", "all", "one"):
            update["loop"] = loop
        if body.get("restart") or not song_ids:
            update["position_ms"] = 0
            update["anchored_at"] = moment
            update["playing"] = bool(song_ids)
    elif kind == "skip":
        update["index"] = _clamp_index(_as_int(body.get("index")), len(queue))
        update["position_ms"] = 0
        update["anchored_at"] = moment
        update["playing"] = bool(queue)
    elif kind == "loop":
        loop = body.get("loop")
        if loop not in ("off", "all", "one"):
            raise errors.AppError(errors.ROOM_NO_COMMAND, 400)
        update["loop"] = loop
    elif kind == "ended":
        update = _advance(room, moment)
    else:
        raise errors.AppError(errors.ROOM_NO_COMMAND, 400)

    await db.rooms_col.update_one({"_id": room["_id"], "status": "open"}, {"$set": update})
    fresh = await db.rooms_col.find_one({"_id": room["_id"]})
    await broadcast(fresh)
    return await room_view(fresh, user.id)


async def stream_song(user: User, raw_code: str, song_id: str) -> dict:
    """The membership question for a byte range. Fail closed."""
    code = normalize_code(raw_code)
    room = await _open_by_code(code) if len(code) == CODE_LENGTH else None
    if not room:
        raise errors.AppError(errors.ROOM_SONG_GONE, 404)
    if song_id not in (room.get("queue") or []):
        raise errors.AppError(errors.ROOM_SONG_GONE, 404)
    allowed = room["host_id"] == user.id
    if not allowed:
        member = await _member(str(room["_id"]), user.id)
        allowed = bool(member and member.get("status") == "accepted")
    if not allowed:
        raise errors.AppError(errors.ROOM_SONG_GONE, 404)
    oid = to_object_id(song_id)
    song = await db.songs_col.find_one({"_id": oid, "user_id": room["host_id"]}) if oid else None
    if not song or not song.get("gridfs_id"):
        raise errors.AppError(errors.ROOM_SONG_GONE, 404)
    return song


async def begin_socket(user: User, raw_code: str) -> tuple[dict, str]:
    """What to send on connect, and which room the socket belongs to."""
    code = _check_code(raw_code)
    room = await _by_code(code)
    if not room or room.get("status") != "open":
        raise errors.AppError(errors.ROOM_ENDED if room else errors.MISSING_ROOM, 404)
    room_id = str(room["_id"])
    if room["host_id"] == user.id:
        await db.rooms_col.update_one({"_id": room["_id"]}, {"$unset": {"host_grace_until": ""}})
        return await room_view(room, user.id), room_id
    member = await _member(room_id, user.id)
    status = member.get("status") if member else None
    if status == "accepted":
        return await room_view(room, user.id), room_id
    if status == "pending":
        return _waiting(room, await _host_doc(room["host_id"])), room_id
    if status in ("denied", "kicked"):
        raise errors.AppError(errors.ROOM_DENIED, 404)
    raise errors.AppError(errors.ROOM_JOIN_FIRST, 404)


async def on_socket_closed(user: User, raw_code: str) -> None:
    code = normalize_code(raw_code)
    room = await _open_by_code(code) if len(code) == CODE_LENGTH else None
    if not room or room["host_id"] != user.id:
        return
    if hub.count_user(str(room["_id"]), user.id) > 0:
        return
    # A refresh kills the socket before the next one opens. Ending immediately
    # would take the party down every time the host reloaded.
    await db.rooms_col.update_one(
        {"_id": room["_id"], "status": "open"},
        {"$set": {"host_grace_until": now() + HOST_GRACE}},
    )


async def arm_grace_on_boot() -> None:
    await db.rooms_col.update_many(
        {"status": "open"},
        {"$set": {"host_grace_until": now() + HOST_GRACE}},
    )


async def _sweep_once() -> None:
    moment = now()
    cursor = db.rooms_col.find({"status": "open", "host_grace_until": {"$lte": moment}})
    async for room in cursor:
        if hub.count_user(str(room["_id"]), room["host_id"]) == 0:
            log.info("ending room %s — host did not come back", room.get("code"))
            await end_room(room)


async def _loop() -> None:
    while True:
        try:
            await _sweep_once()
        except Exception:
            log.exception("room sweep failed")
        await asyncio.sleep(5)


def start() -> None:
    global _task
    _task = asyncio.create_task(_loop())


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None

"""Listening rooms. Session required on every route, including the socket.

Hearing someone else's song is allowed only while you are the host or an
accepted member and that song is still in the room queue. That check is
`services.rooms.stream_song`, and it runs again for every byte range.
"""

import asyncio
import json

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from backend import db, errors
from backend.auth import CurrentUser, _user_from_doc, user_doc_for_request
from backend.models import JoinRoomRequest, RoomCommandRequest, RoomDecisionRequest
from backend.services import rooms as room_service
from backend.streaming import file_stem, stream_audio

router = APIRouter(tags=["rooms"])


@router.post("/rooms", status_code=201)
async def create_room(user: CurrentUser):
    room = await room_service.create_room(user)
    return {"room": room}


@router.get("/rooms/current")
async def current_room(user: CurrentUser):
    # Registered before /rooms/{code} would be, if this were a path param.
    # It isn't — "current" is its own word — but keep it next to create.
    return {"room": await room_service.current_room(user)}


@router.post("/rooms/join")
async def join_room(body: JoinRoomRequest, user: CurrentUser):
    return {"room": await room_service.join_room(user, body.code)}


@router.get("/rooms/{code}")
async def get_room(code: str, user: CurrentUser):
    return {"room": await room_service.read_room(user, code)}


@router.post("/rooms/{code}/members/{user_id}")
async def decide_member(code: str, user_id: str, body: RoomDecisionRequest, user: CurrentUser):
    return {"room": await room_service.decide(user, code, user_id, body.allow)}


@router.delete("/rooms/{code}/members/{user_id}")
async def kick_member(code: str, user_id: str, user: CurrentUser):
    return {"room": await room_service.kick(user, code, user_id)}


@router.post("/rooms/{code}/leave")
async def leave_room(code: str, user: CurrentUser):
    return {"room": await room_service.leave(user, code)}


@router.post("/rooms/{code}/command")
async def command(code: str, body: RoomCommandRequest, user: CurrentUser):
    return {"room": await room_service.apply_command(user, code, body.model_dump())}


@router.get("/rooms/{code}/audio")
async def room_audio(code: str, request: Request, user: CurrentUser, song: str = ""):
    found = await room_service.stream_song(user, code, song)
    total = found.get("size") or 0
    filename = f"{file_stem(found)}.mp3"
    return await stream_audio(request, db.storage, found["gridfs_id"], total, filename)


@router.websocket("/rooms/{code}/ws")
async def room_socket(ws: WebSocket, code: str):
    await ws.accept()
    doc = await user_doc_for_request(ws)
    if not doc:
        await ws.send_json({"type": "error", "error": errors.NOT_SIGNED_IN})
        await ws.close()
        return
    user = _user_from_doc(doc)
    try:
        view, room_id = await room_service.begin_socket(user, code)
    except errors.AppError as exc:
        await ws.send_json({"type": "error", "error": exc.message})
        await ws.close()
        return

    room_service.hub.add(room_id, ws, user.id)
    await room_service.hub.send(ws, {"type": "state", "room": view})

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(room_service.HEARTBEAT_S)
            await room_service.hub.send(
                ws, {"type": "ping", "server_now": room_service.server_now_iso()}
            )

    beat = asyncio.create_task(heartbeat())
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")
            if kind == "pong":
                continue
            if kind == "ping":
                await room_service.hub.send(
                    ws, {"type": "pong", "server_now": room_service.server_now_iso()}
                )
                continue
            if kind in ("play", "pause", "seek", "queue", "skip", "loop", "ended"):
                try:
                    await room_service.apply_command(user, code, msg)
                except errors.AppError as exc:
                    await room_service.hub.send(ws, {"type": "error", "error": exc.message})
    except WebSocketDisconnect:
        pass
    finally:
        beat.cancel()
        try:
            await beat
        except asyncio.CancelledError:
            pass
        room_service.hub.remove(room_id, ws)
        try:
            await room_service.on_socket_closed(user, code)
        except Exception:
            pass

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../api/client";
import Msg from "../components/Msg";
import { usePlayer } from "../context/PlayerContext";
import "./RoomView.css";

export default function RoomsView() {
  const navigate = useNavigate();
  const { room: live, primeRoomAudio } = usePlayer();
  const [current, setCurrent] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .currentRoom()
      .then((data) => {
        if (!cancelled) setCurrent(data.room || null);
      })
      .catch(() => {
        if (!cancelled) setCurrent(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const here = live?.code ? live : current;

  async function create() {
    setBusy("create");
    setError("");
    try {
      const data = await api.createRoom();
      navigate(`/rooms/${data.room.code}`);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function join(event) {
    event.preventDefault();
    primeRoomAudio();
    const next = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
    if (!next) {
      setError("Enter the room code.");
      return;
    }
    setBusy("join");
    setError("");
    try {
      await api.joinRoom(next);
      navigate(`/rooms/${next}`);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  return (
    <div className="view">
      <h1 className="page-title">Rooms</h1>
      <p className="sub">
        Start a room and share the code. You pick the song and who gets in. Everyone else
        hears it with you.
      </p>

      {here?.code && (here.status === "open" || here.status === "pending") && (
        <p className="sub">
          <Link to={`/rooms/${here.code}`}>
            {here.status === "pending" ? `Waiting to join ${here.code}` : `Back to ${here.code}`}
          </Link>
        </p>
      )}

      <div className="room-actions">
        <button type="button" className="btn" onClick={create} disabled={busy === "create"}>
          {busy === "create" ? <span className="spin" /> : "Start a room"}
        </button>
      </div>

      <form className="room-join" onSubmit={join}>
        <label className="room-label" htmlFor="room-code">
          Have a code
        </label>
        <div className="room-join-row">
          <input
            id="room-code"
            type="text"
            value={code}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            placeholder="8 characters"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button type="submit" className="btn secondary" disabled={busy === "join"}>
            {busy === "join" ? <span className="spin" /> : "Ask to join"}
          </button>
        </div>
      </form>

      <Msg kind="err">{error}</Msg>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api/client";
import Avatar from "../components/Avatar";
import Msg from "../components/Msg";
import Thumb from "../components/Thumb";
import { usePlayer } from "../context/PlayerContext";
import "./RoomView.css";

export default function RoomView() {
  const { code = "" } = useParams();
  const norm = code.replace(/[^0-9a-z]/gi, "").toUpperCase();
  const navigate = useNavigate();
  const { room: live, watchRoom, leaveRoom, primeRoomAudio, currentSong, playing } = usePlayer();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getRoom(norm)
      .then((data) => {
        if (cancelled) return;
        setError("");
        setInfo(data.room);
        if (data.room.status === "open" || data.room.status === "pending") watchRoom(norm);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [norm, watchRoom]);

  const fetched = info?.code === norm ? info : null;
  const shown = live?.code === norm ? live : fetched;
  const pending = (shown?.members || []).filter((person) => person.status === "pending");
  const inside = (shown?.members || []).filter((person) => person.status === "accepted");

  async function ask() {
    primeRoomAudio();
    setBusy("join");
    setError("");
    try {
      const data = await api.joinRoom(norm);
      setInfo(data.room);
      if (data.room.status === "pending" || data.room.status === "open") watchRoom(norm);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function decide(person, allow) {
    setBusy(person.id);
    setError("");
    try {
      const data = await api.decideRoomMember(norm, person.id, allow);
      setInfo(data.room);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function remove(person) {
    setBusy(person.id);
    setError("");
    try {
      const data = await api.kickRoomMember(norm, person.id);
      setInfo(data.room);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function leave() {
    setBusy("leave");
    setError("");
    try {
      await leaveRoom();
      navigate("/rooms");
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function copy() {
    const link = `${window.location.origin}/rooms/${norm}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      setError(link);
    }
  }

  const guestOpen = shown?.status === "open" && shown.role === "guest";

  return (
    <div className={"view" + (guestOpen ? " room-guest-page" : "")}>
      {!guestOpen && <h1 className="page-title">{shown?.status === "open" ? norm : "Room"}</h1>}

      {!shown && !error && <p className="sub">Loading…</p>}

      {shown?.status === "joinable" && (
        <>
          <p className="sub">
            Ask to join {norm}. The host sees your name and decides whether you come in.
          </p>
          <button type="button" className="btn" onClick={ask} disabled={busy === "join"}>
            {busy === "join" ? <span className="spin" /> : "Ask to join"}
          </button>
        </>
      )}

      {shown?.status === "pending" && (
        <p className="sub">
          Waiting for {shown.host?.given_name || shown.host?.name || "the host"} to let you in.
          This page updates on its own.
        </p>
      )}

      {shown?.status === "open" && shown.role === "host" && (
        <>
          <p className="sub">
            Share the code. You pick what plays — from your library, the same way as always —
            and who gets in.
          </p>
          <div className="room-code-row">
            <span className="room-code">{norm}</span>
            <button type="button" className="btn secondary small" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <section className="room-block">
            <h2 className="section-title">Waiting</h2>
            {pending.length === 0 && <p className="room-empty">Nobody is waiting.</p>}
            {pending.map((person) => (
              <PersonRow key={person.id} person={person}>
                <button
                  type="button"
                  className="btn small"
                  disabled={busy === person.id}
                  onClick={() => decide(person, true)}
                >
                  Let in
                </button>
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={busy === person.id}
                  onClick={() => decide(person, false)}
                >
                  Don't
                </button>
              </PersonRow>
            ))}
          </section>

          <section className="room-block">
            <h2 className="section-title">In the room</h2>
            <PersonRow person={shown.host || { name: "You" }}>
              <span className="room-tag">Host</span>
            </PersonRow>
            {inside.map((person) => (
              <PersonRow key={person.id} person={person}>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy === person.id}
                  onClick={() => remove(person)}
                >
                  Remove
                </button>
              </PersonRow>
            ))}
          </section>

          <button
            type="button"
            className="btn danger"
            disabled={busy === "leave"}
            onClick={() => (confirmEnd ? leave() : setConfirmEnd(true))}
          >
            {busy === "leave" ? <span className="spin" /> : confirmEnd ? "End it — everyone stops" : "End room"}
          </button>
        </>
      )}

      {guestOpen && (
        <GuestStage
          room={shown}
          song={currentSong}
          playing={playing}
          busy={busy === "leave"}
          onLeave={leave}
        />
      )}

      <Msg kind="err">{error}</Msg>
      {!guestOpen && (
        <p className="room-back">
          <Link to="/rooms">All rooms</Link>
        </p>
      )}
    </div>
  );
}

function GuestStage({ room, song, playing, busy, onLeave }) {
  const host = room.host;
  const hostName = host?.name || host?.given_name || "The host";
  const title = song?.track || song?.title || "";
  const by = song?.artist || song?.uploader || "";
  const listening = room.listeners || 1;

  return (
    <div className="room-stage">
      <div className={"room-disc" + (playing ? " on" : "")}>
        <span className="room-disc-ring" />
        <span className="room-disc-ring room-disc-ring-2" />
        <Thumb className="room-cover" src={song?.thumbnail} iconSize={36} />
      </div>

      <div className="room-now">
        <span className={"now-playing" + (playing ? " on" : "")} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        {title ? (
          <div className="room-now-title">{title}</div>
        ) : (
          <div className="room-now-title">Waiting for the next song</div>
        )}
        {by && by !== title && <div className="room-now-by">{by}</div>}
      </div>

      <div className="room-host">
        <Avatar user={host} size={40} />
        <div className="room-host-text">
          <div className="room-host-name">{hostName}</div>
          <div className="room-host-meta">
            {playing ? "Playing now" : "Hosting"}
            {" · "}
            {listening} {listening === 1 ? "person" : "people"} here
          </div>
        </div>
      </div>

      <button type="button" className="btn secondary" disabled={busy} onClick={onLeave}>
        {busy ? <span className="spin" /> : "Leave"}
      </button>
    </div>
  );
}

function PersonRow({ person, children }) {
  if (!person) return null;
  return (
    <div className="room-person">
      <Avatar user={person} size={36} />
      <span className="room-person-name">{person.name || person.given_name}</span>
      <span className="room-person-actions">{children}</span>
    </div>
  );
}

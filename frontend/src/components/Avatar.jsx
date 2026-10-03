import { useState } from "react";

// The Google profile picture, with the person's initial behind it. Google's
// image host can be blocked or slow, and a broken-image icon in the sidebar
// looks like a bug — the initial is what's left when it fails, and it's what
// shows for an account with no picture at all.
export default function Avatar({ user, size = 28 }) {
  const [failed, setFailed] = useState(false);
  const name = user?.name || user?.email || "";
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (!user?.picture || failed) {
    return (
      <span className="avatar avatar-fallback" style={style} aria-hidden="true">
        {initial}
      </span>
    );
  }

  return (
    <img
      className="avatar"
      style={style}
      src={user.picture}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

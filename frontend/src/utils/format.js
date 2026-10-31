export function fmtDur(s) {
  if (!s && s !== 0) return "";
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtSize(b) {
  if (!b && b !== 0) return "";
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

export function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function badgeClass(score) {
  return score >= 70 ? "" : score >= 45 ? " mid" : " low";
}

export function songTitle(song) {
  if (!song) return "";
  const track = (song.track || "").trim();
  const artist = (song.artist || "").trim();
  if (track && artist) {
    const lead = artist.toLowerCase();
    const body = track.toLowerCase();
    // A YouTube title often already starts with the channel name, and putting
    // the artist in front of it again reads as the name twice.
    if (body === lead || body.startsWith(`${lead} -`) || body.startsWith(`${lead} —`)) return track;
    return `${artist} — ${track}`;
  }
  if (track) return track;
  return song.title || "Untitled";
}

// "Good evening" — by the clock on the device, which is the only clock that
// matters for a greeting. Used with a first name on the Search view.
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

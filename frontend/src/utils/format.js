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
  if (song.track && song.artist) return `${song.artist} — ${song.track}`;
  if (song.track) return song.track;
  return song.title || "Untitled";
}

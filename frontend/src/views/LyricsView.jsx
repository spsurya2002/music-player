import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../api/client";
import { ErrorMsg } from "../components/Quota";
import { SearchIcon } from "../components/icons";
import "./views.css";
import "./LyricsView.css";

// One tap each, for the three shapes the box accepts.
const EXAMPLES = [
  "Mehdi Hassan - Ranjish Hi Sahi",
  "Nusrat Fateh Ali Khan - Tajdar-e-Haram",
  "https://youtu.be/lYBUbBu4W08",
];

/**
 * Find lyrics: paste a link or type a name, and go and read the result.
 *
 * This page only starts things, like Add a reel above it: a box, what it
 * accepts, and nothing else. The reading happens on the lookup's own page, so a
 * result is a URL you can come back to — and everything you have kept is one
 * rail row away under Lyrics, which is where a list of them belongs.
 */
export default function LyricsView() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();


  const search = useCallback(
    async (text) => {
      const query = (text ?? "").trim();
      if (!query) return;
      setBusy(true);
      setError(null);
      try {
        const data = await api.searchLyrics(query);
        // Straight to the lookup's own page — the crawl runs on the server, so
        // there is nothing to wait here for.
        navigate(`/lyrics/${data.lyrics.id}`);
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
    },
    [navigate]
  );

  return (
    <div className="view">
      <h1 className="page-title">Find lyrics</h1>
      <p className="sub">
        Paste a YouTube link or type a song name. Reelody finds the words and says where
        they came from; asking what they mean is a second step, on the page it opens.
      </p>

      <form
        className="lyrics-search"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="https://youtu.be/… or Mehdi Hassan - Ranjish Hi Sahi"
          disabled={busy}
          aria-label="YouTube link or song name"
        />
        <button type="submit" className="btn" disabled={busy || !q.trim()}>
          {busy ? <span className="spin" /> : <SearchIcon size={16} />}
          <span className="lyrics-search-label">Find</span>
        </button>
      </form>

      <div className="lyrics-examples">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" className="pill" onClick={() => { setQ(e); search(e); }}>
            {e}
          </button>
        ))}
      </div>

      <ErrorMsg error={error} />

    </div>
  );
}




import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../api/client";
import Msg from "../components/Msg";
import { ErrorMsg } from "../components/Quota";
import "./views.css";

// Where a shared reel lands. Android opens the installed app at /share with the
// share_target params from manifest.webmanifest, this queues the link and steps
// out of the way — the person is mid-scroll in Instagram and wants to be back
// there, not watching a download.

// Instagram's Android share sheet sends a text/plain payload: the link arrives
// inside `text`, usually with a caption wrapped around it, and `url` is empty.
// Other apps do fill `url`. So look everywhere and pull the first link out.
const INSTAGRAM_URL = /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv|share)\/[\w\-./]+/i;

export function findReelUrl(params) {
  for (const key of ["url", "text", "title"]) {
    const found = (params.get(key) || "").match(INSTAGRAM_URL);
    if (found) return found[0];
  }
  return null;
}

export default function ShareTargetView() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null); // a sentence, or the ApiError itself
  // StrictMode runs effects twice in development, and a share is not something
  // to do twice. (The server dedups too, but the round trip is still wasted.)
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const url = findReelUrl(params);
    if (!url) {
      setError(
        "That share didn't contain an Instagram link. Reels, posts and IGTV work — " +
          "stories and profiles don't."
      );
      return;
    }

    api
      .ingestReel(url)
      // replace, so the back button returns to Instagram rather than re-firing
      // the share.
      .then(() => navigate("/imports", { replace: true }))
      .catch((err) => setError(err));
  }, [params, navigate]);

  return (
    <div className="view">
      <h1 className="page-title">{error ? "Couldn't take that one" : "Adding to your library"}</h1>

      {error ? (
        <>
          {typeof error === "string" ? <Msg kind="err">{error}</Msg> : <ErrorMsg error={error} />}
          <p className="sub">
            <Link to="/add/reel" className="ext-link">
              Paste the link by hand
            </Link>{" "}
            · <Link to="/imports" className="ext-link">See what's queued</Link>
          </p>
        </>
      ) : (
        <p className="sub">
          <span className="spin" />
          Queuing the reel…
        </p>
      )}
    </div>
  );
}

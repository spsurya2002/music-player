/* Reading a YouTube link.
 *
 * The lyrics sidecar resolves a pasted link into a `video` on the row, but that
 * only lands when the whole lookup finishes, and Listen is reachable long
 * before then. So this exists to answer the same question locally: the link is
 * sitting right there in `row.query` with the id in it, and asking YouTube to
 * run a text search for the characters of a URL finds nothing — which is how
 * "Couldn't find this one on YouTube" came to be printed underneath a YouTube
 * URL.
 */

// Eleven characters of base64url is every video id YouTube has ever issued.
const ID = /^[\w-]{11}$/;

const HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/;

/** The video id in a link, a bare id, or null if it is neither. */
export function youtubeIdFrom(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (ID.test(s)) return s;

  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return ID.test(id) ? id : null;
  }
  if (!HOSTS.test(host)) return null;

  const v = u.searchParams.get("v");
  if (v && ID.test(v)) return v;

  // /shorts/, /embed/, /live/ and the old /v/ all carry it in the path.
  const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}

/** Whether a string is a link rather than something a person typed. */
export function looksLikeUrl(text) {
  const s = String(text || "").trim();
  return /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+\//.test(s);
}

/** The watch page for a video id — where a link out to YouTube points. */
export function youtubeWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

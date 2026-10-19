import { useState } from "react";
import { MusicIcon } from "./icons";

/**
 * Artwork, with something to show when there isn't any.
 *
 * Two different absences land in the same place. A song or playlist can simply
 * have no thumbnail, and the ones that do point at Instagram's CDN, which signs
 * its URLs and lets them expire — so "has a thumbnail" and "the thumbnail
 * loads" are different questions and only the first is in the database. Chrome
 * draws its broken-image icon even with `alt=""` and a background colour
 * underneath, so the only way to be rid of that is to stop rendering the
 * `<img>`; and an empty box in its place still reads as something missing. A
 * note says "this is music we have no picture of", which is the truth.
 *
 * The fallback takes the caller's own class, and every artwork class in this
 * app already sets its size and a `--placeholder` background, so the empty
 * state occupies exactly the box the image would have.
 *
 * `failedSrc` rather than a boolean: a row reused for a different song gets a
 * new `src`, and that one deserves its own chance to load.
 */
export default function Thumb({ src, alt = "", fallback, iconSize = 18, className, ...rest }) {
  const [failedSrc, setFailedSrc] = useState(null);

  if (!src || failedSrc === src) {
    if (fallback !== undefined) return fallback;
    return (
      <span className={["thumb-empty", className].filter(Boolean).join(" ")} aria-hidden="true">
        <MusicIcon size={iconSize} />
      </span>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailedSrc(src)}
      {...rest}
    />
  );
}

import { Link } from "react-router-dom";
import "./Brand.css";

// The app's name, in the one place the UI reads it from. The manifest, the page
// <title> and the README carry it too, since they can't import from here.
export const APP_NAME = "Reelody";

// The mark: a music note whose head is a ring — the hub of a reel, the spindle
// hole of a record — in white on the accent gradient. public/icon-*.png draw the
// same shapes, so the home-screen icon and the sidebar agree.
export function BrandMark({ size = 30 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <circle cx="37" cy="64.5" r="12" fill="none" stroke="currentColor" strokeWidth="10" />
        <rect x="46.5" y="18.5" width="8.5" height="47" rx="1.5" fill="currentColor" />
        <path d="M55 18.5C64.5 22.5 74.5 28.5 71.5 44.5C68.5 35.5 62.5 31.5 55 30.5Z" fill="currentColor" />
      </svg>
    </span>
  );
}

// The logo, as a way home. A client-side link rather than a reload, so tapping
// it never stops what's playing.
export default function Brand({ className = "" }) {
  return (
    <Link to="/" className={`brand ${className}`.trim()} aria-label={`${APP_NAME} — home`}>
      <BrandMark />
      <span className="brand-word">{APP_NAME}</span>
    </Link>
  );
}

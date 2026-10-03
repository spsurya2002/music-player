// Inline SVG icons only — no icon font, no icon library. currentColor, 16-20px, stroke 1.5-2.

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...rest} aria-hidden="true">
      {children}
    </svg>
  );
}

export const SearchIcon = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Svg>
);

export const LibraryIcon = (p) => (
  <Svg {...p}>
    <path d="M4 5h16M4 12h16M4 19h10" />
  </Svg>
);

export const PlaylistIcon = (p) => (
  <Svg {...p}>
    <path d="M4 6h12M4 12h12M4 18h7" />
    <circle cx="19" cy="16" r="2.5" />
    <path d="M21.5 16V7l-5 1.2" />
  </Svg>
);

export const PlayIcon = (p) => (
  <Svg {...p}>
    <path d="M7 4.5v15l13-7.5-13-7.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p) => (
  <Svg {...p}>
    <rect x="6" y="4.5" width="4.5" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.5" y="4.5" width="4.5" height="15" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const PrevIcon = (p) => (
  <Svg {...p}>
    <path d="M18 5L8 12l10 7V5z" fill="currentColor" stroke="none" />
    <rect x="5" y="5" width="2" height="14" rx="0.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const NextIcon = (p) => (
  <Svg {...p}>
    <path d="M6 5l10 7-10 7V5z" fill="currentColor" stroke="none" />
    <rect x="17" y="5" width="2" height="14" rx="0.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const VolumeIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
    <path d="M16.5 8.5a5 5 0 010 7" />
    <path d="M19 6a9 9 0 010 12" />
  </Svg>
);

export const MuteIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
    <path d="M16 9l5 6M21 9l-5 6" />
  </Svg>
);

export const LoopOffIcon = (p) => (
  <Svg {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 014-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </Svg>
);

export const LoopOneIcon = (p) => (
  <Svg {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 014-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
    <text x="10.5" y="16" fontSize="8" fill="currentColor" stroke="none" fontWeight="700">1</text>
  </Svg>
);

export const QueueIcon = (p) => (
  <Svg {...p}>
    <path d="M4 6h11M4 12h11M4 18h7" />
    <path d="M17 15l3 3 3-3" />
    <path d="M20 6v12" />
  </Svg>
);

export const CloseIcon = (p) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const TrashIcon = (p) => (
  <Svg {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
);

export const PlusIcon = (p) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const PencilIcon = (p) => (
  <Svg {...p}>
    <path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" />
    <path d="M14 7l3 3" />
  </Svg>
);

export const ExternalLinkIcon = (p) => (
  <Svg {...p}>
    <path d="M14 5h5v5" />
    <path d="M19 5l-9 9" />
    <path d="M10 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-4" />
  </Svg>
);

export const YoutubeIcon = (p) => (
  <Svg {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
    <path d="M10.5 9.5l5 2.5-5 2.5v-5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const MoreIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const CheckIcon = (p) => (
  <Svg {...p}>
    <path d="M5 12l5 5L19 7" />
  </Svg>
);

export const GripIcon = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const FileAudioIcon = (p) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
    <path d="M14 3v5h5" />
    <path d="M10 17.5v-5l4-1v5" />
    <circle cx="8.8" cy="17.5" r="1.4" />
    <circle cx="12.8" cy="16.5" r="1.4" />
  </Svg>
);

export const RefreshIcon = (p) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 10-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </Svg>
);

export const SignOutIcon = (p) => (
  <Svg {...p}>
    <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
    <path d="M10 8l-4 4 4 4M6 12h9" />
  </Svg>
);

export const UserIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.7-3.5 3.5-5.5 7-5.5s6.3 2 7 5.5" />
  </Svg>
);

export const InboxIcon = (p) => (
  <Svg {...p}>
    <path d="M3 13h4l2 3h6l2-3h4" />
    <path d="M5.5 5h13l2.5 8v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4l2.5-8z" />
  </Svg>
);

export const DownloadIcon = (p) => (
  <Svg {...p}>
    <path d="M12 4v11" />
    <path d="M7 10.5l5 5 5-5" />
    <path d="M5 20h14" />
  </Svg>
);

// Sharing is public-or-not, so the icon is a globe rather than a share arrow —
// an arrow suggests sending it to someone in particular, which this isn't.
export const GlobeIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.2 2.4 3.3 5.4 3.3 8.5s-1.1 6.1-3.3 8.5c-2.2-2.4-3.3-5.4-3.3-8.5S9.8 5.9 12 3.5z" />
  </Svg>
);

export const LockIcon = (p) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </Svg>
);

export const CopyIcon = (p) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5H6a2 2 0 00-2 2V15" />
  </Svg>
);

// A chain link — "the thing you paste", as opposed to the file you upload.
// Distinct from ExternalLinkIcon, which means "this leaves the app".
export const LinkIcon = (p) => (
  <Svg {...p}>
    <path d="M10 13.5a4 4 0 006 .5l2.5-2.5a4 4 0 00-5.7-5.7L11.5 7" />
    <path d="M14 10.5a4 4 0 00-6-.5L5.5 12.5a4 4 0 005.7 5.7L12.5 17" />
  </Svg>
);

// The admin tier of the rail.
export const ShieldIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

// Plan & limits — a gauge, because what it shows is how much is left.
export const GaugeIcon = (p) => (
  <Svg {...p}>
    <path d="M4.5 17a8.5 8.5 0 1 1 15 0" />
    <path d="M12 13l3.5-4" />
    <circle cx="12" cy="13" r="1.2" />
  </Svg>
);

// Lyrics: lines of text with one left short, the shape of a written verse.
// Not a music note — the player already owns that idea, and this is about words.
export const LyricsIcon = (p) => (
  <Svg {...p}>
    <path d="M4 6h16" />
    <path d="M4 10h16" />
    <path d="M4 14h12" />
    <path d="M4 18h7" />
  </Svg>
);

// The rail toggle. Three bars, because that is the one icon everybody already
// reads as "the menu" without a label.
export const MenuIcon = (p) => (
  <Svg {...p}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </Svg>
);

// Home. A house rather than the globe this route used to carry: the globe said
// "public", but the page it leads to is the start of the app, not a section.
export const HomeIcon = (p) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
  </Svg>
);

// Disclosure, for the rail's collapsible section and the top bar's menus.
// Rotated by CSS when open, so one shape covers both states.
export const ChevronIcon = (p) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);


// Half-shaded circle — the usual mark for opacity. The shading is a filled
// half rather than a hatch, which turns to mud at 14px.
export const OpacityIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
  </Svg>
);

// A star that can be hollow or filled, for the rating picker and for showing
// a rating back. Filled is the state, so it is a prop rather than two icons.
export const StarIcon = ({ filled, ...p }) => (
  <Svg {...p} fill={filled ? "currentColor" : "none"}>
    <path d="M12 3.6l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
  </Svg>
);

// Speech bubble with a tail — feedback, as opposed to the inbox tray.
export const FeedbackIcon = (p) => (
  <Svg {...p}>
    <path d="M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v4l5-4h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z" />
  </Svg>
);

// Jump back / forward by a fixed few seconds. The arc with an arrowhead is the
// usual mark; the number of seconds is written in the button beside it rather
// than inside the glyph, so one pair of icons serves any step.
export const Back3Icon = (p) => (
  <Svg {...p}>
    <path d="M3.5 9.5A9 9 0 1 1 3 13" />
    <path d="M3 4.5v5h5" />
  </Svg>
);

export const Forward3Icon = (p) => (
  <Svg {...p}>
    <path d="M20.5 9.5A9 9 0 1 0 21 13" />
    <path d="M21 4.5v5h-5" />
  </Svg>
);

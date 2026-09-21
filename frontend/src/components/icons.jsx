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

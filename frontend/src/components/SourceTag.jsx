// Where a song came from, at a glance. One library holds all of them, so the
// tag is the only thing telling them apart once they're in the same list.
const TAGS = {
  upload: { cls: "mp3", label: "MP3", title: "Identified from a file you uploaded" },
  youtube: { cls: "youtube", label: "YOUTUBE", title: "Saved from a YouTube link" },
  spotify: { cls: "spotify", label: "SPOTIFY", title: "Saved from a Spotify link" },
  instagram: { cls: "insta", label: "INSTA", title: "Extracted from an Instagram reel" },
};

export default function SourceTag({ source, title }) {
  const tag = TAGS[source] || TAGS.instagram;
  return (
    <span className={"source-tag " + tag.cls} title={title || tag.title}>
      {tag.label}
    </span>
  );
}

// Where a song came from, at a glance: a reel link or a file you uploaded.
// Both live in the same library, so the tag is the only thing telling them
// apart once they're sitting in the same list.
export default function SourceTag({ source, title }) {
  const upload = source === "upload";
  return (
    <span
      className={"source-tag" + (upload ? " mp3" : " insta")}
      title={title || (upload ? "Identified from a file you uploaded" : "Extracted from an Instagram reel")}
    >
      {upload ? "MP3" : "INSTA"}
    </span>
  );
}

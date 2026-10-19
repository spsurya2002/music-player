import * as api from "../api/client";
import { PlayIcon, PauseIcon, MoreIcon, PlusIcon, TrashIcon, ExternalLinkIcon, DownloadIcon, QueueIcon } from "./icons";
import Menu from "./Menu";
import SourceTag from "./SourceTag";
import Thumb from "./Thumb";
import { fmtDur, songTitle } from "../utils/format";
import "./Menu.css";
import "./SongRow.css";

/**
 * One song in a list.
 *
 * In selection mode the leading slot becomes a checkbox and the row body
 * toggles that checkbox instead of opening the song, which is what a row does
 * everywhere else that has one. The overflow menu goes while selecting: the
 * actions are on the selection bar, and per-row actions next to a multi-row
 * selection only raise the question of which one they would apply to.
 */
export default function SongRow({
  song,
  index,
  active,
  playing,
  onPlay,
  onOpen,
  onAddToQueue,
  onAddToPlaylist,
  onDelete,
  selecting = false,
  selected = false,
  onToggleSelect,
}) {
  const title = songTitle(song);

  return (
    <div className={"song-row" + (active ? " active" : "") + (selected ? " selected" : "")}>
      {selecting ? (
        <span className="song-row-check">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${title}`}
          />
        </span>
      ) : (
        <button
          type="button"
          className="song-row-index"
          onClick={onPlay}
          aria-label={active && playing ? `Pause ${title}` : `Play ${title}`}
        >
          <span className="idx">{index + 1}</span>
          <span className="ico">{active && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</span>
        </button>
      )}

      <button
        type="button"
        className="song-row-main"
        onClick={selecting ? onToggleSelect : onOpen}
      >
        <Thumb className="song-row-thumb" src={song.thumbnail} />
        <span className="song-row-text">
          <span className="song-row-title">{title}</span>
          <span className="song-row-artist">{song.artist || song.uploader || "Unknown"}</span>
        </span>
      </button>

      <SourceTag source={song.source} />

      <span className="song-row-duration">{fmtDur(song.duration)}</span>

      {/* The shared Menu, not a second copy of it: this one closes on Escape and
          carries aria-haspopup/expanded and role="menu", none of which the
          hand-rolled dropdown here had — on the control used for every action
          in the library. */}
      {!selecting && (
        <Menu align="right" label={`More for ${title}`} trigger={<span className="icon-btn"><MoreIcon size={18} /></span>}>
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onOpen();
                }}
              >
                <ExternalLinkIcon size={15} />
                Open
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onAddToQueue();
                }}
              >
                <QueueIcon size={15} />
                Add to queue
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onAddToPlaylist();
                }}
              >
                <PlusIcon size={15} />
                Add to playlist
              </button>
              <a href={api.songDownloadUrl(song.id)} download role="menuitem" onClick={close}>
                <DownloadIcon size={15} />
                Download MP3
              </a>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                <TrashIcon size={15} />
                Delete
              </button>
            </>
          )}
        </Menu>
      )}
    </div>
  );
}

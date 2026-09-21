import { useEffect, useRef } from "react";
import Modal from "./Modal";
import { usePlayer } from "../context/PlayerContext";

let apiPromise = null;

function loadYouTubeIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === "function") prevReady();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export default function YouTubePlayerModal() {
  const { ytModal, closeYoutube } = usePlayer();
  const mountRef = useRef(null);
  const playerRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!ytModal.open || !ytModal.videoId) return undefined;
    cancelledRef.current = false;

    loadYouTubeIframeApi().then((YT) => {
      if (cancelledRef.current || !mountRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        videoId: ytModal.videoId,
        playerVars: { autoplay: 1, rel: 0 },
      });
    });

    return () => {
      cancelledRef.current = true;
      if (playerRef.current && playerRef.current.destroy) {
        try {
          playerRef.current.destroy();
        } catch {
          // player already gone
        }
      }
      playerRef.current = null;
    };
  }, [ytModal.open, ytModal.videoId]);

  if (!ytModal.open) return null;

  return (
    <Modal title={ytModal.title || "Playing on YouTube"} onClose={closeYoutube} width={720}>
      <div className="yt-modal-frame">
        <div ref={mountRef} />
      </div>
    </Modal>
  );
}

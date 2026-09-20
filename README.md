# Reel Audio

A small local web app: paste an Instagram reel/post URL, get the audio back as an MP3
you can play in the browser and download.

Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg, with a Flask front end.
Everything runs on your machine; nothing is uploaded anywhere.

## Run it

```bash
./run.sh
```

Then open <http://127.0.0.1:7788>.

The first run creates `.venv/` and installs Flask + yt-dlp. `ffmpeg` must be on your
PATH (`sudo apt install ffmpeg` if it isn't).

## Logged-in access (usually needed)

Instagram serves very little to anonymous requests these days — public reels often work,
but most things return a "login required" or rate-limit error. Two ways to fix that:

**Option A — cookies from your browser (easiest):**

```bash
INSTA_COOKIES_BROWSER=firefox ./run.sh     # or chrome, chromium, brave, edge
```

Close the browser first; some of them lock the cookie DB while running.

**Option B — a cookies.txt file:**

Export your `instagram.com` cookies with a "Get cookies.txt" browser extension, save the
file as `cookies.txt` next to `app.py`, and it gets picked up automatically. This one
survives across sessions and is the more reliable of the two.

## Settings

| Env var                 | Default | What it does                              |
| ----------------------- | ------- | ----------------------------------------- |
| `PORT`                  | `7788`  | Port the server listens on                |
| `AUDIO_QUALITY`         | `192`   | MP3 bitrate in kbps (`128`, `256`, `320`) |
| `INSTA_COOKIES_BROWSER` | unset   | Browser to read the IG session from       |

Example: `PORT=8000 AUDIO_QUALITY=320 ./run.sh`

## How files are named

If Instagram exposes the music credit on the post, you get `Artist - Track.mp3` and the
same info written into the MP3's ID3 tags. When there's no music credit (original audio),
it falls back to `uploader - caption.mp3`.

## Notes

- Files land in `downloads/<job-id>/`. Nothing cleans that up automatically — delete the
  folder whenever it gets big.
- Reels only carry the slice of the song used in the post, so expect 15–90 second clips,
  not full tracks.
- The server binds to `127.0.0.1` on purpose — it's for you, not the network.
- Keep downloads to things you have the rights to save; commercial music on Instagram
  belongs to its rights holders.

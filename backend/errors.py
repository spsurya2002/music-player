"""Error sentences (reused verbatim from docs/API.md) and the AppError type
that the FastAPI exception handler turns into {"error": "..."} responses.
"""


class AppError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# --- exact sentences from docs/API.md -------------------------------------

MISSING_URL = "Paste an Instagram URL first."
BAD_URL = "That doesn't look like an Instagram post/reel URL."
MISSING_TOKEN = "That extraction has expired — paste the link again."
MISSING_JOB = "That identification has expired — upload the file again."
MISSING_UPLOAD = "Choose an audio file first."
MISSING_SONG = "That song is no longer in your library."
MISSING_PLAYLIST = "That playlist doesn't exist any more."
DUPLICATE_SONG = "This reel is already in your library."
DUPLICATE_UPLOAD = "That file is already in your library."


def duplicate_playlist_name(name: str) -> str:
    return f'You already have a playlist called "{name}".'

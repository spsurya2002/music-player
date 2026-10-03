"""Error sentences (reused verbatim from docs/API.md) and the AppError type
that the FastAPI exception handler turns into {"error": "..."} responses.
"""


class AppError(Exception):
    """`extra` rides along beside "error" in the body — for the rare failure a
    client should act on rather than just print (a used-up limit says which
    one, so the page can offer the way to ask for more)."""

    def __init__(self, message: str, status: int = 400, extra: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra or {}


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


# --- sharing ----------------------------------------------------------------

# Deliberately the same sentence for "never existed", "isn't public" and "was
# un-shared a moment ago": a playlist someone keeps private is not a thing a
# stranger gets told about.
# --- lyrics and meaning ---
# "Nothing found" is an answer here, not a fault: the crawler refuses to show a
# page it isn't confident about, because a confident wrong answer is worse than
# none. These say which of the two happened, since the fix differs.
NO_LYRICS_FOUND = "Couldn't find lyrics for this song — the pages we checked weren't it."
LYRICS_BLOCKED = "The search engines turned us away this time — try again in a few minutes."
UNNAMED_SONG = "We don't know what this song is yet — identify it first, then try again."
LYRICS_OFFLINE = "The lyrics service isn't running — start the app with ./run.sh and try again."
MISSING_LYRICS = "That lyrics lookup is no longer saved."
NO_WORDS_YET = "Find the words first — there's nothing to read yet."
MISSING_LYRICS_SET = "That collection doesn't exist any more."
MISSING_SET_NAME = "Give the collection a name."
MISSING_LYRICS_QUERY = "Paste a YouTube link, or type a song name."
LYRICS_QUERY_TOO_LONG = "That's too long to search for — a song name or a link is enough."

NOT_SHARED = "That playlist isn't shared."
MISSING_SHARED_SONG = "That song isn't in a shared playlist any more."


# --- auth ------------------------------------------------------------------

NOT_SIGNED_IN = "Sign in to continue."
SESSION_EXPIRED = "Your session has expired — sign in again."
BAD_CREDENTIAL = "Google couldn't verify that sign-in — try again."
NO_CLIENT_ID = (
    "Google sign-in isn't configured on this server — set GOOGLE_CLIENT_ID (see the README)."
)
NOT_INVITED = "That account isn't on this app's guest list."


def duplicate_playlist_name(name: str) -> str:
    return f'You already have a playlist called "{name}".'


def duplicate_set_name(name: str) -> str:
    return f'You already have a collection called "{name}".'


# --- limits ----------------------------------------------------------------

NOT_FOUND = "No such endpoint."
REQUEST_PENDING = "You already have a request waiting — the admin will get to it."
REQUEST_ANSWERED = "That request has already been answered."
MISSING_REQUEST_MESSAGE = "Say what you need more of, and roughly how much."
MISSING_REQUEST = "That request doesn't exist any more."
MISSING_NOTE_TEXT = "Type your question first."
# A thread only runs while the request is open. Once it's answered the next
# thing to send is a new request, which the Plan page already offers.
NOTE_ON_CLOSED_REQUEST = "That request has been answered — send a new one instead."
NOTE_THREAD_FULL = "This thread is full — the admin has everything they need."
MISSING_USER = "That account doesn't exist."
BUSY_QUOTA = "Too much started at once — try that again in a moment."

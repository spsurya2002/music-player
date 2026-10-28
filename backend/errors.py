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
LYRICS_STOPPED = "You stopped this one. Look again whenever you like."
MEANING_STOPPED = "You stopped the reading. Ask for it again whenever you like."
NO_WORDS_YET = "There are no words on this one yet — find them, or add your own."
MISSING_LYRICS_SET = "That collection doesn't exist any more."
MISSING_SET_NAME = "Give the collection a name."
MISSING_LYRICS_QUERY = "Paste a YouTube link, or type a song name."
LYRICS_QUERY_TOO_LONG = "That's too long to search for — a song name or a link is enough."

# Words someone added themselves. Nothing here costs a crawl or a model call,
# so these are all about the shape of what was typed rather than about limits.
MISSING_LYRICS_TEXT = "Paste the words first — there's nothing to save yet."
LYRICS_TEXT_TOO_LONG = "That's longer than we can read — 12,000 characters is the most."
MISSING_MY_LYRICS = "Those words aren't saved any more."
TOO_MANY_VERSIONS = "That's as many versions as one song can hold — edit or delete one first."

NOT_SHARED = "That playlist isn't shared."
MISSING_SHARED_SONG = "That song isn't in a shared playlist any more."


# --- listening rooms -------------------------------------------------------

MISSING_ROOM = "That room doesn't exist."
ROOM_ENDED = "That room has ended."
ROOM_DENIED = "You can't join this room."
ROOM_JOIN_FIRST = "Ask to join this room first."
ROOM_HOSTING = "End the room you're hosting before joining another."
ROOM_NOT_HOST = "Only the host can do that."
ROOM_BAD_CODE = "That room code doesn't look right."
ROOM_LIBRARY = "Only songs from your library can play in a room."
ROOM_TOO_MANY = "That's more songs than a room can hold."
ROOM_NO_COMMAND = "That isn't a room command."
ROOM_JOIN_FAST = "That's a lot of rooms at once — wait a minute and try again."
ROOM_SONG_GONE = "That song isn't in this room."


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
WITHDRAW_CLOSED_REQUEST = "That request has already been answered, so there's nothing to take back."
NOTE_THREAD_FULL = "This thread is full — the admin has everything they need."
MISSING_USER = "That account doesn't exist."
BUSY_QUOTA = "Too much started at once — try that again in a moment."


# --- the About page and writing to the developer ----------------------------

# Deliberately vague about which limit was hit and how long is left: a sender
# who meant it will try tomorrow, and a script learns nothing it can time
# around. Still a sentence, and still says what to do next.
CONTACT_TOO_SOON = "That's a few messages already — give it an hour and send the rest."
CONTACT_TOO_MANY = "That's as many as one day takes. Try again tomorrow."
CONTACT_CLOSED_TODAY = "The message box has had a busy day — try again tomorrow, or email instead."
CONTACT_MISSING_NAME = "Put your name in, so there's something to reply to you by."
CONTACT_MISSING_EMAIL = "Leave an email address, or there's no way to write back."
MISSING_MESSAGE = "That message is already gone."

# The About page is one document the admin edits, so these are all about the
# shape of what the form sent rather than about anything being missing.
ABOUT_NO_TITLE = "Give the page a title — it's the first thing anyone reads."
ABOUT_NO_NAV_LABEL = "Name the rail entry, or there's nothing to click."
ABOUT_EMPTY_SECTION = "Every section needs a heading and something under it."


def contact_too_short(minimum: int) -> str:
    return f"Tell them a bit more — {minimum} characters at least."

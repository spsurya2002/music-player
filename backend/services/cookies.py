"""Instagram browser-session / cookie handling.

Ported unchanged in behaviour from the legacy app.py: browser_session(),
cookiejar(), _extract(), _has_session(), _profiles_with_instagram(),
CHROME_ROOTS and the _Quiet logger.
"""

import os
from pathlib import Path

from backend.config import COOKIES_FILE, INSTA_COOKIES_BROWSER

# Where Chrome-family browsers keep their profile folders
CHROME_ROOTS = {
    "chrome": "~/.config/google-chrome",
    "chromium": "~/.config/chromium",
    "brave": "~/.config/BraveSoftware/Brave-Browser",
    "edge": "~/.config/microsoft-edge",
}

_resolved: dict = {}


class _Quiet:
    """yt-dlp wants a logger; cookie extraction is noisy and none of it is ours."""

    def debug(self, *a, **k): pass
    def info(self, *a, **k): pass
    def warning(self, *a, **k): pass
    def error(self, *a, **k): pass


def _extract(browser: str, profile: str | None):
    from yt_dlp.cookies import extract_cookies_from_browser

    try:
        return extract_cookies_from_browser(browser, profile=profile, logger=_Quiet())
    except Exception:
        return None


def _has_session(jar) -> bool:
    return bool(jar) and any(
        c.name == "sessionid" and c.value and "instagram" in (c.domain or "")
        for c in jar
    )


def _profiles_with_instagram(browser: str) -> list[str]:
    """Profile folders holding instagram.com cookies, newest session first.

    Read without decrypting — this only asks *which* profile to try, and the
    default profile is often not even the one you're logged in on.
    """
    root = Path(CHROME_ROOTS.get(browser, "")).expanduser()
    if not root.is_dir():
        return []

    import shutil
    import sqlite3
    import tempfile

    found = []
    for db in root.glob("*/Cookies"):
        tmp = Path(tempfile.gettempdir()) / f"ck-{os.getpid()}-{db.parent.name}.sqlite"
        try:
            shutil.copy(db, tmp)  # the live DB is locked while the browser runs
            con = sqlite3.connect(tmp)
            n = con.execute(
                "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%instagram%'"
            ).fetchone()[0]
            con.close()
            if n:
                found.append((db.stat().st_mtime, db.parent.name))
        except Exception:
            continue
        finally:
            tmp.unlink(missing_ok=True)

    return [name for _, name in sorted(found, reverse=True)]


def browser_session():
    """(browser, profile, cookiejar) for the browser profile that's logged in.

    Resolved once and cached. Auto-detecting the profile matters because Chrome
    numbers them per account — a plain "chrome" looks at a Default folder that
    may not exist.
    """
    if "session" in _resolved:
        return _resolved["session"]

    browser, _, profile = INSTA_COOKIES_BROWSER.partition(":")
    browser, profile = browser.strip().lower(), profile.strip() or None
    result = (None, None, None)

    if browser:
        jar = _extract(browser, profile)
        if profile or _has_session(jar):
            result = (browser, profile, jar)
        else:
            for name in _profiles_with_instagram(browser):
                jar = _extract(browser, name)
                if _has_session(jar):
                    print(f"  using {browser} profile: {name}")
                    result = (browser, name, jar)
                    break
            else:
                result = (browser, profile, jar)

    _resolved["session"] = result
    return result


def cookiejar():
    """Whatever session we have, as a plain cookiejar the IG API call can use."""
    import http.cookiejar

    if COOKIES_FILE.exists():
        jar = http.cookiejar.MozillaCookieJar(str(COOKIES_FILE))
        try:
            jar.load(ignore_discard=True, ignore_expires=True)
            return jar
        except Exception:
            return None
    return browser_session()[2]


def has_session() -> bool:
    """Whether an Instagram session was found — for GET /api/health."""
    if COOKIES_FILE.exists():
        return cookiejar() is not None
    if not INSTA_COOKIES_BROWSER:
        return False
    return _has_session(browser_session()[2])

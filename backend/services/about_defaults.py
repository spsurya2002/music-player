"""The About page as it ships, and nothing more.

This file is the *seed*. It is written into `settings/_id: "about"` the first
time the app starts against a database that has no such document, and it is
what the admin's "Reset to default" button writes back. It is never read to
render a page: once the document exists, Mongo is the only truth, and every
word below can be changed from the Admin panel without a deploy.

So do not "fix" the copy here expecting a running instance to pick it up — it
won't. Edit it on the Admin page, or reset and then edit.

Section bodies are plain text. A blank line starts a new paragraph and that is
the whole of the formatting: no Markdown, no HTML. That keeps a UI kit out of a
repo that has deliberately avoided one, and keeps an admin from pasting a
heading or a style attribute into the middle of the design system.
"""

DOC_ID = "about"

# Caps, shared with models.AboutBody so the form and the database agree on what
# fits. They are generous — the point is to stop a paste of a whole PDF, not to
# police anyone's prose.
MAX_SECTIONS = 12
MAX_HEADING = 120
MAX_BODY = 4000
MAX_LINKS = 8

# What `kind` on a link may say. The frontend maps each to an icon, and falls
# back to a globe for anything it doesn't recognise, so adding one here does
# not strictly require a frontend change.
LINK_KINDS = ("email", "github", "linkedin", "resume", "site")


def default_about() -> dict:
    """A fresh copy, every call — callers mutate what they get back."""
    return {
        "enabled": True,
        "in_nav": True,
        "nav_label": "Liner notes",
        "nav_mini_label": "Notes",
        "title": "Liner notes",
        "subtitle": (
            "Who made this, why it exists, and — if it turns out to be useful "
            "to you — how to reach me."
        ),
        "sections": [
            {
                "id": "built",
                "heading": "What you've been using",
                "body": (
                    "Reelody is one person's project. Not a team's, not a bootcamp's "
                    "— every part of what you just clicked through was designed, "
                    "built and deployed by me.\n"
                    "\n"
                    "The interesting parts aren't the ones you can see. Audio lives in "
                    "GridFS so the player can answer a Range request, which is what "
                    "lets you drag the scrubber on a file that is still arriving. "
                    "Extraction is two-phase — a reel becomes a token and a temp "
                    "file first, and nothing touches the database until you press Save "
                    "— so a download that dies halfway never leaves half a song in "
                    "your library. The long work runs on a queue with a single worker, "
                    "because the tunnel in front of this app drops any request still "
                    "open at 100 seconds, and Instagram rate-limits a session that asks "
                    "too fast. Library search is scored in Python rather than handed to "
                    "a Mongo regex, because transliterated titles are never spelled the "
                    "same way twice and “tum hi ho” has to find “Tum Hi "
                    "Ho”.\n"
                    "\n"
                    "None of that is visible, which is rather the point."
                ),
            },
            {
                "id": "who",
                "heading": "Who's writing",
                "body": (
                    "I'm Surya Prakash Mishra. By day I'm a Product Security Engineer "
                    "at UKG, which is a title that undersells the job: I own USPM end "
                    "to end — Python ingestion pipelines pulling seven-plus "
                    "security vendors into BigQuery on schedules from daily down to "
                    "every five minutes, Node and TypeScript REST APIs over the top, "
                    "SSO and RBAC, the dashboard, the CI/CD, and the Cloud Run "
                    "deployment it all sits on. There was no separate platform team to "
                    "hand any of it to.\n"
                    "\n"
                    "I built SecureAssist there — a RAG service with ten-plus JIRA "
                    "actions registered as agent tools — which cut the team's "
                    "manual support load by about 40%. And PhishingIQ, an Outlook "
                    "add-in that scores an email before you click the link in it: "
                    "malicious clicks down 50%, false positives down 25%.\n"
                    "\n"
                    "The security is the domain. The engineering is the job."
                ),
            },
            {
                "id": "ask",
                "heading": "Now the part where I ask you for something",
                "body": (
                    "If you're hiring — I'm looking for backend, full-stack or "
                    "AI-application work; the kind where I own a thing end to end, the "
                    "way I owned this one. The résumé is one click below and "
                    "I answer email quickly.\n"
                    "\n"
                    "If you're not hiring, but someone you know is — a forward "
                    "costs you about thirty seconds and is worth more to me than almost "
                    "anything else on this page.\n"
                    "\n"
                    "If you're neither — then ignore all of the above and go back "
                    "to the music. That is what it was built for, and you using it is "
                    "already the best thing that happens to a side project."
                ),
            },
        ],
        "links": [
            {"kind": "email", "label": "Email", "value": "surya271021@gmail.com"},
            {"kind": "github", "label": "GitHub", "value": "https://github.com/spsurya2002"},
            {
                "kind": "linkedin",
                "label": "LinkedIn",
                "value": "https://www.linkedin.com/in/surya-prakash-mishra-619037230/",
            },
            # Empty on purpose: these URLs rotate, so the button stays hidden
            # until one is pasted in on the Admin page.
            {"kind": "resume", "label": "Résumé", "value": ""},
        ],
        "contact_enabled": True,
        "contact_heading": "Or just say it here",
        "contact_hint": (
            "Goes straight to me. No form service, no newsletter, no follow-up sequence."
        ),
        "contact_sent": "Got it. I'll write back. Thanks for taking the time.",
    }

import { useState } from "react";
import * as api from "../api/client";
import Msg from "../components/Msg";
import useAbout from "../hooks/useAbout";
import { CheckIcon, CopyIcon, DocIcon, GithubIcon, GlobeIcon, LinkedinIcon, MailIcon } from "../components/icons";
import "./views.css";
import "./AboutView.css";

const MIN_MESSAGE = 10;

// `kind` on a link picks its icon. A kind this doesn't know still renders —
// with a globe — so adding one to the backend's LINK_KINDS is enough on its own.
const ICONS = {
  email: MailIcon,
  github: GithubIcon,
  linkedin: LinkedinIcon,
  resume: DocIcon,
  site: GlobeIcon,
};

/**
 * Who built this, and how to reach them.
 *
 * Every word on this page comes from the database — the title, the sections,
 * the links, the message box's own copy — and is edited from the Admin page.
 * Nothing here decides what it says; it decides how it looks.
 *
 * Ungated, like the home page and for the same kind of reason: this is the
 * page a résumé links to, so it is read almost entirely by people who have no
 * account and are never going to make one.
 */
export default function AboutView() {
  const about = useAbout();

  // Still asking. Rendering Not found for the half-second before the answer
  // arrives would be a lie that most people are fast enough to read.
  if (!about.ready) return <div className="view" />;

  if (!about.enabled) {
    return (
      <div className="view">
        <h1 className="page-title">Not found</h1>
        <p className="sub">That page doesn&apos;t exist — try Search, All songs or Playlists.</p>
      </div>
    );
  }

  return (
    <div className="view about-view">
      <h1 className="page-title">{about.title}</h1>
      {about.subtitle && <p className="sub about-sub">{about.subtitle}</p>}

      {(about.sections || []).map((section) => (
        <section className="about-section" key={section.id || section.heading}>
          <h2 className="about-head">{section.heading}</h2>
          {paragraphs(section.body).map((text, i) => (
            // Index as key is safe here: these are static prose, never
            // reordered or edited in place on this side of the app.
            <p className="about-para" key={i}>
              {text}
            </p>
          ))}
        </section>
      ))}

      {(about.links || []).length > 0 && <LinkStrip links={about.links} />}

      {about.contact_enabled && <ContactBox about={about} />}
    </div>
  );
}

// A blank line starts a paragraph. That is the whole of the formatting, which
// is what keeps an admin from pasting markup into the middle of the page.
function paragraphs(body) {
  return (body || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function LinkStrip({ links }) {
  return (
    <div className="about-links">
      {links.map((link) => (
        <LinkButton key={link.kind + link.value} link={link} />
      ))}
    </div>
  );
}

function LinkButton({ link }) {
  const [copied, setCopied] = useState(false);
  const Icon = ICONS[link.kind] || GlobeIcon;
  const isEmail = link.kind === "email";
  const href = isEmail ? `mailto:${link.value}` : link.value;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard permission, or a page served over plain http. The address
      // is written out beside the button, so there is still a way to take it.
    }
  }

  return (
    <span className="about-link-wrap">
      <a
        className="about-link"
        href={href}
        target={isEmail ? undefined : "_blank"}
        rel={isEmail ? undefined : "noopener"}
      >
        <Icon size={17} />
        <span className="about-link-label">{link.label}</span>
        {isEmail && <span className="about-link-value">{link.value}</span>}
      </a>
      {isEmail && (
        <button
          type="button"
          className="icon-btn about-copy"
          onClick={copy}
          aria-label={copied ? "Address copied" : "Copy the address"}
          title={copied ? "Copied" : "Copy"}
        >
          {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        </button>
      )}
    </span>
  );
}

/**
 * Write in without leaving the page.
 *
 * `website` is a honeypot — off-screen, untabbable and hidden from assistive
 * tech, so nobody fills it in on purpose. The server answers a filled one as
 * though it worked and stores nothing, because a bot told which field caught
 * it just stops filling that one.
 */
function ContactBox({ about }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const words = message.trim();

  async function submit(e) {
    e.preventDefault();
    // Said here as well as on the server, so the three common slips are
    // answered without a round trip. The server still checks all of them.
    if (!name.trim()) {
      setError("Put your name in, so there's something to reply to you by.");
      return;
    }
    if (!email.includes("@")) {
      setError("Leave an email address, or there's no way to write back.");
      return;
    }
    if (words.length < MIN_MESSAGE) {
      setError(`Tell them a bit more — ${MIN_MESSAGE} characters at least.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.sendContact({ name: name.trim(), email: email.trim(), message: words, website });
      setSent(true);
    } catch (err) {
      setError(err.message || "That didn't send. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="card about-contact about-contact-done">
        <CheckIcon size={20} />
        <p>{about.contact_sent}</p>
      </section>
    );
  }

  return (
    <section className="card about-contact">
      {about.contact_heading && <h2 className="about-head">{about.contact_heading}</h2>}
      <form onSubmit={submit}>
        <div className="about-fields">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            aria-label="Your name"
            maxLength={120}
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your email"
            aria-label="Your email"
            maxLength={200}
          />
        </div>
        <textarea
          className="about-text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Anything at all — a role, a question, or just that you liked it."
          aria-label="Your message"
        />

        <input
          type="text"
          className="about-pot"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        {about.contact_hint && <p className="hint about-hint">{about.contact_hint}</p>}
        {error && <Msg kind="err">{error}</Msg>}

        <div className="about-actions">
          <button type="submit" className="btn" disabled={busy}>
            {busy ? <span className="spin" /> : null}
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

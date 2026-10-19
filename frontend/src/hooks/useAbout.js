import { useEffect, useState } from "react";
import * as api from "../api/client";
import { onAboutChanged } from "../utils/bus";

/**
 * The About page's content, shared by everything that needs it.
 *
 * Four places ask the same question on every page load — the rail, the phone's
 * You sheet, the account menu and the page itself — so the answer is a
 * module-scoped promise rather than a fetch per caller. The document changes
 * only when an admin saves it, and that save fires onAboutChanged, which is
 * what drops the cache.
 *
 * Off until the server says otherwise. A page that hasn't loaded yet, a
 * failed request and a page the admin has switched off all look the same from
 * here, and all three should leave the rail alone.
 */
// `ready` is how the page tells "still asking" from "switched off" — both
// look like nothing-to-show, but one of them should render Not found and the
// other should render nothing at all for a moment.
const OFF = { enabled: false, in_nav: false, ready: false };

let pending = null;

function fetchAbout() {
  if (!pending) {
    pending = api
      .getAbout()
      .then((d) => ({ ...OFF, ...(d.about || null), ready: true }))
      .catch(() => {
        // Don't cache a failure: the server coming back up should fix this on
        // the next mount rather than on the next reload.
        pending = null;
        return OFF;
      });
  }
  return pending;
}

export function clearAboutCache() {
  pending = null;
}

export default function useAbout() {
  const [about, setAbout] = useState(OFF);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchAbout().then((a) => {
        if (!cancelled) setAbout(a);
      });
    }
    load();
    const off = onAboutChanged(() => {
      clearAboutCache();
      load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return about;
}

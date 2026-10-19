import { useEffect, useState } from "react";

/**
 * A media query as state.
 *
 * Phone rules live in CSS everywhere else in this app, and they should. The
 * lyrics book is the exception: a spread that flips one leaf between two facing
 * pages and a phone that flips the whole page are different elements with
 * different contents, not one element at two widths, so the breakpoint has to
 * be answerable in JSX. `prefers-reduced-motion` is here for the same reason —
 * the honest response to it is to not build the leaf at all.
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => Boolean(window.matchMedia) && window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

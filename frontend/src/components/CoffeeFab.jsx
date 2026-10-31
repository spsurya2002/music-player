import { Link, useLocation } from "react-router-dom";
import { CoffeeIcon } from "./icons";
import "./CoffeeFab.css";

/**
 * The support link, floating, on every page of the shell except /support
 * itself — there the page already is the offer.
 *
 * An icon and nothing else: it is a standing offer rather than something to
 * do, and a worded button in the rail put it in the list of places you go,
 * which is what the rail is for and this isn't. It opens /support in the
 * app. The Buy Me a Coffee site is a link on that page, not this one.
 *
 * Bottom-left, which is the one free corner. The bottom-right belongs to the
 * YouTube dock, and a cup landing on top of the video somebody is playing
 * while they read is exactly the collision this app spent so long avoiding.
 * It clears the player bar, and on phones the tabs as well.
 */
export default function CoffeeFab() {
  const { pathname } = useLocation();
  if (pathname === "/support") return null;

  return (
    <Link
      className="coffee-fab"
      to="/support"
      aria-label="Buy me a coffee"
      title="Buy me a coffee"
    >
      <CoffeeIcon size={20} />
    </Link>
  );
}

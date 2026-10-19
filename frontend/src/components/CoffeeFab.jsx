import { COFFEE_URL } from "../utils/support";
import { CoffeeIcon } from "./icons";
import "./CoffeeFab.css";

/**
 * The support link, floating, on every page of the shell.
 *
 * An icon and nothing else: it is a standing offer rather than something to
 * do, and a worded button in the rail put it in the list of places you go,
 * which is what the rail is for and this isn't.
 *
 * Bottom-left, which is the one free corner. The bottom-right belongs to the
 * YouTube dock, and a cup landing on top of the video somebody is playing
 * while they read is exactly the collision this app spent so long avoiding.
 * It clears the player bar, and on phones the tabs as well.
 */
export default function CoffeeFab() {
  return (
    <a
      className="coffee-fab"
      href={COFFEE_URL}
      target="_blank"
      rel="noopener"
      aria-label="Buy me a coffee"
      title="Buy me a coffee"
    >
      <CoffeeIcon size={20} />
    </a>
  );
}

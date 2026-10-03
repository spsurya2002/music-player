import { NavLink } from "react-router-dom";
import { FileAudioIcon, LinkIcon } from "./icons";
import "./ModeTabs.css";

const cls = ({ isActive }) => "mode-tab" + (isActive ? " active" : "");

/**
 * Reel or file, on both of their pages.
 *
 * The rail carries these as two rows, but the phone's five tabs can only spend
 * one on adding music and it points at the reel — so for a while "Add a file"
 * was reachable by typing the URL and no other way. This is the switch, and it
 * is the pill row ModeTabs.css was originally written for: its 480px rule
 * still says "two tabs have to fit a 360px screen".
 *
 * It shows on desktop too. A second way to a rail row costs nothing, and a
 * control that appears only under 760px is one nobody maintains.
 */
export default function AddTabs() {
  return (
    <div className="mode-tabs" role="tablist">
      <NavLink to="/add/reel" className={cls} role="tab">
        <LinkIcon size={15} />
        Add a reel
      </NavLink>
      <NavLink to="/add/file" className={cls} role="tab">
        <FileAudioIcon size={15} />
        Add a file
      </NavLink>
    </div>
  );
}

import { NavLink } from "react-router-dom";
import { FileAudioIcon, LinkIcon } from "./icons";
import "./ModeTabs.css";

const cls = ({ isActive }) => "mode-tab" + (isActive ? " active" : "");

/**
 * Reel or file, on phones only.
 *
 * The rail carries these as two rows, so on desktop this was a second way to a
 * place the sidebar already names, three inches from it — it is gone above
 * 760px (see ModeTabs.css).
 *
 * It stays below that, because the rail is `display: none` there and the
 * phone's five tabs can only spend one on adding music, which points at the
 * reel. Without this switch "Add a file" is reachable by typing the URL and no
 * other way, which is the state it was in before this component existed. The
 * 480px rule in ModeTabs.css is what makes two tabs fit a 360px screen.
 */
export default function AddTabs() {
  return (
    <div className="mode-tabs add-tabs" role="tablist">
      <NavLink to="/add/reel" className={cls} role="tab">
        <LinkIcon size={15} />
        Add a link
      </NavLink>
      <NavLink to="/add/file" className={cls} role="tab">
        <FileAudioIcon size={15} />
        Add a file
      </NavLink>
    </div>
  );
}

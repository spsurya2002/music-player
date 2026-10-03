import { useEffect, useRef, useState } from "react";

/**
 * A dropdown hung off a trigger: the "+ Add" choices and the account menu in
 * the top bar.
 *
 * Closes on a click outside and on Escape, because a menu you can only dismiss
 * by picking something from it is a trap. Children get `close` so an item can
 * shut the menu as it acts.
 */
export default function Menu({ trigger, align = "right", label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button>
      {open && (
        <div className={"menu-dropdown " + align} role="menu">
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

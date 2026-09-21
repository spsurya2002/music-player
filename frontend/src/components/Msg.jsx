export default function Msg({ kind = "info", children }) {
  if (!children) return null;
  return <div className={`msg ${kind} show`}>{children}</div>;
}

import { useState } from "react";
import Modal from "./Modal";

export default function ConfirmModal({ title = "Are you sure", message, confirmLabel = "Delete", danger = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Modal title={title} onClose={onClose} width={400}>
      <p style={{ margin: "0 0 4px", fontSize: "13.5px", color: "var(--text)" }}>{message}</p>
      {error && <div className="msg err show">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={danger ? "btn danger" : "btn"} onClick={handleConfirm} disabled={busy}>
          {busy ? (
            <>
              <span className="spin" />
              Working
            </>
          ) : (
            confirmLabel
          )}
        </button>
      </div>
    </Modal>
  );
}

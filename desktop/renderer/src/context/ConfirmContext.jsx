// desktop/renderer/src/context/ConfirmContext.jsx
//
// Replaces the old global confirmModal(title, message, confirmLabel)
// function + hardcoded #confirm-modal div in index.html. useConfirm()
// returns an async confirm(title, message, confirmLabel) function that
// resolves true/false — same call signature as before, same
// Escape=cancel / Enter=confirm / backdrop-click=cancel behavior.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null); // { title, message, confirmLabel, resolve }

  const confirm = useCallback((title, message, confirmLabel = "Delete") => {
    return new Promise((resolve) => {
      setRequest({ title, message, confirmLabel, resolve });
    });
  }, []);

  const close = useCallback((result) => {
    setRequest((prev) => {
      if (prev) prev.resolve(result);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!request) return;
    function onKeydown(e) {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [request, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <div
        className={`modal-overlay ${request ? "active" : ""}`}
        aria-hidden={!request}
        onClick={(e) => {
          if (e.target === e.currentTarget) close(false);
        }}
      >
        {request && (
          <div
            className="modal-box"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby="confirm-modal-message"
          >
            <h3 id="confirm-modal-title" className="modal-title">
              {request.title}
            </h3>
            <p id="confirm-modal-message" className="modal-message">
              {request.message}
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                autoFocus
                onClick={() => close(true)}
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

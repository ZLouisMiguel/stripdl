// desktop/renderer/src/context/ToastContext.jsx
//
// Replaces the old global showToast() function + hardcoded
// #toast-container div in index.html. Any component can call
// useToast().showToast(message, type, duration) — no DOM element needs
// to exist ahead of time; ToastProvider renders its own container.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const ToastContext = createContext(null);

function ToastItem({ message, type, duration, onDone }) {
  // 'enter' (just mounted, base .toast styles apply — opacity 0,
  // translated) -> 'shown' (adds .toast-show) -> 'exit' (adds
  // .toast-hide, same visual as 'enter' but explicit, then unmounts
  // after the CSS transition finishes). Matches the old code's
  // requestAnimationFrame-then-classList.add("toast-show") /
  // setTimeout-then-classList.add("toast-hide") sequence.
  const [phase, setPhase] = useState("enter");

  useEffect(() => {
    const raf = requestAnimationFrame(() => setPhase("shown"));
    const hideTimer = setTimeout(() => setPhase("exit"), duration);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hideTimer);
    };
  }, [duration]);

  useEffect(() => {
    if (phase !== "exit") return;
    const t = setTimeout(onDone, 300); // matches CSS transition duration
    return () => clearTimeout(t);
  }, [phase, onDone]);

  const visibilityClass =
    phase === "shown" ? "toast-show" : phase === "exit" ? "toast-hide" : "";

  return (
    <div className={`toast toast-${type} ${visibilityClass}`}>
      <span className="toast-msg">{message}</span>
      <button
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => setPhase("exit")}
      >
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const showToast = useCallback((message, type = "info", duration = 3500) => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onDone={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

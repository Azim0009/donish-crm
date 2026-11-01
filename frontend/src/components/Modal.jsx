import { useEffect } from "react";
import PasswordInput from "./PasswordInput.jsx";

export default function Modal({ title, children, onClose, onSubmit, submitText = "Сохранить", error, busy }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card modal" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <h2>{title}</h2>
        {error && <div className="error">{error}</div>}
        {children}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy}>{busy ? "Сохраняю…" : submitText}</button>
        </div>
      </form>
    </div>
  );
}

export function Field({ label, full, ...p }) {
  return (
    <label className={"field" + (full ? " full" : "")}>
      {label}
      {p.as === "select" ? <select {...p} as={undefined} /> : p.type === "password" ? <PasswordInput {...p} type={undefined} /> : <input {...p} />}
    </label>
  );
}

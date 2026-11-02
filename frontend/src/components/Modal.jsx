import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PasswordInput from "./PasswordInput.jsx";
import Icon from "./Icon.jsx";

// Окно поверх страницы. Рисуется прямо в <body> (portal), чтобы анимации страницы не ломали позицию.
export default function Modal({ title, subtitle, children, onClose, onSubmit, submitText = "Сохранить", error, busy, wide }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const k = (e) => e.key === "Escape" && closeRef.current();
    addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // страница под окном не скроллится
    const first = box.current?.querySelector("input:not([type=hidden]), select, textarea");
    first?.focus();
    return () => { removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, []); // один раз при открытии: фокус не прыгает во время ввода

  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} className={"card modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }} noValidate>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted small" style={{ margin: "4px 0 0" }}>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn close" onClick={onClose} aria-label="Закрыть"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error l-err"><Icon name="alert" /> {error}</div>}
          {children}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy}>{busy ? <><span className="spin" /> Сохраняю…</> : submitText}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

// Поле формы: подпись, звёздочка для обязательных, подсказка под полем
export function Field({ label, full, hint, as, required, children, ...p }) {
  return (
    <label className={"field" + (full ? " full" : "")}>
      <span className="f-label">{label}{required && <i className="req">*</i>}</span>
      {as === "select"
        ? <div className="select-wrap"><select {...p}>{children}</select><Icon name="chevron" className="sel-chev" /></div>
        : p.type === "password" ? <PasswordInput {...p} type={undefined} />
        : <input {...p} />}
      {hint && <span className="f-hint">{hint}</span>}
    </label>
  );
}

// Дни недели кнопками + время «с — до». Значение хранится строкой: «Пн, Ср, Пт · 14:00–16:00»
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export function ScheduleInput({ value, onChange }) {
  const s = String(value || "");
  const days = DAYS.filter((d) => s.includes(d));
  const times = s.match(/\d{1,2}:\d{2}/g) || [];
  const pad = (t) => (t && t.length === 4 ? "0" + t : t || ""); // 9:00 → 09:00 для поля time
  const from = pad(times[0]), to = pad(times[1]);
  const emit = (d, f, t) => {
    const ds = DAYS.filter((x) => d.includes(x)).join(", ");
    const tm = f && t ? `${f}–${t}` : f || (t ? `до ${t}` : "");
    onChange([ds, tm].filter(Boolean).join(" · "));
  };
  return (
    <div className="field full">
      <span className="f-label">Дни и время занятий</span>
      <div className="days" role="group" aria-label="Дни занятий">
        {DAYS.map((d) => (
          <button key={d} type="button" className={"day" + (days.includes(d) ? " on" : "")} aria-pressed={days.includes(d)}
            onClick={() => emit(days.includes(d) ? days.filter((x) => x !== d) : [...days, d], from, to)}>{d}</button>
        ))}
      </div>
      <div className="time-row">
        <label className="time"><span>с</span><input id="sch-from" type="time" value={from} onChange={(e) => emit(days, e.target.value, to)} /></label>
        <label className="time"><span>до</span><input id="sch-to" type="time" value={to} onChange={(e) => emit(days, from, e.target.value)} /></label>
      </div>
      {s && <span className="f-hint">Будет показано: <b>{s}</b></span>}
    </div>
  );
}

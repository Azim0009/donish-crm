import { useState } from "react";
import Icon from "./Icon.jsx";

// Поле пароля с «глазком» и предупреждением о Caps Lock
export default function PasswordInput({ id, value, onChange, autoComplete = "current-password", placeholder, withIcon, ...rest }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e) => setCaps(!!e.getModifierState?.("CapsLock"));
  return (
    <>
      <div className={"pw-field" + (withIcon ? " with-icon" : "")}>
        {withIcon && <Icon name="lock" className="lead" />}
        <input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete}
          placeholder={placeholder} maxLength={128} onKeyUp={onKey} onKeyDown={onKey} spellCheck={false} autoCapitalize="none" {...rest} />
        <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Скрыть пароль" : "Показать пароль"} title={show ? "Скрыть пароль" : "Показать пароль"}>
          <Icon name={show ? "eyeOff" : "eye"} size={18} />
        </button>
      </div>
      {caps && <span className="caps"><Icon name="alert" size={13} /> Включён Caps Lock</span>}
    </>
  );
}

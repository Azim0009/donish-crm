import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../api.js";
import { useTheme } from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import PasswordInput from "../components/PasswordInput.jsx";

const LINES = [
  ["M0,70 C60,40 120,55 180,35 S300,30 360,22", "#2fbf86"],
  ["M0,95 C60,80 120,90 180,70 S300,60 360,52", "#e8b931"],
  ["M0,120 C60,115 120,100 180,105 S300,90 360,84", "#ef5b4c"],
];

export default function Login() {
  const nav = useNavigate();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [theme, toggle] = useTheme();

  async function submit(e) {
    e.preventDefault();
    if (!login.trim() || !password) { setError("Введите логин и пароль"); setShake((x) => x + 1); return; }
    setBusy(true); setError("");
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { login: login.trim(), password } });
      auth.save(r.token, r.user);
      nav(r.user.role === "admin" ? "/" : "/groups");
    } catch (err) {
      setError(err.message === "Failed to fetch" ? "Сервер не отвечает. Проверьте, что backend запущен" : err.message);
      setShake((x) => x + 1);
      setPassword("");
    } finally { setBusy(false); }
  }

  return (
    <div className="login2">
      <section className="l-art" aria-hidden="true">
        <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
        <div className="l-grid" />
        <div className="l-brand"><span className="logo-mark">D</span><span>CRM Donish<small>Donish Academy</small></span></div>
        <div className="l-copy">
          <h1>Каждый балл ученика — <em>на виду</em></h1>
          <p>Посещение, домашние задания, бонусы и экзамен недели. Итог месяца считается сам.</p>
        </div>
        <div className="l-preview">
          <div className="l-card main">
            <div className="row" style={{ justifyContent: "space-between" }}><b>FS-01 · месяц 1</b><span className="pill-ok">80+ переходит</span></div>
            <svg viewBox="0 0 360 140" className="l-chart">
              <line x1="0" x2="360" y1="40" y2="40" className="thr" />
              {LINES.map(([d, c], i) => <path key={i} d={d} stroke={c} pathLength="1" style={{ animationDelay: `${0.3 + i * 0.2}s` }} />)}
            </svg>
            <div className="l-weeks">{["Нед. 1", "Нед. 2", "Нед. 3", "Нед. 4"].map((w) => <span key={w}>{w}</span>)}</div>
          </div>
          <div className="l-card float f1"><Icon name="check" /> Мадина пришла · <b>2</b></div>
          <div className="l-card float f2"><Icon name="award" /> Экзамен недели <b>46/50</b></div>
        </div>
      </section>

      <section className="l-form">
        <button type="button" className="btn sm ghost l-theme" onClick={toggle} aria-label="Сменить тему"><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
        <form onSubmit={submit} className={"l-box" + (shake ? " shake" : "")} key={shake} noValidate>
          <div className="l-mobile-brand"><span className="logo-mark">D</span> CRM Donish</div>
          <div>
            <h2 className="l-title">Добро пожаловать</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>Войдите, чтобы открыть журнал группы</p>
          </div>
          {error && <div className="error l-err"><Icon name="alert" /> {error}</div>}
          <label className="field">Логин
            <div className="in-icon">
              <Icon name="user" className="lead" />
              <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" maxLength={32}
                autoCapitalize="none" spellCheck={false} placeholder="Ваш логин" autoFocus />
            </div>
          </label>
          <label className="field">Пароль
            <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" withIcon />
          </label>
          <button className="btn primary l-submit" disabled={busy}>
            {busy ? <><span className="spin" /> Вхожу…</> : <>Войти <Icon name="arrowLeft" className="flip" /></>}
          </button>
          <p className="l-note"><Icon name="shield" size={14} /> Защищённый вход. Логин и пароль выдаёт суперадмин</p>
        </form>
      </section>
    </div>
  );
}

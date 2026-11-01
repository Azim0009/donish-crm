import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../api.js";
import { Field } from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";
import { v, first } from "../validate.js";

export default function Settings() {
  const nav = useNavigate();
  const me = auth.user || {};
  const [prof, setProf] = useState({ fullName: me.fullName || "", login: me.login || "", password: "" });
  const [pw, setPw] = useState({ old: "", next: "", again: "" });
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState("");

  const strength = (p) => [p.length >= 8, /\p{L}/u.test(p) && /\d/.test(p), p.length >= 12, /[^\p{L}\d]/u.test(p)].filter(Boolean).length;
  const st = strength(pw.next);

  async function saveProfile(e) {
    e.preventDefault();
    const err = first(v.person(prof.fullName, "Имя"), v.login(prof.login), !prof.password && "Введите текущий пароль для подтверждения");
    if (err) return setMsg({ prof: { err } });
    setBusy("prof");
    try {
      await api("/api/me", { method: "PUT", body: { fullName: prof.fullName, login: prof.login, currentPassword: prof.password } });
      if (prof.login.trim().toLowerCase() !== (me.login || "").toLowerCase()) { auth.clear(); nav("/login"); return; }
      auth.save(auth.token, { ...me, fullName: prof.fullName.trim() });
      setProf({ ...prof, password: "" });
      setMsg({ prof: { ok: "Профиль сохранён" } });
    } catch (x) { setMsg({ prof: { err: x.message } }); } finally { setBusy(""); }
  }

  async function savePw(e) {
    e.preventDefault();
    const err = first(!pw.old && "Введите текущий пароль", v.password(pw.next), pw.next !== pw.again && "Новые пароли не совпадают", pw.next === pw.old && "Новый пароль должен отличаться от старого");
    if (err) return setMsg({ pw: { err } });
    setBusy("pw");
    try {
      await api("/api/me/password", { method: "PUT", body: { oldPassword: pw.old, newPassword: pw.next } });
      auth.clear(); nav("/login");
    } catch (x) { setMsg({ pw: { err: x.message } }); } finally { setBusy(""); }
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{me.role === "admin" ? "Суперадмин" : "Учитель"}</div><h1>Настройки</h1><p>Профиль, логин и пароль вашего аккаунта.</p></div>
      </div>
      <div className="settings-grid">
        <form className="card pad" onSubmit={saveProfile} noValidate>
          <h2>Профиль</h2>
          {msg.prof?.err && <div className="error">{msg.prof.err}</div>}
          {msg.prof?.ok && <div className="ok-msg">{msg.prof.ok}</div>}
          <Field label="Имя" id="pf-name" value={prof.fullName} maxLength={100} onChange={(e) => setProf({ ...prof, fullName: e.target.value })} />
          <Field label="Логин" id="pf-login" value={prof.login} maxLength={32} autoCapitalize="none" onChange={(e) => setProf({ ...prof, login: e.target.value })} />
          <Field label="Текущий пароль (для подтверждения)" id="pf-pass" type="password" value={prof.password} onChange={(e) => setProf({ ...prof, password: e.target.value })} />
          <p className="muted small" style={{ margin: 0 }}>Если смените логин — нужно будет войти заново.</p>
          <button className="btn primary" disabled={busy === "prof"}>{busy === "prof" ? "Сохраняю…" : "Сохранить профиль"}</button>
        </form>

        <form className="card pad" onSubmit={savePw} noValidate>
          <h2>Сменить пароль</h2>
          {msg.pw?.err && <div className="error">{msg.pw.err}</div>}
          <Field label="Текущий пароль" id="cp-old" type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
          <Field label="Новый пароль" id="cp-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          {pw.next && (
            <div className="strength">
              <div className="bar"><i style={{ width: `${st * 25}%`, background: st >= 3 ? "var(--pass)" : st === 2 ? "var(--extra)" : "var(--fail)" }} /></div>
              <span className="small muted">{st >= 3 ? "Надёжный пароль" : st === 2 ? "Нормальный — лучше длиннее 12 символов" : "Слабый: минимум 8 символов, буквы и цифры"}</span>
            </div>
          )}
          <Field label="Повторите новый пароль" id="cp-again" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
          <button className="btn primary" disabled={busy === "pw"}>{busy === "pw" ? "Меняю…" : "Сменить пароль"}</button>
          <p className="muted small" style={{ margin: 0 }}>После смены пароля вход закроется на всех устройствах — войдите с новым паролем.</p>
        </form>

        <section className="card pad">
          <h2 style={{ marginBottom: 12 }}>Защита аккаунта</h2>
          <ul className="sec-list">
            <li><Icon name="shield" /> Пароли хранятся в зашифрованном виде (bcrypt), их не видит никто, даже суперадмин.</li>
            <li><Icon name="lock" /> После 5 неверных попыток вход в аккаунт блокируется на 15 минут.</li>
            <li><Icon name="clock" /> Сессия действует 7 дней, потом нужно войти заново.</li>
            <li><Icon name="check" /> Смена пароля или удаление учителя сразу закрывает его вход.</li>
          </ul>
        </section>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api.js";
import Modal, { Field } from "../components/Modal.jsx";
import { waLink } from "../scoring.js";
import { v, first } from "../validate.js";

export default function Teachers() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api("/api/teachers").then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function save() {
    const err = first(v.person(edit.fullName, "Имя учителя"), v.login(edit.login), v.password(edit.password, !edit.id), v.phone(edit.phone, "Телефон"));
    if (err) return setError(err);
    setBusy(true); setError("");
    try {
      if (edit.id) await api(`/api/teachers/${edit.id}`, { method: "PUT", body: edit });
      else await api("/api/teachers", { method: "POST", body: edit });
      setEdit(null); load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(t) {
    if (!window.confirm(`Удалить учителя ${t.fullName}? Его группы останутся без учителя.`)) return;
    await api(`/api/teachers/${t.id}`, { method: "DELETE" }); load();
  }
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Суперадмин</div><h1>Учителя</h1><p>Создайте учителю логин и пароль, затем назначьте его в группу.</p></div>
        <button className="btn primary" onClick={() => { setError(""); setEdit({ fullName: "", login: "", password: "", phone: "" }); }}>+ Новый учитель</button>
      </div>
      {error && !edit && <div className="error">{error}</div>}
      {list && list.length === 0 ? (
        <div className="card empty"><h2>Учителей пока нет</h2><p>Нажмите «Новый учитель», чтобы добавить первого.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Имя</th><th>Логин</th><th>Телефон</th><th className="c">Групп</th><th></th></tr></thead>
            <tbody>
              {list?.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.fullName}</b></td>
                  <td className="num">{t.login}</td>
                  <td>{t.phone ? <a href={waLink(t.phone)} target="_blank" rel="noreferrer">{t.phone}</a> : <span className="muted">—</span>}</td>
                  <td className="c num">{t.groups}</td>
                  <td style={{ textAlign: "right" }}>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn sm" onClick={() => { setError(""); setEdit({ ...t, password: "", phone: t.phone || "" }); }}>Изменить</button>
                      <button className="btn sm ghost danger" onClick={() => remove(t)}>Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? "Учитель" : "Новый учитель"} onClose={() => setEdit(null)} onSubmit={save} error={error} busy={busy}>
          <div className="form-grid">
            <Field full label="Имя и фамилия" id="t-name" value={edit.fullName} onChange={set("fullName")} required maxLength={100} />
            <Field label="Логин" id="t-login" value={edit.login} onChange={set("login")} required autoComplete="off" maxLength={32} placeholder="например: azim" hint="Латиница, цифры, точка" />
            <Field label={edit.id ? "Новый пароль (если меняем)" : "Пароль"} id="t-pass" type="password" value={edit.password} onChange={set("password")} required={!edit.id} autoComplete="new-password" maxLength={128} placeholder="••••••••" hint="Минимум 8 символов: буквы и цифры" />
            <Field full label="Телефон / WhatsApp" id="t-phone" type="tel" value={edit.phone} onChange={set("phone")} placeholder="+992 90 123 45 67" maxLength={20} hint="Необязательно" />
          </div>
        </Modal>
      )}
    </>
  );
}

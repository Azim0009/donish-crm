import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, auth } from "../api.js";
import Modal, { Field } from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";
import { waLink, initials } from "../scoring.js";
import { v, first } from "../validate.js";

const blank = { fullName: "", phone: "", parentName: "", parentPhone: "", groupId: "" };

export default function Students() {
  const isAdmin = auth.user?.role === "admin";
  const [list, setList] = useState(null);
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState("");
  const [gf, setGf] = useState("");
  const [cf, setCf] = useState("");
  const [view, setView] = useState(() => { try { return localStorage.getItem("studentsView") || "grid"; } catch { return "grid"; } });
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api("/api/students"), api("/api/groups")]).then(([s, g]) => { setList(s); setGroups(g); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { try { localStorage.setItem("studentsView", view); } catch {} }, [view]);

  const courses = useMemo(() => [...new Set(groups.map((g) => g.course))], [groups]);
  const shown = useMemo(() => (list || []).filter((s) =>
    (!q || (s.fullName + " " + (s.phone || "")).toLowerCase().includes(q.toLowerCase())) &&
    (!gf || String(s.groupId) === gf) && (!cf || s.course === cf)), [list, q, gf, cf]);

  async function save() {
    const err = first(v.person(edit.fullName, "Имя ученика"), v.phone(edit.phone, "Телефон ученика"), v.person(edit.parentName, "Имя родителя", false), v.phone(edit.parentPhone, "WhatsApp родителя"));
    if (err) return setError(err);
    setBusy(true); setError("");
    try {
      if (!edit.groupId) throw new Error("Выберите группу");
      const body = { ...edit, groupId: Number(edit.groupId) };
      if (edit.id) await api(`/api/students/${edit.id}`, { method: "PUT", body });
      else await api(`/api/groups/${edit.groupId}/students`, { method: "POST", body });
      setEdit(null); load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(s) {
    if (!window.confirm(`Удалить ученика ${s.fullName} и все его баллы?`)) return;
    await api(`/api/students/${s.id}`, { method: "DELETE" }); load();
  }
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });
  const openNew = () => { setError(""); setEdit({ ...blank, groupId: gf || (groups[0]?.id ?? "") }); };

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">{isAdmin ? "Все ученики академии" : "Ученики моих групп"}</div><h1>Ученики</h1></div>
        <button className="btn primary" onClick={openNew} disabled={!groups.length}><Icon name="plus" /> Добавить ученика</button>
      </div>
      <div className="filters">
        <label className="search"><Icon name="search" /><input id="st-q" placeholder="Поиск ученика" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select id="st-g" value={gf} onChange={(e) => setGf(e.target.value)}><option value="">Все группы</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <select id="st-c" value={cf} onChange={(e) => setCf(e.target.value)}><option value="">Все курсы</option>{courses.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <div className="seg view-toggle">
          <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} title="Карточки" aria-label="Карточки"><Icon name="grid" /></button>
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")} title="Список" aria-label="Список"><Icon name="list" /></button>
        </div>
      </div>
      {error && !edit && <div className="error">{error}</div>}
      {list && !groups.length && <div className="card empty"><h2>Сначала нужна группа</h2><p>{isAdmin ? "Создайте группу во вкладке «Группы»." : "Суперадмин ещё не назначил вам группу."}</p></div>}
      {list && groups.length > 0 && shown.length === 0 && <div className="card empty"><h2>{list.length ? "Никого не нашли" : "Учеников пока нет"}</h2><p>{list.length ? "Измените поиск или фильтры." : "Нажмите «Добавить ученика»."}</p></div>}

      {view === "grid" ? (
        <div className="student-grid">
          {shown.map((s, i) => (
            <article key={s.id} className="card student-card" style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
              <div className="sc-top">
                <div>
                  <h3>{s.fullName}</h3>
                  <div className="sc-meta">
                    {s.phone && <span className="num">{s.phone}</span>}
                    {s.parentPhone && <a href={waLink(s.parentPhone)} target="_blank" rel="noreferrer">WhatsApp родителя</a>}
                  </div>
                </div>
                <span className="avatar lg">{initials(s.fullName)}</span>
              </div>
              <Link to={`/groups/${s.groupId}`} className="sc-group">
                <div><b>{s.groupName}</b><span>{s.schedule || s.course} · месяц {s.currentMonth}</span></div>
                <Icon name="chevron" className="rot" />
              </Link>
              <div className="sc-foot">
                <span>Статус: <b className="ok">Активен</b></span>
                <div className="row">
                  <button className="icon-btn" title="Изменить" onClick={() => { setError(""); setEdit({ ...s, phone: s.phone || "", parentName: s.parentName || "", parentPhone: s.parentPhone || "" }); }}><Icon name="edit" /></button>
                  <button className="icon-btn danger" title="Удалить" onClick={() => remove(s)}><Icon name="trash" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ученик</th><th>Телефон</th><th>Группа</th><th>Родитель</th><th></th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td><div className="who"><span className="avatar">{initials(s.fullName)}</span><b>{s.fullName}</b></div></td>
                  <td className="num">{s.phone || "—"}</td>
                  <td><Link to={`/groups/${s.groupId}`}>{s.groupName}</Link><div className="muted small">{s.schedule}</div></td>
                  <td>{s.parentName || "—"}{s.parentPhone && <div><a className="small num" href={waLink(s.parentPhone)} target="_blank" rel="noreferrer">{s.parentPhone}</a></div>}</td>
                  <td><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <button className="icon-btn" title="Изменить" onClick={() => { setError(""); setEdit({ ...s, phone: s.phone || "", parentName: s.parentName || "", parentPhone: s.parentPhone || "" }); }}><Icon name="edit" /></button>
                    <button className="icon-btn danger" title="Удалить" onClick={() => remove(s)}><Icon name="trash" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? "Ученик" : "Новый ученик"} onClose={() => setEdit(null)} onSubmit={save} error={error} busy={busy}>
          <div className="form-grid">
            <Field full label="Имя и фамилия" id="ns-name" value={edit.fullName} onChange={set("fullName")} required maxLength={100} />
            <Field label="Телефон ученика" id="ns-phone" type="tel" maxLength={20} value={edit.phone} onChange={set("phone")} placeholder="+992 90 123 45 67" />
            <Field label="Имя родителя" id="ns-parent" maxLength={100} value={edit.parentName} onChange={set("parentName")} />
            <Field label="WhatsApp родителя" id="ns-wa" type="tel" maxLength={20} value={edit.parentPhone} onChange={set("parentPhone")} placeholder="+992 93 765 43 21" hint="Сюда учитель отправляет недельный отчёт" />
            <Field as="select" label="Группа" id="ns-group" value={edit.groupId} onChange={set("groupId")} disabled={!!edit.id && !isAdmin}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name} · месяц {g.currentMonth}</option>)}
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, auth } from "../api.js";
import Modal, { Field, ScheduleInput } from "../components/Modal.jsx";
import { v, first } from "../validate.js";

const blank = { name: "", course: "Fullstack + AI", schedule: "", currentMonth: 1, startDate: "", teacherId: "" };

export default function Groups() {
  const isAdmin = auth.user?.role === "admin";
  const [groups, setGroups] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api("/api/groups").then(setGroups).catch((e) => setError(e.message));
  useEffect(() => { load(); if (isAdmin) api("/api/teachers").then(setTeachers).catch(() => {}); }, []);

  async function save() {
    const err = first(isAdmin && v.title(edit.name, "Название группы"), isAdmin && v.opt(edit.course, "Курс", 60), v.opt(edit.schedule, "Время занятий", 100));
    if (err) return setError(err);
    setBusy(true); setError("");
    const body = { ...edit, currentMonth: Number(edit.currentMonth), teacherId: edit.teacherId ? Number(edit.teacherId) : null, startDate: edit.startDate || null };
    try {
      if (edit.id) await api(`/api/groups/${edit.id}`, { method: "PUT", body });
      else await api("/api/groups", { method: "POST", body });
      setEdit(null); load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(g) {
    if (!window.confirm(`Удалить группу «${g.name}» вместе с учениками и баллами?`)) return;
    await api(`/api/groups/${g.id}`, { method: "DELETE" }); load();
  }
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{isAdmin ? "Все группы академии" : "Мои группы"}</div>
          <h1>Группы</h1>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => { setError(""); setEdit({ ...blank }); }}>+ Новая группа</button>}
      </div>
      {error && !edit && <div className="error">{error}</div>}
      {groups && groups.length === 0 && (
        <div className="card empty">
          <h2>Групп пока нет</h2>
          <p>{isAdmin ? "Создайте группу и назначьте учителя." : "Суперадмин ещё не назначил вам группу."}</p>
        </div>
      )}
      <div className="grid-cards">
        {groups?.map((g) => (
          <div key={g.id} className="card group-card">
            <Link to={`/groups/${g.id}`} style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2>{g.name}</h2>
                <span className="chip month">Месяц {g.currentMonth}</span>
              </div>
              <dl className="kv" style={{ margin: 0 }}>
                <dt>Курс</dt><dd>{g.course}</dd>
                <dt>Учитель</dt><dd>{g.teacherName || <span className="muted">не назначен</span>}</dd>
                <dt>Время</dt><dd>{g.schedule || <span className="muted">не указано</span>}</dd>
                <dt>Учеников</dt><dd className="num">{g.students}</dd>
              </dl>
            </Link>
            <div className="row">
              <Link className="btn sm primary" to={`/groups/${g.id}`}>Открыть журнал</Link>
              <button className="btn sm" onClick={() => { setError(""); setEdit({ ...blank, ...g, teacherId: g.teacherId ?? "", startDate: g.startDate ? g.startDate.slice(0, 10) : "", schedule: g.schedule || "" }); }}>Изменить</button>
              {isAdmin && <button className="btn sm ghost danger" onClick={() => remove(g)}>Удалить</button>}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title={edit.id ? "Настройки группы" : "Новая группа"}
          subtitle={isAdmin ? "Название, учитель и расписание. Поля со * обязательны." : "Вы можете изменить расписание и текущий месяц."}
          onClose={() => setEdit(null)} onSubmit={save} error={error} busy={busy} submitText={edit.id ? "Сохранить" : "Создать группу"} wide>
          <div className="form-grid">
            {isAdmin && <Field full required label="Название группы" id="g-name" value={edit.name} onChange={set("name")} placeholder="Например: FS-01 после обеда" maxLength={60} hint="Как группу будут видеть учителя и в отчётах" />}
            {isAdmin && (
              <Field as="select" label="Учитель" id="g-teacher" value={edit.teacherId} onChange={set("teacherId")} hint={teachers.length ? "Можно назначить позже" : "Сначала создайте учителя во вкладке «Учителя»"}>
                <option value="">Не назначен</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
              </Field>
            )}
            {isAdmin && <Field label="Курс" id="g-course" value={edit.course} onChange={set("course")} maxLength={60} placeholder="Fullstack + AI" />}
            <ScheduleInput value={edit.schedule} onChange={(val) => setEdit({ ...edit, schedule: val })} />
            <Field as="select" label="Текущий месяц" id="g-month" value={edit.currentMonth} onChange={set("currentMonth")} hint="Обычно меняется кнопкой «Завершить месяц»">
              <option value={1}>Месяц 1 · Frontend</option>
              <option value={2}>Месяц 2 · Backend</option>
              <option value={3}>Месяц 3 · Проект</option>
            </Field>
            {isAdmin && <Field label="Дата старта" id="g-start" type="date" value={edit.startDate} onChange={set("startDate")} hint="Первый урок группы" />}
          </div>
        </Modal>
      )}
    </>
  );
}

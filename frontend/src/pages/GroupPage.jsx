import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, auth } from "../api.js";
import Modal, { Field } from "../components/Modal.jsx";
import { GroupReport, StudentCard, downloadPng } from "../components/Reports.jsx";
import ScoreChart from "../components/ScoreChart.jsx";
import Icon from "../components/Icon.jsx";
import { v, first } from "../validate.js";
import { MAX, PASS, EXTRA_MIN, WEEKS, weekTotal, weekParts, monthResult, waLink, hasData, initials } from "../scoring.js";

const KEYS = ["a1", "a2", "a3", "h1", "h2", "h3", "bonus", "exam"];

export default function GroupPage() {
  const { id } = useParams();
  const isAdmin = auth.user?.role === "admin";
  const [group, setGroup] = useState(null);
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [tab, setTab] = useState("journal");
  const [month, setMonth] = useState(1);
  const [scores, setScores] = useState({}); // `${studentId}-${week}` -> row
  const [extra, setExtra] = useState({});   // studentId -> {passed}
  const [error, setError] = useState("");

  const loadGroup = useCallback(async () => {
    const all = await api("/api/groups");
    setGroups(all);
    const g = all.find((x) => String(x.id) === String(id));
    setGroup(g || false);
    return g;
  }, [id]);
  const loadStudents = useCallback(() => api(`/api/groups/${id}/students`).then(setStudents), [id]);
  const loadScores = useCallback(async (m) => {
    const r = await api(`/api/groups/${id}/scores?month=${m}`);
    const map = {};
    r.weeks.forEach((w) => { map[`${w.studentId}-${w.week}`] = w; });
    const ex = {};
    r.extra.forEach((e) => { ex[e.studentId] = e; });
    setScores(map); setExtra(ex);
  }, [id]);

  useEffect(() => {
    loadGroup().then((g) => { if (g) setMonth(g.currentMonth); }).catch((e) => setError(e.message));
    loadStudents().catch((e) => setError(e.message));
  }, [loadGroup, loadStudents]);
  useEffect(() => { loadScores(month).catch((e) => setError(e.message)); }, [month, loadScores]);

  if (group === false) return <div className="card empty"><h2>Группа не найдена</h2><Link to="/groups">Назад к группам</Link></div>;
  if (!group) return <p className="muted">Загрузка…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link to="/groups" style={{ color: "inherit" }}>Группы</Link> / {group.course}</div>
          <h1>{group.name}</h1>
          <p>{group.teacherName ? `Учитель: ${group.teacherName}` : "Учитель не назначен"} · {group.schedule || "время не указано"} · <span className="num">{students.length}</span> учеников</p>
        </div>
        <div className="row">
          <span className="eyebrow">Месяц</span>
          <div className="seg">
            {[1, 2, 3].map((m) => (
              <button key={m} className={m === month ? "on" : ""} disabled={m > group.currentMonth} onClick={() => setMonth(m)}
                title={m > group.currentMonth ? "Месяц ещё не начался — сначала завершите текущий" : m < group.currentMonth ? "Прошедший месяц" : "Текущий месяц"}>
                {m > group.currentMonth ? <Icon name="lock" size={12} /> : null} {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="tabs">
        <button className={tab === "journal" ? "on" : ""} onClick={() => setTab("journal")}>Журнал</button>
        <button className={tab === "summary" ? "on" : ""} onClick={() => setTab("summary")}>Итоги месяца</button>
        <button className={tab === "students" ? "on" : ""} onClick={() => setTab("students")}>Ученики</button>
      </div>
      {tab === "journal" && <Journal {...{ group, students, month, scores, setScores, extra, setError }} goStudents={() => setTab("students")} />}
      {tab === "summary" && <Summary {...{ group, groups, isAdmin, students, month, scores, extra, setExtra, setError }}
        onFinished={async (newMonth) => { await loadGroup(); await loadStudents(); setMonth(newMonth); setTab("journal"); }} />}
      {tab === "students" && <Students {...{ group, groups, students, isAdmin, reload: loadStudents }} />}
    </>
  );
}

/* ================= ЖУРНАЛ: график + 4 недели ================= */
function Journal({ group, students, month, scores, setScores, extra, setError, goStudents }) {
  const timers = useRef({});
  const [saving, setSaving] = useState({});
  const [open, setOpen] = useState(() => new Set([1]));
  const [card, setCard] = useState(null);
  const [repWeek, setRepWeek] = useState(1);
  const [busyPng, setBusyPng] = useState(false);
  const reportRef = useRef(null);
  const cardRef = useRef(null);

  function change(sid, week, key, value) {
    const k = `${sid}-${week}`;
    const row = { ...(scores[k] || { studentId: sid, month, week }), [key]: value };
    setScores((s) => ({ ...s, [k]: row }));
    setSaving((s) => ({ ...s, [k]: "…" }));
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(async () => {
      try {
        const body = { studentId: sid, month, week };
        KEYS.forEach((x) => { body[x] = typeof row[x] === "number" ? row[x] : null; });
        await api("/api/scores", { method: "PUT", body });
        setSaving((s) => ({ ...s, [k]: "✓" }));
      } catch (e) { setError(e.message); setSaving((s) => ({ ...s, [k]: "!" })); }
    }, 500);
  }
  const num = (v, max) => (v === "" ? null : Math.max(0, Math.min(max, parseInt(v, 10) || 0)));
  const toggle = (w) => setOpen((o) => { const n = new Set(o); n.has(w) ? n.delete(w) : n.add(w); return n; });
  const weeksOf = (sid) => Array.from({ length: WEEKS }, (_, i) => scores[`${sid}-${i + 1}`] || null);

  async function pngGroup(w) {
    setRepWeek(w); setBusyPng(true);
    await new Promise((r) => setTimeout(r, 60));
    try { await downloadPng(reportRef.current, `${group.name}_месяц${month}_неделя${w}.png`); } finally { setBusyPng(false); }
  }
  async function pngStudent(s, w) {
    setCard(s); setRepWeek(w); setBusyPng(true);
    await new Promise((r) => setTimeout(r, 60));
    try { await downloadPng(cardRef.current, `${s.fullName}_месяц${month}_неделя${w}.png`); } finally { setBusyPng(false); }
  }

  if (!students.length) return <div className="card empty"><h2>В группе пока нет учеников</h2><p>Добавьте учеников, и журнал на 4 недели откроется автоматически.</p><button className="btn primary" onClick={goStudents}>Добавить учеников</button></div>;

  return (
    <>
      <ScoreChart students={students} scores={scores} extra={extra} />
      <div className="rules" style={{ marginTop: 18 }}>
        <span>Посещение: 2 пришёл · 1 опоздал · 0 нет</span>
        <span>ДЗ: 0–10</span><span>Бонус: 0–14</span><span>Экзамен недели: 0–50</span><span>Неделя: 100 баллов</span>
      </div>
      <div className="weeks">
        {[1, 2, 3, 4].map((w) => {
          const rows = students.map((s) => scores[`${s.id}-${w}`]).filter(hasData);
          const avg = rows.length ? Math.round(rows.reduce((t, r) => t + weekTotal(r), 0) / rows.length) : null;
          const isOpen = open.has(w);
          return (
            <section key={w} className={"week card" + (isOpen ? " open" : "")}>
              <button className="week-head" onClick={() => toggle(w)} aria-expanded={isOpen}>
                <span className="week-title">Неделя {w}</span>
                <span className="muted small">уроки {(w - 1) * 3 + 1}–{w * 3}</span>
                <span className="week-meta">
                  {avg != null ? <span className="chip month">средний {avg}</span> : <span className="chip progress">не заполнена</span>}
                  <span className="muted small num">{rows.length}/{students.length}</span>
                  <Icon name="chevron" className="chev" />
                </span>
              </button>
              <div className="week-body"><div>
                <div className="week-tools">
                  <button className="btn sm" onClick={() => pngGroup(w)} disabled={busyPng}><Icon name="download" /> Отчёт недели (PNG)</button>
                </div>
                <div className="table-wrap flat">
                  <table className="journal">
                    <thead>
                      <tr>
                        <th className="sticky-col">Ученик</th>
                        {[1, 2, 3].map((l) => <th key={l} className="c lesson-head">Урок {(w - 1) * 3 + l}<div className="sub">посещение · ДЗ</div></th>)}
                        <th className="c lesson-head">Бонус<div className="sub">0–14</div></th>
                        <th className="c">Экзамен<div className="sub">0–50</div></th>
                        <th className="c">Итого</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s, i) => {
                        const k = `${s.id}-${w}`;
                        const row = scores[k] || {};
                        const total = weekTotal(row);
                        return (
                          <tr key={s.id} className={i % 2 ? "odd" : ""}>
                            <td className="sticky-col">
                              <div className="who"><span className="avatar">{initials(s.fullName)}</span><b>{s.fullName}</b></div>
                              <div className="row" style={{ flexWrap: "nowrap", marginTop: 6, gap: 6 }}>
                                <button className="btn xs" title="Скачать карточку для родителей" onClick={() => pngStudent(s, w)} disabled={busyPng}><Icon name="download" /> Карточка</button>
                                {waLink(s.parentPhone) && (
                                  <a className="btn xs wa" target="_blank" rel="noreferrer"
                                    href={`${waLink(s.parentPhone)}?text=${encodeURIComponent(parentText(s, group, month, w, row, weeksOf(s.id), extra[s.id]))}`}>WhatsApp</a>
                                )}
                                <span className="save-dot">{saving[k] === "…" ? "…" : saving[k] === "✓" ? "✓" : saving[k] === "!" ? "ошибка" : ""}</span>
                              </div>
                            </td>
                            {[1, 2, 3].map((l) => (
                              <td key={l} className="c lesson">
                                <div className="cell">
                                  <div className="att" role="group" aria-label={`Посещение, урок ${l}`}>
                                    {[[2, "p", "Пришёл"], [1, "l", "Опоздал"], [0, "a", "Не пришёл"]].map(([v, c, t]) => (
                                      <button key={v} type="button" title={t} className={(row[`a${l}`] === v ? "on " : "") + c}
                                        onClick={() => change(s.id, w, `a${l}`, row[`a${l}`] === v ? null : v)}>{v}</button>
                                    ))}
                                  </div>
                                  <input className="score" id={`h-${s.id}-${w}-${l}`} inputMode="numeric" placeholder="ДЗ" title="Домашнее задание 0–10"
                                    value={row[`h${l}`] ?? ""} onChange={(e) => change(s.id, w, `h${l}`, num(e.target.value, MAX.hw))} />
                                </div>
                              </td>
                            ))}
                            <td className="c lesson"><input className="score" id={`b-${s.id}-${w}`} inputMode="numeric" placeholder="0" value={row.bonus ?? ""} onChange={(e) => change(s.id, w, "bonus", num(e.target.value, MAX.bonus))} /></td>
                            <td className="c"><input className="score exam" id={`e-${s.id}-${w}`} inputMode="numeric" placeholder="0" value={row.exam ?? ""} onChange={(e) => change(s.id, w, "exam", num(e.target.value, MAX.exam))} /></td>
                            <td className="c"><span className={"total " + (hasData(row) ? (total >= PASS ? "t-pass" : total >= EXTRA_MIN ? "t-extra" : "t-fail") : "")}>{hasData(row) ? total : "—"}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div></div>
            </section>
          );
        })}
      </div>
      <p className="muted small">Баллы сохраняются сами. «Карточка» — картинка для родителей: скачайте и отправьте в WhatsApp.</p>
      <div className="report-stage" aria-hidden="true">
        <div ref={reportRef}><GroupReport group={group} students={students} month={month} week={repWeek} scores={scores} /></div>
        <div ref={cardRef}>{card && <StudentCard group={group} student={card} month={month} week={repWeek} row={scores[`${card.id}-${repWeek}`]} weeks={weeksOf(card.id)} extra={extra[card.id]} />}</div>
      </div>
    </>
  );
}


function parentText(s, group, month, week, row, weeks, extra) {
  const p = weekParts(row);
  const r = monthResult(weeks, extra);
  return `Ассалому алейкум! Donish Academy, группа ${group.name}.
${s.fullName} — баллы за ${week}-ю неделю ${month}-го месяца: ${weekTotal(row)} из 100.
Посещение ${p.att}/6 · ДЗ ${p.hw}/30 · Бонус ${p.bonus}/14 · Экзамен ${p.exam}/50.
Средний балл за месяц сейчас: ${r.pace ?? 0}. Для перехода на следующий месяц нужно 80.`;
}

/* ================= ИТОГИ МЕСЯЦА ================= */
function Summary({ group, groups, isAdmin, students, month, scores, extra, setExtra, setError, onFinished }) {
  const [finish, setFinish] = useState(false);
  const rows = useMemo(() => students.map((s) => {
    const weeks = Array.from({ length: WEEKS }, (_, i) => scores[`${s.id}-${i + 1}`] || null);
    return { s, ...monthResult(weeks, extra[s.id]) };
  }).sort((a, b) => b.avg - a.avg), [students, scores, extra]);

  const count = (k) => rows.filter((r) => r.status.key === k).length;
  const groupAvg = rows.length ? Math.round(rows.reduce((t, r) => t + (r.pace ?? 0), 0) / rows.length) : 0;

  async function setPassed(sid, passed) {
    try {
      await api("/api/extra-exam", { method: "PUT", body: { studentId: sid, month, passed } });
      setExtra((e) => { const n = { ...e }; if (passed === null) delete n[sid]; else n[sid] = { studentId: sid, month, passed }; return n; });
    } catch (e) { setError(e.message); }
  }

  if (!students.length) return <div className="card empty"><h2>Нет учеников</h2><p>Добавьте учеников во вкладке «Ученики».</p></div>;

  return (
    <>
      <div className="stats">
        <div className="card stat"><b>{groupAvg}</b><span>средний темп группы</span></div>
        <div className="card stat"><b style={{ color: "var(--pass)" }}>{count("pass")}</b><span>переходят (80+)</span></div>
        <div className="card stat"><b style={{ color: "var(--extra)" }}>{count("extra")}</b><span>доп. экзамен (75–79)</span></div>
        <div className="card stat"><b style={{ color: "var(--fail)" }}>{count("fail")}</b><span>повтор месяца</span></div>
      </div>
      <div className="rules">
        <span>Итог месяца = сумма 4 недель ÷ 4</span><span>≥ {PASS} — следующий месяц</span><span>{EXTRA_MIN}–{PASS - 1} — доп. экзамен</span><span>&lt; {EXTRA_MIN} — повтор месяца {month}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th className="sticky-col">Ученик</th>{[1, 2, 3, 4].map((w) => <th key={w} className="c">Нед. {w}</th>)}<th className="c">Средний</th><th style={{ minWidth: 120 }}>Темп</th><th>Статус</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s.id}>
                <td className="sticky-col"><b>{r.s.fullName}</b></td>
                {r.totals.map((t, i) => <td key={i} className="c num">{t ?? <span className="muted">—</span>}</td>)}
                <td className="c"><span className="total">{r.done ? r.avg : "—"}</span></td>
                <td>
                  <div className="small muted num">{r.pace ?? "—"}{r.pace != null && " / 100"}</div>
                  <div className="bar"><i style={{ width: `${Math.min(100, r.pace ?? 0)}%`, background: (r.pace ?? 0) >= PASS ? "var(--pass)" : (r.pace ?? 0) >= EXTRA_MIN ? "var(--extra)" : "var(--fail)" }} /></div>
                </td>
                <td>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <span className={"chip " + r.status.key}>{r.status.label}</span>
                    {r.done && r.avg >= EXTRA_MIN && r.avg < PASS && (
                      extra[r.s.id] ? <button className="btn sm ghost" onClick={() => setPassed(r.s.id, null)}>Сбросить</button> : (
                        <>
                          <button className="btn sm" onClick={() => setPassed(r.s.id, true)}>Сдал</button>
                          <button className="btn sm ghost danger" onClick={() => setPassed(r.s.id, false)}>Не сдал</button>
                        </>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">«Темп» — средний балл по уже заполненным неделям. Итоговый статус появляется, когда заполнены все 4 недели.</p>
      {month === group.currentMonth && month < 3 && (
        <div className="card pad finish-box">
          <div>
            <h2>Завершить месяц {month}</h2>
            <p className="muted" style={{ margin: "4px 0 0" }}>Группа перейдёт на месяц {month + 1}. Ученики 80+ остаются, ученики на повторе переводятся в другую группу.</p>
          </div>
          <button className="btn primary" onClick={() => setFinish(true)}>Завершить месяц {month}</button>
        </div>
      )}
      {finish && <FinishMonth {...{ group, groups, isAdmin, rows, month }} onClose={() => setFinish(false)} onDone={onFinished} />}
    </>
  );
}

/* ================= УЧЕНИКИ ================= */
function Students({ group, groups, students, isAdmin, reload }) {
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  async function save() {
    const err = first(v.person(edit.fullName, "Имя ученика"), v.phone(edit.phone, "Телефон ученика"), v.person(edit.parentName, "Имя родителя", false), v.phone(edit.parentPhone, "WhatsApp родителя"));
    if (err) return setError(err);
    setBusy(true); setError("");
    const body = { ...edit, groupId: edit.groupId ? Number(edit.groupId) : null };
    try {
      if (edit.id) await api(`/api/students/${edit.id}`, { method: "PUT", body });
      else await api(`/api/groups/${group.id}/students`, { method: "POST", body });
      setEdit(null); reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(s) {
    if (!window.confirm(`Удалить ученика ${s.fullName} и все его баллы?`)) return;
    await api(`/api/students/${s.id}`, { method: "DELETE" }); reload();
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h2>Ученики · <span className="num">{students.length}</span></h2>
        <button className="btn primary" onClick={() => { setError(""); setEdit({ fullName: "", phone: "", parentName: "", parentPhone: "", groupId: group.id }); }}>+ Добавить ученика</button>
      </div>
      {students.length === 0 ? (
        <div className="card empty"><h2>Список пуст</h2><p>Добавьте первого ученика: имя, его номер и WhatsApp родителей.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ученик</th><th>Телефон</th><th>Родитель</th><th>WhatsApp родителя</th><th></th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.fullName}</b></td>
                  <td className="num">{s.phone || <span className="muted">—</span>}</td>
                  <td>{s.parentName || <span className="muted">—</span>}</td>
                  <td>{waLink(s.parentPhone) ? <a className="num" href={waLink(s.parentPhone)} target="_blank" rel="noreferrer">{s.parentPhone}</a> : <span className="muted">—</span>}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <button className="btn sm" onClick={() => { setError(""); setEdit({ ...s, phone: s.phone || "", parentName: s.parentName || "", parentPhone: s.parentPhone || "" }); }}>Изменить</button>
                      <button className="btn sm ghost danger" onClick={() => remove(s)}>Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? "Ученик" : "Новый ученик"} onClose={() => setEdit(null)} onSubmit={save} error={error} busy={busy}>
          <div className="form-grid">
            <Field full label="Имя и фамилия" id="s-name" value={edit.fullName} onChange={set("fullName")} required maxLength={100} />
            <Field label="Телефон ученика" id="s-phone" type="tel" maxLength={20} value={edit.phone} onChange={set("phone")} placeholder="+992 90 123 45 67" />
            <Field label="Имя родителя" id="s-parent" maxLength={100} value={edit.parentName} onChange={set("parentName")} />
            <Field full label="WhatsApp родителя" id="s-wa" type="tel" maxLength={20} value={edit.parentPhone} onChange={set("parentPhone")} placeholder="+992 93 765 43 21" hint="Сюда учитель отправляет недельный отчёт" />
            {isAdmin && edit.id && (
              <Field as="select" full label="Группа (перевод, например, на повтор месяца)" id="s-group" value={edit.groupId} onChange={set("groupId")}>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} · месяц {g.currentMonth}</option>)}
              </Field>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/* ================= ЗАВЕРШЕНИЕ МЕСЯЦА ================= */
function FinishMonth({ group, groups, isAdmin, rows, month, onClose, onDone }) {
  const pass = rows.filter((r) => r.status.key === "pass");
  const extra = rows.filter((r) => r.status.key === "extra");
  const fail = rows.filter((r) => r.status.key === "fail");
  const progress = rows.filter((r) => r.status.key === "progress");
  const targets = groups.filter((g) => g.id !== group.id && g.currentMonth === month);
  const [dest, setDest] = useState(() => Object.fromEntries(fail.map((r) => [r.s.id, ""])));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const blocker = extra.length ? "Сначала отметьте результат доп. экзамена (Сдал / Не сдал) у учеников 75–79."
    : progress.length ? "Не у всех учеников заполнены 4 недели. Заполните журнал до конца."
    : fail.length && !isAdmin ? "Есть ученики на повтор — перевести их в другую группу может только суперадмин." : "";

  async function submit() {
    if (blocker) return setError(blocker);
    setBusy(true); setError("");
    try {
      const transfers = fail.map((r) => ({ studentId: r.s.id, groupId: dest[r.s.id] ? Number(dest[r.s.id]) : null }));
      const res = await api(`/api/groups/${group.id}/finish-month`, { method: "POST", body: { transfers } });
      onClose(); onDone(res.currentMonth);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Завершить месяц ${month}`} onClose={onClose} onSubmit={submit} error={error || blocker} busy={busy} submitText={`Перейти на месяц ${month + 1}`}>
      <div className="fin-list">
        <div className="fin-sec"><span className="chip pass">Переходят · {pass.length}</span>
          <p className="small">{pass.map((r) => r.s.fullName).join(", ") || "—"}</p></div>
        {extra.length > 0 && <div className="fin-sec"><span className="chip extra">Доп. экзамен не отмечен · {extra.length}</span>
          <p className="small">{extra.map((r) => r.s.fullName).join(", ")}</p></div>}
        {progress.length > 0 && <div className="fin-sec"><span className="chip progress">Журнал не заполнен · {progress.length}</span>
          <p className="small">{progress.map((r) => r.s.fullName).join(", ")}</p></div>}
        <div className="fin-sec"><span className="chip fail">Повтор месяца {month} · {fail.length}</span>
          {fail.length === 0 ? <p className="small muted">Нет — все молодцы</p> : fail.map((r) => (
            <div key={r.s.id} className="fin-row">
              <span><b>{r.s.fullName}</b> <span className="muted num">· {r.avg}</span></span>
              {isAdmin && (
                <select id={`dest-${r.s.id}`} value={dest[r.s.id]} onChange={(e) => setDest({ ...dest, [r.s.id]: e.target.value })}>
                  <option value="">Новая группа «{group.name} · повтор {month}»</option>
                  {targets.map((g) => <option key={g.id} value={g.id}>{g.name} · месяц {g.currentMonth}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Баллы месяца {month} сохранятся в истории группы. Ученики на повторе начнут месяц {month} с чистого журнала.</p>
    </Modal>
  );
}

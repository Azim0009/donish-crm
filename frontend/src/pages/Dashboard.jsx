import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import Icon from "../components/Icon.jsx";
import { monthResult, todayAttendance, initials, PASS, EXTRA_MIN } from "../scoring.js";

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => api("/api/overview").then(setD).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 60000); // обновляем раз в минуту
    return () => clearInterval(t);
  }, []);

  const view = useMemo(() => {
    if (!d) return null;
    const byKey = {};
    d.scores.forEach((w) => { byKey[`${w.studentId}-${w.week}`] = w; });
    const today = todayAttendance(d.scores);
    const people = d.students.map((s) => {
      const r = monthResult([1, 2, 3, 4].map((w) => byKey[`${s.id}-${w}`] || null));
      return { ...s, pace: r.pace, today: today.has(s.id) ? today.get(s.id) : null };
    });
    const groups = d.groups.map((g) => {
      const st = people.filter((p) => p.groupId === g.id);
      const paced = st.filter((p) => p.pace != null);
      return {
        ...g, st,
        avg: paced.length ? Math.round(paced.reduce((t, p) => t + p.pace, 0) / paced.length) : null,
        pass: paced.filter((p) => p.pace >= PASS).length,
        extra: paced.filter((p) => p.pace >= EXTRA_MIN && p.pace < PASS).length,
        fail: paced.filter((p) => p.pace < EXTRA_MIN).length,
        marked: st.filter((p) => p.today != null).length,
      };
    });
    const present = people.filter((p) => p.today === 2).length;
    const late = people.filter((p) => p.today === 1).length;
    const absent = people.filter((p) => p.today === 0).length;
    const top = people.filter((p) => p.pace != null).sort((a, b) => b.pace - a.pace).slice(0, 6);
    return { groups, people, present, late, absent, top };
  }, [d]);

  const date = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Суперадмин · {date}</div><h1>Обзор академии</h1></div>
        <Link className="btn primary" to="/groups"><Icon name="grid" /> Все группы</Link>
      </div>
      {error && <div className="error">{error}</div>}
      {!view ? <p className="muted">Загрузка…</p> : (
        <>
          <div className="stats">
            <div className="card stat"><Icon name="grid" size={20} className="stat-ico" /><b>{d.groups.length}</b><span>групп</span></div>
            <div className="card stat"><Icon name="users" size={20} className="stat-ico" /><b>{d.students.length}</b><span>учеников</span></div>
            <div className="card stat"><Icon name="user" size={20} className="stat-ico" /><b>{d.teachers}</b><span>учителей</span></div>
            <div className="card stat"><Icon name="check" size={20} className="stat-ico ok" /><b style={{ color: "var(--pass)" }}>{view.present + view.late}</b><span>пришли сегодня · {view.late} опоздали · {view.absent} нет</span></div>
          </div>

          <div className="dash-grid">
            <section className="card pad">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <h2>Сегодня</h2><span className="muted small">по отметкам учителей</span>
              </div>
              {view.groups.length === 0 && <p className="muted">Групп пока нет.</p>}
              <div className="today-list">
                {view.groups.map((g) => (
                  <div key={g.id} className="today-group">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <Link to={`/groups/${g.id}`}><b>{g.name}</b></Link>
                      <span className="muted small">{g.teacherName || "без учителя"} · {g.schedule || "время не указано"}</span>
                    </div>
                    {g.marked === 0 ? <div className="muted small" style={{ marginTop: 6 }}>Сегодня ещё не отмечено</div> : (
                      <div className="people">
                        {g.st.map((p) => (
                          <span key={p.id} className={"person " + (p.today === 2 ? "p" : p.today === 1 ? "l" : p.today === 0 ? "a" : "n")} title={p.today === 2 ? "Пришёл" : p.today === 1 ? "Опоздал" : p.today === 0 ? "Не пришёл" : "Не отмечен"}>
                            <i>{initials(p.fullName)}</i>{p.fullName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section className="card pad">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}><h2>Лучшие ученики</h2><Icon name="award" size={18} /></div>
              {view.top.length === 0 ? <p className="muted">Баллов пока нет.</p> : (
                <ol className="legend static">
                  {view.top.map((p, i) => (
                    <li key={p.id}><span className="pos num">{i + 1}</span><span className="nm">{p.fullName}<span className="muted small"> · {d.groups.find((g) => g.id === p.groupId)?.name}</span></span><b className="num" style={{ color: p.pace >= PASS ? "var(--pass)" : p.pace >= EXTRA_MIN ? "var(--extra)" : "var(--fail)" }}>{p.pace}</b></li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <h2 style={{ margin: "26px 0 12px" }}>Группы</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Группа</th><th>Учитель</th><th className="c">Месяц</th><th className="c">Учеников</th><th style={{ minWidth: 140 }}>Средний балл</th><th className="c">80+</th><th className="c">75–79</th><th className="c">&lt;75</th></tr></thead>
              <tbody>
                {view.groups.map((g) => (
                  <tr key={g.id}>
                    <td><Link to={`/groups/${g.id}`}><b>{g.name}</b></Link><div className="muted small">{g.schedule}</div></td>
                    <td>{g.teacherName || <span className="muted">не назначен</span>}</td>
                    <td className="c num">{g.currentMonth}</td>
                    <td className="c num">{g.st.length}</td>
                    <td>{g.avg == null ? <span className="muted">—</span> : <><span className="num"><b>{g.avg}</b></span><div className="bar"><i style={{ width: `${g.avg}%`, background: g.avg >= PASS ? "var(--pass)" : g.avg >= EXTRA_MIN ? "var(--extra)" : "var(--fail)" }} /></div></>}</td>
                    <td className="c num" style={{ color: "var(--pass)" }}>{g.pass}</td>
                    <td className="c num" style={{ color: "var(--extra)" }}>{g.extra}</td>
                    <td className="c num" style={{ color: "var(--fail)" }}>{g.fail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

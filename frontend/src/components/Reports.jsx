import { toPng } from "html-to-image";
import { weekParts, weekTotal, hasData, monthResult, PASS } from "../scoring.js";

export async function downloadPng(node, filename) {
  if (!node) return;
  const url = await toPng(node.firstElementChild || node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const today = () => new Date().toLocaleDateString("ru-RU");

function Head({ title, sub, group }) {
  return (
    <div className="report-head">
      <div>
        <div className="brand"><i>D</i>Donish Academy</div>
        <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800 }}>{title}</div>
        <div style={{ color: "#5d6c66", marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ textAlign: "right", fontSize: 13, color: "#5d6c66" }}>
        <div><b style={{ color: "#12201b" }}>{group.name}</b></div>
        <div>{group.course}</div>
        {group.teacherName && <div>Учитель: {group.teacherName}</div>}
      </div>
    </div>
  );
}

const color = (t) => (t >= PASS ? "#11804f" : t >= 75 ? "#a86200" : "#c0392b");

// Таблица всей группы за неделю
export function GroupReport({ group, students, month, week, scores }) {
  const rows = students.map((s) => ({ s, row: scores[`${s.id}-${week}`] })).sort((a, b) => weekTotal(b.row) - weekTotal(a.row));
  return (
    <div className="report">
      <Head group={group} title={`Итоги ${week}-й недели · месяц ${month}`} sub={`Натиҷаҳои ҳафтаи ${week} · моҳи ${month}`} />
      <table>
        <thead>
          <tr><th>№</th><th>Ученик</th><th style={{ textAlign: "center" }}>Посещение<br />/6</th><th style={{ textAlign: "center" }}>ДЗ<br />/30</th><th style={{ textAlign: "center" }}>Бонус<br />/14</th><th style={{ textAlign: "center" }}>Экзамен<br />/50</th><th style={{ textAlign: "center" }}>Итого<br />/100</th></tr>
        </thead>
        <tbody>
          {rows.map(({ s, row }, i) => {
            const p = weekParts(row), t = weekTotal(row);
            return (
              <tr key={s.id}>
                <td>{i + 1}</td>
                <td><b>{s.fullName}</b></td>
                <td style={{ textAlign: "center" }}>{p.att}</td>
                <td style={{ textAlign: "center" }}>{p.hw}</td>
                <td style={{ textAlign: "center" }}>{p.bonus}</td>
                <td style={{ textAlign: "center" }}>{p.exam}</td>
                <td style={{ textAlign: "center", fontWeight: 800, fontSize: 16, color: hasData(row) ? color(t) : "#8a9892" }}>{hasData(row) ? t : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="foot"><span>Для перехода на следующий месяц нужно в среднем 80 баллов · Барои гузариш ба моҳи оянда ба ҳисоби миёна 80 хол лозим аст</span><span>{today()}</span></div>
    </div>
  );
}

// Карточка одного ученика для родителей
export function StudentCard({ group, student, month, week, row, weeks, extra }) {
  const p = weekParts(row), t = weekTotal(row);
  const r = monthResult(weeks, extra);
  const items = [
    ["Посещение", "Ҳозиршавӣ", p.att, 6],
    ["Домашние задания", "Вазифаи хонагӣ", p.hw, 30],
    ["Бонусы", "Холҳои иловагӣ", p.bonus, 14],
    ["Экзамен недели", "Имтиҳони ҳафта", p.exam, 50],
  ];
  return (
    <div className="report narrow">
      <Head group={group} title={student.fullName} sub={`Неделя ${week} · месяц ${month} — Ҳафтаи ${week} · моҳи ${month}`} />
      <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 18 }}>
        <div className="big" style={{ color: color(t) }}>{t}</div>
        <div style={{ fontSize: 15, color: "#5d6c66" }}>баллов из 100 за неделю<br /><i>хол аз 100 барои ҳафта</i></div>
      </div>
      <table>
        <tbody>
          {items.map(([ru, tj, v, m]) => (
            <tr key={ru}>
              <td><b>{ru}</b><div style={{ fontSize: 12, color: "#6a7a73", fontStyle: "italic" }}>{tj}</div></td>
              <td style={{ width: 200 }}>
                <div style={{ height: 8, background: "#eef4f1", borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${(v / m) * 100}%`, height: "100%", background: "#0e7a54" }} /></div>
              </td>
              <td style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{v} / {m}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: "#f3f7f5", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, color: "#5d6c66" }}>Средний балл за месяц (недели 1–{r.filled || 0})<br /><i>Холи миёнаи моҳ</i></div>
          <div style={{ fontSize: 26, fontWeight: 800, color: color(r.pace ?? 0) }}>{r.pace ?? 0}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 13, color: "#5d6c66", maxWidth: 240 }}>
          Нужно 80 баллов для перехода на следующий месяц<br /><i>Барои гузариш ба моҳи оянда 80 хол лозим</i>
        </div>
      </div>
      <div className="foot"><span>Donish Academy · CRM Donish</span><span>{today()}</span></div>
    </div>
  );
}

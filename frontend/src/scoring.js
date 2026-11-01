// Правила баллов CRM Donish
// Неделя = 3 урока, максимум 100:
//   посещение 3 × 2 = 6 · ДЗ 3 × 10 = 30 · бонус до 14 · экзамен недели до 50
// Месяц = среднее за 4 недели:  ≥ 80 — переходит · 75–79 — доп. экзамен · < 75 — повтор месяца
export const MAX = { att: 2, hw: 10, bonus: 14, exam: 50, week: 100 };
export const PASS = 80, EXTRA_MIN = 75, WEEKS = 4, MONTHS = 3;

const n = (v) => (typeof v === "number" ? v : 0);
export const weekParts = (w) => ({
  att: w ? n(w.a1) + n(w.a2) + n(w.a3) : 0,
  hw: w ? n(w.h1) + n(w.h2) + n(w.h3) : 0,
  bonus: w ? n(w.bonus) : 0,
  exam: w ? n(w.exam) : 0,
});
export const weekTotal = (w) => { const p = weekParts(w); return Math.min(MAX.week, p.att + p.hw + p.bonus + p.exam); };
export const hasData = (w) => !!w && ["a1", "a2", "a3", "h1", "h2", "h3", "bonus", "exam"].some((k) => typeof w[k] === "number");

// weeks: массив из 4 записей (или null). Среднее всегда делим на 4 — пропущенная неделя = 0.
export function monthResult(weeks, extra) {
  const filled = weeks.filter(hasData).length;
  const totals = weeks.map((w) => (hasData(w) ? weekTotal(w) : null));
  const avg = Math.round((totals.reduce((s, t) => s + (t || 0), 0) / WEEKS) * 10) / 10;
  const done = filled === WEEKS;
  let status;
  if (!done) status = { key: "progress", label: `Идёт месяц · ${filled}/4 нед.` };
  else if (avg >= PASS) status = { key: "pass", label: "Переходит" };
  else if (avg >= EXTRA_MIN) {
    if (extra?.passed === true) status = { key: "pass", label: "Сдал доп. экзамен" };
    else if (extra?.passed === false) status = { key: "fail", label: "Повтор месяца" };
    else status = { key: "extra", label: "Доп. экзамен" };
  } else status = { key: "fail", label: "Повтор месяца" };
  // прогноз по заполненным неделям
  const pace = filled ? Math.round((totals.reduce((s, t) => s + (t || 0), 0) / filled) * 10) / 10 : null;
  return { totals, avg, pace, filled, done, status };
}

export const waLink = (phone) => {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  return "https://wa.me/" + (d.length === 9 ? "992" + d : d); // 9 цифр → номер Таджикистана
};

export const initials = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

// Сегодняшняя дата (локальная) — для отметок посещения
export const sameDay = (iso, d = new Date()) => {
  if (!iso) return false;
  const x = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
};

// Сводка посещения за сегодня по набору записей недель
export function todayAttendance(rows) {
  const out = new Map(); // studentId -> 2|1|0
  rows.forEach((w) => [1, 2, 3].forEach((l) => {
    if (sameDay(w[`d${l}`]) && typeof w[`a${l}`] === "number") out.set(w.studentId, w[`a${l}`]);
  }));
  return out;
}

export const PALETTE = ["#ef5b4c", "#f08a3c", "#2fbf86", "#5b8def", "#e8b931", "#c066e0", "#20b5c4", "#ff7aa2", "#8bc34a", "#9aa7b4", "#ff9f1c", "#4cc9f0"];

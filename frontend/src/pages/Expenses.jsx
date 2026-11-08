import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Modal, { Field } from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";

// Категории расходов: ключ (хранится в базе) → название
export const EXPENSE_CATEGORIES = [
  ["rent", "Ичора"],
  ["teacher_bonus", "Бонуси муаллим"],
  ["marketing", "Маркетинг"],
  ["salary", "Маош"],
  ["internet", "Интернет"],
  ["tax", "Налог"],
  ["documents", "Расходы на документы"],
  ["state_registration", "Оплата государственной регистрации"],
  ["legal", "Юридические расходы"],
  ["annual_state", "Годовые гос. расходы"],
  ["household", "Бытовые расходы"],
  ["other", "Другие"],
];
const CAT = Object.fromEntries(EXPENSE_CATEGORIES);
const WITH_TEACHER = new Set(["salary", "teacher_bonus"]);
const METHOD = { cash: "Наличные", transfer: "Перевод" };
const money = (n) => `${Number(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} сом.`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ym = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthLabel = (key) => { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" }); };

// Отдельный раздел «Расходы» (только суперадмин)
export default function Expenses() {
  const [expenses, setExpenses] = useState(null);
  const [payments, setPayments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [month, setMonth] = useState(() => ym(new Date().toISOString()));
  const [cf, setCf] = useState("");
  const [tab, setTab] = useState("list");
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => Promise.all([api("/api/finance/expenses"), api("/api/finance/payments")])
    .then(([ex, p]) => { setExpenses(ex); setPayments(p); }).catch((e) => setError(e.message));
  useEffect(() => { reload(); api("/api/teachers").then(setTeachers).catch(() => {}); }, []);

  const months = useMemo(() => {
    if (!expenses) return [];
    const set = new Set([ym(new Date().toISOString()), ...expenses.map((e) => ym(e.spentAt)), ...payments.map((p) => ym(p.paidAt))]);
    return [...set].sort().reverse();
  }, [expenses, payments]);

  if (!expenses) return <div className="page-head"><div><div className="eyebrow">Суперадмин</div><h1>Расходы</h1>{error ? <div className="error">{error}</div> : <p>Загрузка…</p>}</div></div>;
  const inMonth = expenses.filter((e) => ym(e.spentAt) === month);
  const shown = inMonth.filter((e) => !cf || e.category === cf);
  const income = payments.filter((p) => ym(p.paidAt) === month).reduce((t, p) => t + Number(p.amount), 0);
  const spent = inMonth.reduce((t, e) => t + Number(e.amount), 0);
  const profit = income - spent;
  // Остаток: все приходы (оплаты учеников) минус все расходы, за всё время
  const sumBy = (arr, m) => arr.filter((x) => !m || x.method === m).reduce((t, x) => t + Number(x.amount), 0);
  const balance = sumBy(payments) - sumBy(expenses);
  const cashBal = sumBy(payments, "cash") - sumBy(expenses, "cash");
  const transferBal = sumBy(payments, "transfer") - sumBy(expenses, "transfer");
  // Касса: все операции по дате с остатком после каждой
  let run = 0;
  const ledger = [
    ...payments.map((p) => ({ key: "p" + p.id, date: p.paidAt, created: p.createdAt || "", in: true, amount: Number(p.amount), method: p.method,
      title: `Оплата: ${p.studentName}`, sub: [p.groupName, p.month ? `месяц курса ${p.month}` : "", p.note].filter(Boolean).join(" · ") })),
    ...expenses.map((e) => ({ key: "e" + e.id, date: e.spentAt, created: e.createdAt || "", in: false, amount: Number(e.amount), method: e.method,
      title: `Расход: ${CAT[e.category] || e.category}`, sub: [e.teacherName, e.note].filter(Boolean).join(" · ") })),
  ].sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) || String(a.created).localeCompare(String(b.created)) || (a.in === b.in ? 0 : a.in ? -1 : 1))
    .map((x) => { run += x.in ? x.amount : -x.amount; return { ...x, after: run }; });
  const ledgerMonth = ledger.filter((x) => ym(x.date) === month);
  const opening = ledger.filter((x) => ym(x.date) < month).reduce((t, x) => t + (x.in ? x.amount : -x.amount), 0);
  // Отчёт по месяцам
  const report = [...new Set(ledger.map((x) => ym(x.date)))].sort().map((m) => {
    const rows = ledger.filter((x) => ym(x.date) === m);
    const inc = rows.filter((x) => x.in).reduce((t, x) => t + x.amount, 0);
    const out = rows.filter((x) => !x.in).reduce((t, x) => t + x.amount, 0);
    return { m, inc, out, profit: inc - out, end: rows[rows.length - 1].after };
  }).reverse();
  const sign = (n) => (n < 0 ? "−" : "") + money(Math.abs(n));
  const byCat = EXPENSE_CATEGORIES.map(([k, name]) => [k, name, inMonth.filter((e) => e.category === k).reduce((t, e) => t + Number(e.amount), 0)])
    .filter((x) => x[2] > 0).sort((a, b) => b[2] - a[2]);

  function openNew() { setError(""); setEdit({ category: "", amount: "", method: "cash", spentAt: today(), teacherId: "", note: "" }); }
  async function save() {
    const amount = Number(String(edit.amount).replace(",", "."));
    if (!edit.category) return setError("Выберите категорию");
    if (!(amount > 0)) return setError("Введите сумму больше 0");
    if (amount > 10000000) return setError("Слишком большая сумма");
    if (!edit.spentAt) return setError("Укажите дату");
    if (edit.category === "other" && !edit.note.trim()) return setError("Для категории «Другие» напишите комментарий");
    if ((edit.note || "").length > 300) return setError("Комментарий: не больше 300 символов");
    setBusy(true); setError("");
    const body = { category: edit.category, amount, method: edit.method, spentAt: edit.spentAt, note: edit.note,
      teacherId: WITH_TEACHER.has(edit.category) && edit.teacherId ? Number(edit.teacherId) : null };
    try {
      if (edit.id) await api(`/api/finance/expenses/${edit.id}`, { method: "PUT", body });
      else await api("/api/finance/expenses", { method: "POST", body });
      setEdit(null); reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(e) {
    if (!window.confirm(`Удалить расход «${CAT[e.category] || e.category}» на ${money(e.amount)}?`)) return;
    try { await api(`/api/finance/expenses/${e.id}`, { method: "DELETE" }); reload(); } catch (x) { setError(x.message); }
  }
  const set = (k) => (ev) => setEdit({ ...edit, [k]: ev.target.value });

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Суперадмин</div><h1>Расходы</h1><p>Расходы академии: аренда, зарплата, налоги и другое.</p></div>
        <button className="btn primary" onClick={openNew}><Icon name="plus" /> Добавить расход</button>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="filters" style={{ margin: 0 }}>
          <div className="select-wrap"><select id="ex-month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select><Icon name="chevron" className="sel-chev" /></div>
          <div className="select-wrap"><select id="ex-cat" value={cf} onChange={(e) => setCf(e.target.value)}>
            <option value="">Все категории</option>
            {EXPENSE_CATEGORIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select><Icon name="chevron" className="sel-chev" /></div>
        </div>
      </div>
      {error && !edit && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="stats">
        <div className="card stat"><Icon name="wallet" size={20} className="stat-ico" /><b style={{ color: "var(--pass)" }}>{money(income)}</b><span>доходы · {monthLabel(month)}</span></div>
        <div className="card stat"><Icon name="cash" size={20} className="stat-ico" /><b style={{ color: "var(--fail)" }}>{money(spent)}</b><span>расходы · {inMonth.length} шт.</span></div>
        <div className="card stat"><Icon name="chart" size={20} className="stat-ico" /><b style={{ color: profit >= 0 ? "var(--pass)" : "var(--fail)" }}>{sign(profit)}</b><span>{profit >= 0 ? "прибыль" : "убыток"} за месяц</span></div>
        <div className="card stat"><Icon name="wallet" size={20} className="stat-ico" /><b style={{ color: balance >= 0 ? "var(--ink)" : "var(--fail)" }}>{sign(balance)}</b><span>остаток в кассе (всего) · наличные {sign(cashBal)} · перевод {sign(transferBal)}</span></div>
      </div>

      <div className="tabs">
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>Расходы · <span className="num">{inMonth.length}</span></button>
        <button className={tab === "cash" ? "on" : ""} onClick={() => setTab("cash")}>Касса (приход и расход) · <span className="num">{ledgerMonth.length}</span></button>
        <button className={tab === "report" ? "on" : ""} onClick={() => setTab("report")}>Отчёт по месяцам</button>
      </div>

      {tab === "cash" && (ledgerMonth.length === 0 ? (
        <div className="card empty"><h2>За этот месяц операций нет</h2><p>Здесь появятся все оплаты учеников и все расходы по порядку.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Операция</th><th className="r">Приход</th><th className="r">Расход</th><th>Способ</th><th className="r">Остаток</th></tr></thead>
            <tbody>
              <tr><td></td><td className="muted">Остаток на начало месяца</td><td></td><td></td><td></td><td className="r num"><b>{sign(opening)}</b></td></tr>
              {ledgerMonth.map((x) => (
                <tr key={x.key}>
                  <td className="num">{day(x.date)}</td>
                  <td><b>{x.title}</b>{x.sub && <div className="small muted">{x.sub}</div>}</td>
                  <td className="r num" style={{ color: "var(--pass)" }}>{x.in ? "+" + money(x.amount) : ""}</td>
                  <td className="r num" style={{ color: "var(--fail)" }}>{x.in ? "" : "−" + money(x.amount)}</td>
                  <td><span className={"chip " + (x.method === "cash" ? "month" : "progress")}>{METHOD[x.method]}</span></td>
                  <td className="r num"><b>{sign(x.after)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}><b>Итого за месяц</b></td><td className="r num" style={{ color: "var(--pass)" }}><b>+{money(income)}</b></td><td className="r num" style={{ color: "var(--fail)" }}><b>−{money(spent)}</b></td><td></td><td className="r num"><b>{sign(opening + profit)}</b></td></tr></tfoot>
          </table>
        </div>
      ))}

      {tab === "report" && (report.length === 0 ? (
        <div className="card empty"><h2>Пока нет данных</h2><p>Отчёт появится после первой оплаты или расхода.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Месяц</th><th className="r">Доходы</th><th className="r">Расходы</th><th className="r">Прибыль / убыток</th><th className="r">Остаток на конец месяца</th></tr></thead>
            <tbody>
              {report.map((r) => (
                <tr key={r.m} style={{ cursor: "pointer" }} title="Открыть кассу за этот месяц" onClick={() => { setMonth(r.m); setTab("cash"); }}>
                  <td><b>{monthLabel(r.m).replace(/^./, (c) => c.toUpperCase())}</b></td>
                  <td className="r num" style={{ color: "var(--pass)" }}>{money(r.inc)}</td>
                  <td className="r num" style={{ color: "var(--fail)" }}>{money(r.out)}</td>
                  <td className="r num" style={{ color: r.profit >= 0 ? "var(--pass)" : "var(--fail)" }}><b>{sign(r.profit)}</b></td>
                  <td className="r num"><b>{sign(r.end)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><b>Всего</b></td><td className="r num"><b>{money(sumBy(payments))}</b></td><td className="r num"><b>{money(sumBy(expenses))}</b></td><td className="r num"><b>{sign(balance)}</b></td><td className="r num"><b>{sign(balance)}</b></td></tr></tfoot>
          </table>
        </div>
      ))}

      {tab === "list" && <>

      {byCat.length > 0 && (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 12 }}>На что ушли деньги</h2>
          <div className="cat-bars">
            {byCat.map(([k, name, sum]) => (
              <button key={k} type="button" className={"cat-bar" + (cf === k ? " on" : "")} onClick={() => setCf(cf === k ? "" : k)} title="Показать только эту категорию">
                <span className="cb-name">{name}</span>
                <span className="cb-track"><i style={{ width: `${(sum / byCat[0][2]) * 100}%` }} /></span>
                <span className="cb-sum num">{money(sum)}</span>
                <span className="cb-pct num muted">{Math.round((sum / spent) * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card empty"><h2>{inMonth.length ? "Нет расходов в этой категории" : "Расходов за этот месяц нет"}</h2><p>Нажмите «Добавить расход», чтобы записать первый.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Категория</th><th className="r">Сумма</th><th>Способ</th><th>Учитель</th><th>Комментарий</th><th></th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="num">{day(e.spentAt)}</td>
                  <td><b>{CAT[e.category] || e.category}</b></td>
                  <td className="r num"><b>{money(e.amount)}</b></td>
                  <td><span className={"chip " + (e.method === "cash" ? "month" : "progress")}>{METHOD[e.method]}</span></td>
                  <td>{e.teacherName || <span className="muted">—</span>}</td>
                  <td className="small">{e.note || <span className="muted">—</span>}</td>
                  <td><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <button className="icon-btn" title="Изменить" onClick={() => { setError(""); setEdit({ id: e.id, category: e.category, amount: String(e.amount), method: e.method, spentAt: e.spentAt.slice(0, 10), teacherId: e.teacherId ? String(e.teacherId) : "", note: e.note || "" }); }}><Icon name="edit" /></button>
                    <button className="icon-btn danger" title="Удалить" onClick={() => remove(e)}><Icon name="trash" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}><b>Итого</b></td><td className="r num"><b>{money(shown.reduce((t, e) => t + Number(e.amount), 0))}</b></td><td colSpan={4}></td></tr></tfoot>
          </table>
        </div>
      )}
      </>}

      {edit && (
        <Modal title={edit.id ? "Изменить расход" : "Новый расход"} subtitle="Расход академии: аренда, зарплата, налоги и другое." onClose={() => setEdit(null)} onSubmit={save} error={error} busy={busy} submitText={edit.id ? "Сохранить" : "Записать расход"}>
          <div className="form-grid">
            <Field as="select" full required label="Категория" id="ex-category" value={edit.category} onChange={set("category")}>
              <option value="">Выберите категорию</option>
              {EXPENSE_CATEGORIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </Field>
            {WITH_TEACHER.has(edit.category) && (
              <Field as="select" full label="Учитель" id="ex-teacher" value={edit.teacherId} onChange={set("teacherId")} hint="Необязательно — чтобы видеть, сколько кому заплатили">
                <option value="">Не выбран</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
              </Field>
            )}
            <Field required label="Сумма, сомони" id="ex-amount" inputMode="decimal" value={edit.amount} onChange={set("amount")} placeholder="1500" maxLength={12} />
            <Field required label="Дата" id="ex-date" type="date" value={edit.spentAt} onChange={set("spentAt")} />
            <div className="field full">
              <span className="f-label">Способ оплаты<i className="req">*</i></span>
              <div className="seg big" role="group" aria-label="Способ оплаты">
                <button type="button" className={edit.method === "cash" ? "on" : ""} onClick={() => setEdit({ ...edit, method: "cash" })}><Icon name="cash" /> Наличные</button>
                <button type="button" className={edit.method === "transfer" ? "on" : ""} onClick={() => setEdit({ ...edit, method: "transfer" })}><Icon name="card" /> Перевод</button>
              </div>
            </div>
            <Field full required={edit.category === "other"} label="Комментарий" id="ex-note" value={edit.note} onChange={set("note")} maxLength={300}
              placeholder={edit.category === "other" ? "На что потратили" : "Например: аренда за ноябрь"} />
          </div>
        </Modal>
      )}
    </>
  );
}

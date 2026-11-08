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
        <div className="card stat"><Icon name="chart" size={20} className="stat-ico" /><b style={{ color: profit >= 0 ? "var(--pass)" : "var(--fail)" }}>{profit < 0 ? "−" : ""}{money(Math.abs(profit))}</b><span>{profit >= 0 ? "прибыль" : "убыток"} (доходы − расходы)</span></div>
      </div>

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

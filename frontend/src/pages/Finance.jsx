import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import Modal, { Field } from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";
import { initials } from "../scoring.js";

const METHOD = { cash: "Наличные", transfer: "Перевод" };
const money = (n) => `${Number(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} сом.`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }; // местная дата
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
const sameMonth = (iso, d = new Date()) => { const x = new Date(iso); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); };

export default function Finance() {
  const [students, setStudents] = useState(null);
  const [groups, setGroups] = useState([]);
  const [payments, setPayments] = useState([]);
  const [price, setPrice] = useState(0);
  const [tab, setTab] = useState("status");
  const [q, setQ] = useState("");
  const [gf, setGf] = useState("");
  const [sf, setSf] = useState("");
  const [edit, setEdit] = useState(null);
  const [priceEdit, setPriceEdit] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api("/api/students"), api("/api/groups"), api("/api/finance/payments"), api("/api/finance/settings")])
    .then(([s, g, p, st]) => { setStudents(s); setGroups(g); setPayments(p); setPrice(Number(st.monthPrice) || 0); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // статус оплаты каждого ученика за ТЕКУЩИЙ месяц его группы
  const rows = useMemo(() => (students || []).map((s) => {
    const month = s.currentMonth || 1;
    const mine = payments.filter((p) => p.studentId === s.id && p.month === month);
    const paid = mine.reduce((t, p) => t + Number(p.amount), 0);
    const left = Math.max(0, price - paid);
    const status = paid <= 0 ? "none" : price > 0 && paid < price ? "part" : "paid";
    return { s, month, paid, left, status, last: mine[0] };
  }), [students, payments, price]);

  const shown = rows.filter((r) => (!gf || String(r.s.groupId) === gf) && (!sf || r.status === sf)
    && (!q || r.s.fullName.toLowerCase().includes(q.toLowerCase())));
  const history = payments.filter((p) => (!gf || String(p.groupId) === gf) && (!q || p.studentName.toLowerCase().includes(q.toLowerCase())));

  const thisMonth = payments.filter((p) => sameMonth(p.paidAt));
  const sum = (list) => list.reduce((t, p) => t + Number(p.amount), 0);
  const stats = {
    total: sum(thisMonth),
    cash: sum(thisMonth.filter((p) => p.method === "cash")),
    transfer: sum(thisMonth.filter((p) => p.method === "transfer")),
    paid: rows.filter((r) => r.status === "paid").length,
    debt: rows.reduce((t, r) => t + r.left, 0),
    debtors: rows.filter((r) => r.status !== "paid").length,
  };
  const monthName = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  function openPay(r) {
    setError("");
    setEdit({ studentId: r ? String(r.s.id) : "", month: r ? r.month : 1, amount: r ? String(r.left || price || "") : String(price || ""), method: "cash", paidAt: today(), note: "" });
  }
  async function save() {
    const amount = Number(String(edit.amount).replace(",", "."));
    if (!edit.studentId) return setError("Выберите ученика");
    if (!(amount > 0)) return setError("Введите сумму больше 0");
    if (amount > 1000000) return setError("Слишком большая сумма");
    if (!edit.paidAt) return setError("Укажите дату оплаты");
    if ((edit.note || "").length > 200) return setError("Комментарий: не больше 200 символов");
    setBusy(true); setError("");
    const body = { studentId: Number(edit.studentId), month: Number(edit.month), amount, method: edit.method, paidAt: edit.paidAt, note: edit.note };
    try {
      if (edit.id) await api(`/api/finance/payments/${edit.id}`, { method: "PUT", body });
      else await api("/api/finance/payments", { method: "POST", body });
      setEdit(null); load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(p) {
    if (!window.confirm(`Удалить оплату ${money(p.amount)} от ${p.studentName}?`)) return;
    try { await api(`/api/finance/payments/${p.id}`, { method: "DELETE" }); load(); } catch (e) { setError(e.message); }
  }
  async function savePrice() {
    const v = Number(String(priceEdit).replace(",", "."));
    if (!(v >= 0) || v > 1000000) return setError("Цена: от 0 до 1 000 000");
    setBusy(true); setError("");
    try { await api("/api/finance/settings", { method: "PUT", body: { monthPrice: v } }); setPriceEdit(null); load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });
  const chip = { paid: ["pass", "Оплачено"], part: ["extra", "Частично"], none: ["fail", "Не оплачено"] };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Суперадмин</div><h1>Финансы</h1><p>Оплаты учеников за месяц курса: наличные и переводы.</p></div>
        <div className="row">
          <button className="btn" onClick={() => { setError(""); setPriceEdit(String(price || "")); }}><Icon name="settings" /> Цена месяца: <b className="num">{money(price)}</b></button>
          <button className="btn primary" onClick={() => openPay(null)} disabled={!students?.length}><Icon name="plus" /> Принять оплату</button>
        </div>
      </div>
      {error && !edit && priceEdit === null && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="stats">
        <div className="card stat"><Icon name="wallet" size={20} className="stat-ico" /><b>{money(stats.total)}</b><span>получено за {monthName}</span></div>
        <div className="card stat"><Icon name="cash" size={20} className="stat-ico" /><b>{money(stats.cash)}</b><span>наличными</span></div>
        <div className="card stat"><Icon name="card" size={20} className="stat-ico" /><b>{money(stats.transfer)}</b><span>переводом</span></div>
        <div className="card stat"><Icon name="alert" size={20} className="stat-ico" /><b style={{ color: stats.debt ? "var(--fail)" : "var(--pass)" }}>{money(stats.debt)}</b><span>долг · {stats.debtors} уч. · оплатили {stats.paid}</span></div>
      </div>
      {price === 0 && <div className="note-box"><Icon name="alert" /> Укажите цену месяца (кнопка «Цена месяца»), чтобы система считала долги и частичную оплату.</div>}

      <div className="tabs">
        <button className={tab === "status" ? "on" : ""} onClick={() => setTab("status")}>Кто оплатил</button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>История оплат · <span className="num">{payments.length}</span></button>
      </div>
      <div className="filters">
        <label className="search"><Icon name="search" /><input id="fin-q" placeholder="Поиск ученика" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="select-wrap"><select id="fin-g" value={gf} onChange={(e) => setGf(e.target.value)}><option value="">Все группы</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><Icon name="chevron" className="sel-chev" /></div>
        {tab === "status" && <div className="select-wrap"><select id="fin-s" value={sf} onChange={(e) => setSf(e.target.value)}><option value="">Все статусы</option><option value="paid">Оплачено</option><option value="part">Частично</option><option value="none">Не оплачено</option></select><Icon name="chevron" className="sel-chev" /></div>}
      </div>

      {students && students.length === 0 && <div className="card empty"><h2>Учеников пока нет</h2><p>Добавьте учеников в группы, потом принимайте оплаты.</p></div>}

      {tab === "status" && shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ученик</th><th>Группа</th><th className="c">Месяц курса</th><th className="r">Оплачено</th><th className="r">Осталось</th><th>Статус</th><th>Последняя оплата</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.s.id}>
                  <td><div className="who"><span className="avatar">{initials(r.s.fullName)}</span><b>{r.s.fullName}</b></div></td>
                  <td><Link to={`/groups/${r.s.groupId}`}>{r.s.groupName}</Link></td>
                  <td className="c num">{r.month}</td>
                  <td className="r num">{money(r.paid)}</td>
                  <td className="r num" style={{ color: r.left ? "var(--fail)" : "var(--muted)" }}>{price ? money(r.left) : "—"}</td>
                  <td><span className={"chip " + chip[r.status][0]}>{chip[r.status][1]}</span></td>
                  <td className="small">{r.last ? <>{day(r.last.paidAt)} · {METHOD[r.last.method]}</> : <span className="muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}>{r.status !== "paid" && <button className="btn sm primary" onClick={() => openPay(r)}><Icon name="plus" /> Оплата</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "status" && students?.length > 0 && shown.length === 0 && <div className="card empty"><h2>Никого не нашли</h2><p>Измените поиск или фильтры.</p></div>}

      {tab === "history" && (history.length === 0 ? <div className="card empty"><h2>Оплат пока нет</h2><p>Нажмите «Принять оплату», чтобы записать первую.</p></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Ученик</th><th>Группа</th><th className="c">Месяц</th><th className="r">Сумма</th><th>Способ</th><th>Комментарий</th><th></th></tr></thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <td className="num">{day(p.paidAt)}</td>
                  <td><b>{p.studentName}</b></td>
                  <td>{p.groupName || <span className="muted">—</span>}</td>
                  <td className="c num">{p.month}</td>
                  <td className="r num"><b>{money(p.amount)}</b></td>
                  <td><span className={"chip " + (p.method === "cash" ? "month" : "progress")}>{METHOD[p.method]}</span></td>
                  <td className="small">{p.note || <span className="muted">—</span>}</td>
                  <td><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <button className="icon-btn" title="Изменить" onClick={() => { setError(""); setEdit({ id: p.id, studentId: String(p.studentId), studentName: p.studentName, month: p.month, amount: String(p.amount), method: p.method, paidAt: p.paidAt.slice(0, 10), note: p.note || "" }); }}><Icon name="edit" /></button>
                    <button className="icon-btn danger" title="Удалить" onClick={() => remove(p)}><Icon name="trash" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {edit && (
        <Modal title={edit.id ? "Изменить оплату" : "Принять оплату"} subtitle="Оплата записывается за месяц курса ученика." onClose={() => setEdit(null)} onSubmit={save} error={error} busy={busy} submitText={edit.id ? "Сохранить" : "Записать оплату"}>
          <div className="form-grid">
            {edit.id ? (
              <div className="field full"><span className="f-label">Ученик</span><div className="static-val">{edit.studentName}</div></div>
            ) : (
              <Field as="select" full required label="Ученик" id="pay-student" value={edit.studentId}
                onChange={(e) => { const r = rows.find((x) => String(x.s.id) === e.target.value); setEdit({ ...edit, studentId: e.target.value, month: r?.month || 1, amount: String(r ? (r.left || price || "") : edit.amount) }); }}>
                <option value="">Выберите ученика</option>
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {rows.filter((r) => r.s.groupId === g.id).map((r) => <option key={r.s.id} value={r.s.id}>{r.s.fullName}{r.status === "paid" ? " ✓" : ""}</option>)}
                  </optgroup>
                ))}
              </Field>
            )}
            <Field as="select" required label="Месяц курса" id="pay-month" value={edit.month} onChange={set("month")}>
              <option value={1}>Месяц 1 · Frontend</option><option value={2}>Месяц 2 · Backend</option><option value={3}>Месяц 3 · Проект</option>
            </Field>
            <Field required label="Сумма, сомони" id="pay-amount" inputMode="decimal" value={edit.amount} onChange={set("amount")} placeholder="500" maxLength={10}
              hint={price ? `Цена месяца: ${money(price)}` : undefined} />
            <div className="field full">
              <span className="f-label">Способ оплаты<i className="req">*</i></span>
              <div className="seg big" role="group" aria-label="Способ оплаты">
                <button type="button" className={edit.method === "cash" ? "on" : ""} onClick={() => setEdit({ ...edit, method: "cash" })}><Icon name="cash" /> Наличные</button>
                <button type="button" className={edit.method === "transfer" ? "on" : ""} onClick={() => setEdit({ ...edit, method: "transfer" })}><Icon name="card" /> Перевод</button>
              </div>
            </div>
            <Field required label="Дата оплаты" id="pay-date" type="date" value={edit.paidAt} onChange={set("paidAt")} />
            <Field label="Комментарий" id="pay-note" value={edit.note} onChange={set("note")} maxLength={200} placeholder="Например: Alif, перевёл папа" />
          </div>
        </Modal>
      )}

      {priceEdit !== null && (
        <Modal title="Цена месяца" subtitle="Сколько стоит один месяц курса. По ней считаются долги." onClose={() => setPriceEdit(null)} onSubmit={savePrice} error={error} busy={busy}>
          <Field required label="Цена, сомони" id="price" inputMode="decimal" value={priceEdit} onChange={(e) => setPriceEdit(e.target.value)} placeholder="500" maxLength={10} />
        </Modal>
      )}
    </>
  );
}

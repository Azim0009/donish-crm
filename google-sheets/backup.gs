/**
 * CRM Donish → Google Таблица (резервная копия)
 *
 * Скрипт берёт все данные CRM по секретному адресу /api/backup и раскладывает их по листам.
 * Только ЧИТАЕТ данные из CRM — ничего в CRM не меняет и не удаляет.
 *
 * Установка (один раз):
 *   1. Создайте Google Таблицу «CRM Donish — копия».
 *   2. Расширения → Apps Script → вставьте этот код → Сохранить.
 *   3. Настройки проекта (шестерёнка) → Свойства скрипта → Добавить свойство:
 *        BACKUP_KEY = тот же ключ, что в переменной BACKUP_KEY на Render
 *   4. Вверху выберите функцию setup → Выполнить → разрешите доступ.
 *   Готово: копия обновляется каждый час, в меню таблицы появится «CRM Donish → Обновить сейчас».
 */

const API_URL = 'https://donish-crm.onrender.com/api/backup';

// Листы и колонки: [заголовок в таблице, поле в данных, тип]
const SHEETS = {
  'Ученики': ['students', [['ID', 'id'], ['Ученик', 'fullName'], ['Группа', 'group'], ['Телефон', 'phone'], ['Родитель', 'parentName'], ['WhatsApp родителя', 'parentPhone'], ['Добавлен', 'createdAt', 'date']]],
  'Оплаты': ['payments', [['Дата оплаты', 'paidAt', 'date'], ['Ученик', 'studentName'], ['Группа', 'groupName'], ['Месяц курса', 'month'], ['Сумма, сом.', 'amount', 'money'], ['Способ', 'method'], ['Комментарий', 'note'], ['ID оплаты', 'id'], ['ID ученика', 'studentId'], ['Записано', 'createdAt', 'datetime']]],
  'Баллы': ['scores', [['Ученик', 'student'], ['Группа', 'group'], ['Месяц', 'month'], ['Неделя', 'week'], ['Пос. 1', 'a1'], ['Пос. 2', 'a2'], ['Пос. 3', 'a3'], ['ДЗ 1', 'h1'], ['ДЗ 2', 'h2'], ['ДЗ 3', 'h3'], ['Бонус', 'bonus'], ['Экзамен', 'exam'], ['Итого /100', 'total'], ['ID ученика', 'studentId'], ['Обновлено', 'updatedAt', 'datetime']]],
  'Расходы': ['expenses', [['Дата', 'spentAt', 'date'], ['Категория', 'category'], ['Сумма, сом.', 'amount', 'money'], ['Способ', 'method'], ['Учитель', 'teacher'], ['Комментарий', 'note'], ['ID расхода', 'id'], ['Записано', 'createdAt', 'datetime']]],
  'Доп. экзамены': ['extraExams', [['Ученик', 'student'], ['Месяц', 'month'], ['Результат', 'passed'], ['ID ученика', 'studentId'], ['Обновлено', 'updatedAt', 'datetime']]],
  'Группы': ['groups', [['ID', 'id'], ['Группа', 'name'], ['Курс', 'course'], ['Учитель', 'teacher'], ['Расписание', 'schedule'], ['Текущий месяц', 'currentMonth'], ['Учеников', 'students'], ['Дата старта', 'startDate', 'date']]],
  'Учителя': ['teachers', [['ID', 'id'], ['Учитель', 'fullName'], ['Логин', 'login'], ['Телефон', 'phone'], ['Добавлен', 'createdAt', 'date']]],
};

// Касса: все приходы и расходы по дате, остаток после каждой операции (новые сверху)
const LEDGER_COLS = [['Дата', 'date', 'date'], ['Операция', 'type'], ['Кто / за что', 'title'], ['Подробно', 'details'], ['Приход, сом.', 'inc', 'money'], ['Расход, сом.', 'out', 'money'], ['Способ', 'method'], ['Остаток, сом.', 'after', 'money']];
// Отчёт: по месяцам (новые сверху)
const REPORT_COLS = [['Месяц', 'month'], ['Доходы, сом.', 'inc', 'money'], ['Расходы, сом.', 'out', 'money'], ['Прибыль / убыток', 'profit', 'money'], ['Остаток на конец месяца', 'end', 'money']];
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function ledger_(data) {
  const rows = (data.payments || []).map(p => ({ date: p.paidAt, created: p.createdAt || '', isIn: true, type: 'Приход', title: p.studentName,
      details: [p.groupName, p.month ? 'месяц курса ' + p.month : '', p.note].filter(x => x).join(' · '), amount: Number(p.amount), method: p.method }))
    .concat((data.expenses || []).map(e => ({ date: e.spentAt, created: e.createdAt || '', isIn: false, type: 'Расход', title: e.category,
      details: [e.teacher, e.note].filter(x => x).join(' · '), amount: Number(e.amount), method: e.method })));
  rows.sort((a, b) => String(a.date).slice(0, 10).localeCompare(String(b.date).slice(0, 10)) ||
    String(a.created).localeCompare(String(b.created)) || (a.isIn === b.isIn ? 0 : a.isIn ? -1 : 1));
  let run = 0;
  return rows.map(r => {
    run += r.isIn ? r.amount : -r.amount;
    return Object.assign(r, { inc: r.isIn ? r.amount : null, out: r.isIn ? null : r.amount, after: run, ym: String(r.date).slice(0, 7) });
  });
}

function report_(ledger) {
  const by = {};
  ledger.forEach(r => {
    const m = by[r.ym] || (by[r.ym] = { inc: 0, out: 0, end: 0 });
    if (r.isIn) m.inc += r.amount; else m.out += r.amount;
    m.end = r.after;
  });
  return Object.keys(by).sort().reverse().map(k => {
    const [y, mo] = k.split('-').map(Number);
    return { month: MONTHS_RU[mo - 1] + ' ' + y, inc: by[k].inc, out: by[k].out, profit: by[k].inc - by[k].out, end: by[k].end };
  });
}

/** Меню в таблице */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('CRM Donish')
    .addItem('Обновить сейчас', 'backupNow')
    .addToUi();
}

/** Один раз: автообновление каждый час */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'backupNow')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupNow').timeBased().everyHours(1).create();
  backupNow();
}

/** Забрать данные из CRM и записать в листы */
function backupNow() {
  const key = PropertiesService.getScriptProperties().getProperty('BACKUP_KEY');
  if (!key) throw new Error('Не задан BACKUP_KEY в «Свойствах скрипта»');

  const data = fetchWithRetry_(key);
  // Защита: если CRM вдруг вернула пустые данные, а в таблице они есть — не затираем копию
  const ss = SpreadsheetApp.getActive();
  const oldStudents = ss.getSheetByName('Ученики');
  if ((data.students || []).length === 0 && oldStudents && oldStudents.getLastRow() > 1) {
    log_(ss, 'ПРОПУЩЕНО: CRM вернула 0 учеников, старая копия сохранена', data);
    return;
  }

  Object.keys(SHEETS).forEach(name => {
    const [field, cols] = SHEETS[name];
    writeSheet_(ss, name, cols, data[field] || []);
  });
  // Касса и отчёт считаются из оплат и расходов (в CRM ничего не меняется)
  const ledger = ledger_(data);
  writeSheet_(ss, 'Касса', LEDGER_COLS, ledger.slice().reverse());
  writeSheet_(ss, 'Отчёт по месяцам', REPORT_COLS, report_(ledger));
  log_(ss, 'OK', data);
}

function fetchWithRetry_(key) {
  // Бесплатный Render «спит» — первый запрос может идти до минуты, поэтому 3 попытки
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = UrlFetchApp.fetch(API_URL, { headers: { 'X-Backup-Key': key }, muteHttpExceptions: true });
      const code = res.getResponseCode();
      if (code === 200) return JSON.parse(res.getContentText());
      if (code === 401) throw new Error('Неверный BACKUP_KEY');
      if (code === 404) throw new Error('На Render не задан BACKUP_KEY (или он короче 24 символов)');
      lastErr = new Error('Сервер ответил ' + code);
    } catch (e) {
      if (/BACKUP_KEY/.test(e.message)) throw e;
      lastErr = e;
    }
    Utilities.sleep(20000);
  }
  throw lastErr;
}

function writeSheet_(ss, name, cols, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const values = [cols.map(c => c[0])].concat(rows.map(r => cols.map(c => cell_(r[c[1]], c[2]))));
  sh.clearContents();
  sh.getRange(1, 1, values.length, cols.length).setValues(values);
  // оформление
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#0b3d2f').setFontColor('#ffffff');
  cols.forEach((c, i) => {
    if (rows.length === 0) return;
    const rng = sh.getRange(2, i + 1, rows.length, 1);
    if (c[2] === 'date') rng.setNumberFormat('dd.mm.yyyy');
    if (c[2] === 'datetime') rng.setNumberFormat('dd.mm.yyyy hh:mm');
    if (c[2] === 'money') rng.setNumberFormat('#,##0.00');
  });
  sh.autoResizeColumns(1, cols.length);
}

function cell_(v, type) {
  if (v === null || v === undefined) return '';
  if ((type === 'date' || type === 'datetime') && v) return new Date(v);
  if (type === 'money') return Number(v);
  return v;
}

function log_(ss, status, data) {
  const sh = ss.getSheetByName('Сводка') || ss.insertSheet('Сводка', 0);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Время копии', 'Статус', 'Учеников', 'Групп', 'Учителей', 'Оплат', 'Записей баллов']);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#0b3d2f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 7).setFontWeight('normal').setBackground(null).setFontColor('#000000');
  sh.getRange(2, 1, 1, 7).setValues([[new Date(), status, (data.students || []).length, (data.groups || []).length,
    (data.teachers || []).length, (data.payments || []).length, (data.scores || []).length]]);
  sh.getRange(2, 1).setNumberFormat('dd.mm.yyyy hh:mm');
  if (sh.getLastRow() > 501) sh.deleteRows(502, sh.getLastRow() - 501); // храним последние 500 записей журнала
}

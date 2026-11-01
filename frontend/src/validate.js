// Проверка форм на стороне браузера (те же правила, что и на сервере)
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const PERSON = /^[\p{L}\s\-'’.]+$/u;
const TITLE = /^[\p{L}\p{N}\s\-'’.,()+:/№·&_]+$/u;
const DANGER = /[<>{}\\`$]/;

export const v = {
  person(s, label, req = true) {
    const c = clean(s);
    if (!c) return req ? `${label}: заполните поле` : null;
    if (c.length < 2 || c.length > 100) return `${label}: от 2 до 100 символов`;
    if (!PERSON.test(c)) return `${label}: только буквы`;
    return null;
  },
  title(s, label, max = 60) {
    const c = clean(s);
    if (!c) return `${label}: заполните поле`;
    if (c.length < 2 || c.length > max) return `${label}: от 2 до ${max} символов`;
    if (!TITLE.test(c)) return `${label}: недопустимые символы`;
    return null;
  },
  opt(s, label, max = 100) {
    const c = clean(s);
    if (c.length > max) return `${label}: не больше ${max} символов`;
    if (DANGER.test(c)) return `${label}: недопустимые символы`;
    return null;
  },
  login(s) { return /^[a-z0-9._-]{3,32}$/.test(clean(s).toLowerCase()) ? null : "Логин: 3–32 символа, латинские буквы, цифры, точка, _ или -"; },
  password(p, req = true) {
    if (!p) return req ? "Пароль: заполните поле" : null;
    if (p.length < 8 || p.length > 128) return "Пароль: от 8 до 128 символов";
    if (!/\p{L}/u.test(p) || !/\d/.test(p)) return "Пароль должен содержать буквы и цифры";
    return null;
  },
  phone(s, label) {
    const c = clean(s);
    if (!c) return null;
    if (!/^[0-9+\-\s()]+$/.test(c)) return `${label}: только цифры, например +992 90 123 45 67`;
    const d = c.replace(/\D/g, "");
    if (d.length < 9 || d.length > 15) return `${label}: от 9 до 15 цифр`;
    return null;
  },
};
export const first = (...errs) => errs.find(Boolean) || null;

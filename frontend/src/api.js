const BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

export const auth = {
  get token() { try { return localStorage.getItem("token"); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } },
  save(token, user) { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); },
  clear() { localStorage.removeItem("token"); localStorage.removeItem("user"); },
};

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(auth.token ? { Authorization: "Bearer " + auth.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { auth.clear(); window.location.href = "/login"; throw new Error("Сессия закончилась, войдите снова"); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.status === 429) throw new Error(data?.error || "Слишком много попыток. Подождите минуту");
  if (res.status === 403) throw new Error("Нет доступа");
  if (!res.ok) throw new Error(data?.error || (res.status === 404 ? "Не найдено" : res.status === 400 ? "Проверьте введённые данные" : "Ошибка сервера"));
  return data;
}

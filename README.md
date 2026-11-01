# CRM Donish

Журнал академии Donish: группы, учителя, ученики, посещение, ДЗ, бонусы, экзамен недели и итоги месяца.

- **frontend/** — React (Vite) → Netlify
- **backend/** — C# ASP.NET Core 8 + EF Core → Render (Docker) + PostgreSQL

## Правила баллов
Неделя = 3 урока, максимум **100**:
посещение 3 × 2 = 6 (пришёл 2, опоздал 1, нет 0) · ДЗ 3 × 10 = 30 · бонус до 14 · экзамен недели до 50.

Итог месяца = (неделя 1 + 2 + 3 + 4) ÷ 4:
- **80+** — переходит на следующий месяц
- **75–79** — доп. экзамен (учитель отмечает «Сдал / Не сдал»)
- **< 75** — повтор месяца (админ переводит ученика в нужную группу)

Цифры меняются в одном месте: `frontend/src/scoring.js` и проверки в `backend/Program.cs` (`Clamp`).

## Роли
- **Суперадмин** — создаёт учителей (логин/пароль) и группы, назначает учителя, переводит учеников между группами.
- **Учитель** — видит только свои группы, ставит время занятий, добавляет учеников (телефон, родитель, WhatsApp родителя), ведёт журнал, скачивает PNG: отчёт недели по группе и карточку ученика для родителей; кнопка WhatsApp открывает чат с родителем с готовым текстом.

## Запуск на компьютере
Backend (нужен .NET 8 SDK):
```bash
cd backend
dotnet run --urls http://localhost:5000
```
Без DATABASE_URL создаётся файл `donish.db` (SQLite). Первый вход: **Admin / Donish2026** (логин без учёта регистра).

Frontend:
```bash
cd frontend
cp .env.example .env      # VITE_API_URL=http://localhost:5000
npm install
npm run dev               # http://localhost:5173
```

## Деплой
### 1. База — Render PostgreSQL
Render → New → PostgreSQL → создать. Скопировать **Internal Database URL**.

### 2. Backend — Render Web Service
New → Web Service → репозиторий → Root Directory: `backend`, Runtime: **Docker**.
Environment:
| Ключ | Значение |
|---|---|
| `DATABASE_URL` | Internal Database URL из шага 1 |
| `JWT_KEY` | длинная случайная строка (32+ символа) |
| `ADMIN_LOGIN` | `Admin` |
| `ADMIN_PASSWORD` | `Donish2026` (потом смените в приложении) |
| `ADMIN_NAME` | имя суперадмина |
| `FRONTEND_URL` | адрес сайта на Netlify, напр. `https://donish-crm.netlify.app` |

Суперадмин создаётся автоматически при первом запуске, если его ещё нет.

### 3. Frontend — Netlify
Add new site → репозиторий → Base directory: `frontend`, Build: `npm run build`, Publish: `frontend/dist`.
Environment: `VITE_API_URL` = адрес backend на Render (например `https://donish-crm-api.onrender.com`). После этого — Deploy.

> Бесплатный backend на Render «засыпает»: первый запрос после паузы идёт ~30–50 секунд.

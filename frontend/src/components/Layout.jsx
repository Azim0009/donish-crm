import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { auth } from "../api.js";
import Icon from "./Icon.jsx";

export function useTheme() {
  const get = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const [theme, setTheme] = useState(get);
  const toggle = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch {}
    setTheme(t);
  };
  return [theme, toggle];
}

export default function Layout({ children }) {
  const nav = useNavigate();
  const u = auth.user;
  const [theme, toggle] = useTheme();
  return (
    <div className="app">
      <aside className="side">
        <NavLink to="/" className="logo">
          <span className="logo-mark">D</span>
          <span>CRM Donish<small>Donish Academy</small></span>
        </NavLink>
        <nav className="nav">
          {u?.role === "admin" && <NavLink to="/" end><Icon name="home" /> Обзор</NavLink>}
          <NavLink to="/groups"><Icon name="grid" /> Группы</NavLink>
          <NavLink to="/students"><Icon name="users" /> Ученики</NavLink>
          {u?.role === "admin" && <NavLink to="/teachers"><Icon name="user" /> Учителя</NavLink>}
          {u?.role === "admin" && <NavLink to="/finance"><Icon name="wallet" /> Финансы</NavLink>}
          {u?.role === "admin" && <NavLink to="/expenses"><Icon name="cash" /> Расходы</NavLink>}
        </nav>
        <div className="side-foot">
          <div className="me"><b>{u?.fullName}</b>{u?.role === "admin" ? "Суперадмин" : "Учитель"}</div>
          <button className="btn sm" onClick={toggle}><Icon name={theme === "dark" ? "sun" : "moon"} /> <span className="hide-sm">{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span></button>
          <NavLink to="/settings" className="btn sm"><Icon name="settings" /> <span className="hide-sm">Настройки</span></NavLink>
          <button className="btn sm" onClick={() => { auth.clear(); nav("/login"); }}><Icon name="logout" /> <span className="hide-sm">Выйти</span></button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

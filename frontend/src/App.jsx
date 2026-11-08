import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { auth } from "./api.js";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Groups from "./pages/Groups.jsx";
import Teachers from "./pages/Teachers.jsx";
import GroupPage from "./pages/GroupPage.jsx";
import Students from "./pages/Students.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Settings from "./pages/Settings.jsx";
import Finance from "./pages/Finance.jsx";
import Expenses from "./pages/Expenses.jsx";

function Private({ children, admin }) {
  const u = auth.user;
  const loc = useLocation();
  if (!auth.token || !u) return <Navigate to="/login" replace />;
  if (admin && u.role !== "admin") return <Navigate to="/groups" replace />;
  return <Layout><div className="page" key={loc.pathname}>{children}</div></Layout>;
}
const Home = () => (auth.user?.role === "admin" ? <Dashboard /> : <Navigate to="/groups" replace />);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Private><Home /></Private>} />
      <Route path="/groups" element={<Private><Groups /></Private>} />
      <Route path="/groups/:id" element={<Private><GroupPage /></Private>} />
      <Route path="/students" element={<Private><Students /></Private>} />
      <Route path="/settings" element={<Private><Settings /></Private>} />
      <Route path="/expenses" element={<Private admin><Expenses /></Private>} />
      <Route path="/finance" element={<Private admin><Finance /></Private>} />
      <Route path="/teachers" element={<Private admin><Teachers /></Private>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

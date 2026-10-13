import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { admin } from './api.js';
import RegisterPage from './pages/RegisterPage.jsx';
import ApiListPage from './pages/ApiListPage.jsx';
import DetailPage from './pages/DetailPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ManualPage from './pages/ManualPage.jsx';
import { useAuth } from './auth.jsx';

const ApisContext = createContext({ apis: [], refresh: async () => {} });
export const useApis = () => useContext(ApisContext);

export default function App() {
  const { user, ready, logout } = useAuth();
  if (!ready) return <div className="login-screen"><p className="muted">Loading…</p></div>;
  if (!user) return <LoginPage />;
  return <Portal user={user} logout={logout} />;
}

function Portal({ user, logout }) {
  const [apis, setApis] = useState([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setApis(await admin.list());
      setError('');
    } catch (e) {
      if (e.status !== 401) setError(`Cannot reach the API server: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ApisContext.Provider value={{ apis, refresh, user }}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">Mock API Portal</div>
          <NavLink to="/register" className="nav-item register">
            <span className="plus">＋</span> Register API
          </NavLink>
          {user.isAdmin && (
            <NavLink to="/admin-view" className="nav-item admin-link">
              <span className="plus">⚙</span> Admin view
            </NavLink>
          )}
          <NavLink to="/manual" className="nav-item manual-link">
            <span className="plus">?</span> User manual
          </NavLink>
          <div className="nav-heading">APIs</div>
          {apis.length === 0 && <div className="nav-empty">None registered yet</div>}
          {apis.map((a) => (
            <NavLink key={a._id} to={`/browse/${a._id}`} className="nav-item">
              <span className="nav-name">{a.name}</span>
              <span className="badge" title={a.group || ''}>{a.env ? `${a.env} · ${a.version}` : a.version}</span>
            </NavLink>
          ))}
          <div className="user-box">
            <div className="user-name">{user.isAdmin ? 'smadmin' : `${user.firstName} ${user.lastName}`}</div>
            <div className="user-scope">{user.isAdmin ? 'administrator – all APIs' : user.scope}</div>
            <button className="btn small ghost" onClick={logout}>Logout</button>
          </div>
        </aside>
        <main className="content">
          {error && <div className="alert error">{error}</div>}
          <Routes>
            <Route path="/" element={<Navigate to="/register" replace />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/browse/:key" element={<ApiListPage />} />
            <Route path="/browse/:key/records/:id" element={<DetailPage />} />
            {user.isAdmin && <Route path="/admin-view" element={<Navigate to="/admin-view/users" replace />} />}
            {user.isAdmin && <Route path="/admin-view/:tab" element={<AdminPage />} />}
            <Route path="/manual" element={<ManualPage />} />
            <Route path="/login" element={<Navigate to="/register" replace />} />
            <Route path="*" element={<Navigate to="/register" replace />} />
          </Routes>
        </main>
      </div>
    </ApisContext.Provider>
  );
}

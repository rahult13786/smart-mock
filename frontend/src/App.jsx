import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { admin } from './api.js';
import RegisterPage from './pages/RegisterPage.jsx';
import ApiListPage from './pages/ApiListPage.jsx';
import DetailPage from './pages/DetailPage.jsx';

const ApisContext = createContext({ apis: [], refresh: async () => {} });
export const useApis = () => useContext(ApisContext);

export default function App() {
  const [apis, setApis] = useState([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setApis(await admin.list());
      setError('');
    } catch (e) {
      setError(`Cannot reach the API server: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ApisContext.Provider value={{ apis, refresh }}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">Mock API Portal</div>
          <NavLink to="/register" className="nav-item register">
            <span className="plus">＋</span> Register API
          </NavLink>
          <div className="nav-heading">APIs</div>
          {apis.length === 0 && <div className="nav-empty">None registered yet</div>}
          {apis.map((a) => (
            <NavLink key={a._id} to={`/browse/${a._id}`} className="nav-item">
              <span className="nav-name">{a.name}</span>
              <span className="badge">{a.version}</span>
            </NavLink>
          ))}
        </aside>
        <main className="content">
          {error && <div className="alert error">{error}</div>}
          <Routes>
            <Route path="/" element={<Navigate to="/register" replace />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/browse/:key" element={<ApiListPage />} />
            <Route path="/browse/:key/records/:id" element={<DetailPage />} />
            <Route path="*" element={<Navigate to="/register" replace />} />
          </Routes>
        </main>
      </div>
    </ApisContext.Provider>
  );
}

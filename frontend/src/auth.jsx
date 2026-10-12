import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth, getToken, setToken } from './api.js';

const AuthContext = createContext({ user: null, ready: false, login: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    auth
      .me()
      .then(setUser)
      .catch(() => setToken(''))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const onOut = () => {
      setToken('');
      setUser(null);
    };
    window.addEventListener('portal-logged-out', onOut);
    return () => window.removeEventListener('portal-logged-out', onOut);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await auth.login(email, password);
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setToken('');
      setUser(null);
    }
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

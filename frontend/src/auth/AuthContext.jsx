import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { hasSessionHint, refreshSession, setAccessToken, setAuthLostHandler, setSessionHint } from '../api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthLostHandler(() => setUser(null));
    if (!hasSessionHint()) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    const restore = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const session = await refreshSession();
          if (!cancelled) setUser(session.user);
          return;
        } catch (error) {
          if (error.response?.status === 401) return;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
        }
      }
    };
    restore().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const apply = useCallback((d) => { setAccessToken(d.accessToken); setSessionHint(true); setUser(d.user); return d.user; }, []);
  const login = useCallback(async (email, password, adminOnly = false) => apply((await api.post('/auth/login', { email, password, ...(adminOnly ? { adminOnly: true } : {}) })).data.data), [apply]);
  const loginGoogle = useCallback(async (idToken, adminOnly = false) => apply((await api.post('/auth/google', { idToken, ...(adminOnly ? { adminOnly: true } : {}) })).data.data), [apply]);
  const register = useCallback(async (input) => apply((await api.post('/auth/register', input)).data.data), [apply]);
  const registerGoogle = useCallback(async (idToken, course) => apply((await api.post('/auth/register-google', { idToken, ...course })).data.data), [apply]);
  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch (e) { /* ignore */ }
    setAccessToken(null);
    setSessionHint(false);
    setUser(null);
  }, []);
  const updateUser = useCallback((patch) => setUser((current) => current ? { ...current, ...patch } : current), []);

  const value = useMemo(() => ({ user, loading, login, loginGoogle, register, registerGoogle, logout, updateUser }), [user, loading, login, loginGoogle, register, registerGoogle, logout, updateUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const homeFor = (user) => (!user ? '/' : user.role === 'STUDENT' ? '/student' : user.role === 'TRAINER' ? '/trainer' : '/admin');

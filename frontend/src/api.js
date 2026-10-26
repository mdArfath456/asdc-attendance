import axios from 'axios';

let accessToken = null;
let onAuthLost = () => {};
export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setAuthLostHandler = (fn) => { onAuthLost = fn; };
const SESSION_HINT = 'asdc_session_hint';
const performanceDiagnostics = import.meta.env.VITE_PERF_DIAGNOSTICS === 'true';
export const hasSessionHint = () => window.localStorage.getItem(SESSION_HINT) === '1';
export const setSessionHint = (active) => {
  if (active) window.localStorage.setItem(SESSION_HINT, '1');
  else window.localStorage.removeItem(SESSION_HINT);
};

const definitiveRefreshFailure = (error) => error.response?.status === 401
  && error.response?.data?.error?.code !== 'REFRESH_RACE';

function logRequestTiming(config, status, headers = {}) {
  if (!performanceDiagnostics || !config?.performanceStartedAt) return;
  console.info('[api-performance]', {
    method: config.method?.toUpperCase(),
    route: String(config.url || '').split('?')[0],
    status,
    durationMs: Number((performance.now() - config.performanceStartedAt).toFixed(2)),
    responseBytes: Number(headers['content-length']) || null,
  });
}

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1', withCredentials: true });
api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  if (performanceDiagnostics) cfg.performanceStartedAt = performance.now();
  return cfg;
});

// Single in-flight refresh (also protects against React StrictMode double effects and parallel 401s).
let refreshing = null;
export function refreshSession() {
  if (!refreshing) {
    const perform = async () => {
      const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, null, { withCredentials: true });
      accessToken = response.data.data.accessToken;
      setSessionHint(true);
      return response.data.data;
    };
    const request = () => (navigator.locks?.request
      ? navigator.locks.request('asdc-auth-refresh', perform)
      : perform());
    refreshing = request()
      .catch((error) => {
        if (definitiveRefreshFailure(error)) {
          accessToken = null;
          setSessionHint(false);
          onAuthLost();
        }
        throw error;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => {
    logRequestTiming(r.config, r.status, r.headers);
    return r;
  },
  async (err) => {
    const original = err.config;
    logRequestTiming(original, err.response?.status || 'network-error', err.response?.headers);
    if (err.response && err.response.status === 401 && original && !original._retry && !String(original.url).includes('/auth/')) {
      original._retry = true;
      try {
        await refreshSession();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (e) {
        if (definitiveRefreshFailure(e)) {
          setAccessToken(null);
          setSessionHint(false);
          onAuthLost();
        }
      }
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e) => (e.response && e.response.data && e.response.data.message) || e.message || 'Something went wrong';
export const errCode = (e) => e.response && e.response.data && e.response.data.error && e.response.data.error.code;
export default api;

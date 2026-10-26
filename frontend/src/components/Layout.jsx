import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import api from '../api';
import StudentIdCardModal from './StudentIdCardModal';

export default function Layout() {
  const { user, logout, setThemePreference } = useAuth();
  const nav = useNavigate();
  const base = user.role === 'ADMIN' ? '/admin' : user.role === 'TRAINER' ? '/trainer' : '/student';
  const [liveSessions, setLiveSessions] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [idCardOpen, setIdCardOpen] = useState(false);
  const [themeError, setThemeError] = useState('');
  const [sessionError, setSessionError] = useState('');
  const isDark = user.themePreference === 'dark';
  const closeIdCard = useCallback(() => setIdCardOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleTheme = async () => {
    setThemeError('');
    try {
      await setThemePreference(isDark ? 'light' : 'dark');
    } catch {
      setThemeError('Could not save your appearance setting. Please try again.');
    }
  };

  useEffect(() => {
    if (!['ADMIN', 'TRAINER'].includes(user.role)) return undefined;
    let cancelled = false;
    let controller;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const { data } = await api.get('/attendance-sessions/today', { signal: controller.signal });
        if (!cancelled) {
          setLiveSessions(data.data.filter((session) => session.status === 'OPEN'));
          setSessionError('');
        }
      } catch {
        if (!cancelled && !controller.signal.aborted) setSessionError('Live session status is temporarily unavailable.');
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); controller?.abort(); };
  }, [user.role]);
  const links = user.role === 'ADMIN'
    ? [['/admin', 'Attendance', true], ['/admin/courses', 'Courses'], ['/admin/students', 'Students'], ['/admin/reports', 'Reports'], ['/admin/audit', 'Audit log']]
    : user.role === 'TRAINER'
      ? [['/trainer', 'Attendance', true], ['/trainer/courses', 'My courses'], ['/trainer/reports', 'Reports']]
      : [['/student', 'Scan QR', true], ['/student/history', 'My attendance'], ['/student/join', 'Join a course']];
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-main">
          <Link to={base} className="brand" onClick={() => setMenuOpen(false)}>ASDC Attendance</Link>
          <div className="topbar-controls">
            <button
              className="btn small ghost theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              aria-pressed={isDark}
            >
              <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
              <span className="theme-toggle-label">{isDark ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button
              className={`menu-toggle${menuOpen ? ' is-open' : ''}`}
              type="button"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={menuOpen}
              aria-controls="primary-navigation"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
        <div className={`topbar-menu${menuOpen ? ' is-open' : ''}`}>
          <nav id="primary-navigation" aria-label="Main navigation">{links.map(([to, label, end]) => <NavLink key={to} to={to} end={!!end} onClick={() => setMenuOpen(false)}>{label}</NavLink>)}</nav>
          <div className="who">
            <span>{user.name} <small className="muted">({user.role.replace('_', ' ')})</small></span>
            {user.role === 'STUDENT' && <button className="btn small ghost" type="button" onClick={() => setIdCardOpen(true)}>My ID Card</button>}
            <button className="btn small ghost" onClick={async () => { await logout(); nav('/'); }}>Log out</button>
          </div>
        </div>
        {themeError && <div className="topbar-message error" role="alert">{themeError}</div>}
        {sessionError && <div className="topbar-message error" role="status">{sessionError}</div>}
        {liveSessions.map((session) => (
          <div className="live-banner" key={session._id}>
            Live session: {session.courseName} — <Link to={`${base}/session/${session._id}`}>Open QR screen</Link>
          </div>
        ))}
      </header>
      <main className="content"><Outlet /></main>
      {idCardOpen && <StudentIdCardModal onClose={closeIdCard} />}
    </div>
  );
}

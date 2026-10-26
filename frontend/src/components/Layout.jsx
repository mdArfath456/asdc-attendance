import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import api from '../api';

export default function Layout() {
  const { user, logout, setThemePreference } = useAuth();
  const nav = useNavigate();
  const base = user.role === 'ADMIN' ? '/admin' : user.role === 'TRAINER' ? '/trainer' : '/student';
  const [liveSessions, setLiveSessions] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeError, setThemeError] = useState('');
  const isDark = user.themePreference === 'dark';

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
    const load = async () => {
      try {
        const { data } = await api.get('/courses');
        const sessionsByCourse = await Promise.all(data.data.filter((course) => course.batchId).map(async (course) => {
          const result = await api.get(`/batches/${course.batchId}/attendance-sessions`);
          const session = result.data.data.find((item) => item.status === 'OPEN');
          return session ? { ...session, courseName: course.name } : null;
        }));
        if (!cancelled) setLiveSessions(sessionsByCourse.filter(Boolean));
      } catch {
        if (!cancelled) setLiveSessions([]);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
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
            <button className="btn small ghost" onClick={async () => { await logout(); nav('/'); }}>Log out</button>
          </div>
        </div>
        {themeError && <div className="topbar-message error" role="alert">{themeError}</div>}
        {liveSessions.map((session) => (
          <div className="live-banner" key={session._id}>
            Live session: {session.courseName} — <Link to={`${base}/session/${session._id}`}>Open QR screen</Link>
          </div>
        ))}
      </header>
      <main className="content"><Outlet /></main>
    </div>
  );
}

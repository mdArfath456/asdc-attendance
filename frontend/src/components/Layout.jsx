import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import api from '../api';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const base = user.role === 'ADMIN' ? '/admin' : user.role === 'TRAINER' ? '/trainer' : '/student';
  const [liveSessions, setLiveSessions] = useState([]);
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
        <Link to={base} className="brand">ASDC Attendance</Link>
        <nav aria-label="Main navigation">{links.map(([to, label, end]) => <NavLink key={to} to={to} end={!!end}>{label}</NavLink>)}</nav>
        <div className="who">
          <span>{user.name} <small className="muted">({user.role.replace('_', ' ')})</small></span>
          <button className="btn small ghost" onClick={async () => { await logout(); nav('/'); }}>Log out</button>
        </div>
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

import { Navigate, Link } from 'react-router-dom';
import { useAuth, homeFor } from '../auth/AuthContext';
import StudentAuthLayout from '../components/StudentAuthLayout';

export default function RoleChooser() {
  const { user, loading } = useAuth();
  if (loading) return <p className="center muted">Loading...</p>;
  if (user) return <Navigate to={homeFor(user)} replace />;
  return (
    <StudentAuthLayout>
      <div className="auth-card">
        <p className="eyebrow">GET STARTED</p>
        <h2>Welcome to ASDC</h2>
        <p className="muted">Choose how you want to continue.</p>
        <section className="role-card">
          <div className="role-icon" aria-hidden="true">◉</div>
          <div><h3>Student</h3><p className="muted">Join a course and keep up with your attendance.</p></div>
          <div className="role-actions">
            <Link className="btn" to="/register">Register (first time here)</Link>
            <Link className="btn ghost" to="/login/student">Sign in</Link>
          </div>
        </section>
        <section className="role-card admin-role">
          <div className="role-icon" aria-hidden="true">▣</div>
          <div><h3>Administrator</h3><p className="muted">Manage courses, students and attendance.</p></div>
          <div className="role-actions"><Link className="btn ghost" to="/login/admin">Admin sign in</Link></div>
        </section>
        <p className="auth-links"><Link to="/courses">Browse courses</Link></p>
      </div>
    </StudentAuthLayout>
  );
}

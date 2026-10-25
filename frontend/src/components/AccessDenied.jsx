import { Link } from 'react-router-dom';
import { homeFor } from '../auth/AuthContext';

export default function AccessDenied({ user, adminArea = false }) {
  return (
    <main className="access-denied">
      <section className="card">
        <h1>{adminArea ? "You don't have access to the admin area" : "You don't have access to this area"}</h1>
        <p className="muted">This area is only available to the appropriate account role.</p>
        <div className="row">
          {user && <Link className="btn" to={homeFor(user)}>Go to my home</Link>}
          {adminArea && <Link className="btn ghost" to="/login/student">Go to student sign in</Link>}
          {!user && <Link className="btn" to="/login/student">Sign in</Link>}
        </div>
      </section>
    </main>
  );
}

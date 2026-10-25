import { Navigate, Outlet } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from './AuthContext';
import AccessDenied from '../components/AccessDenied';
import { protectedRouteDecision } from './routeAccess';

export default function ProtectedRoute({ roles, area }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading...</div>;
  const decision = protectedRouteDecision(user, roles);
  if (decision === 'redirect') return <Navigate to="/" replace />;
  if (decision === 'denied') return <AccessDenied user={user} adminArea={area === 'admin'} />;
  return (
    <>
      <Helmet><meta name="robots" content="noindex, nofollow" /></Helmet>
      <Outlet />
    </>
  );
}

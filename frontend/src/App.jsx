import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import RoleChooser from './pages/RoleChooser';
import Register from './pages/Register';
import AccessDenied from './components/AccessDenied';

const CompleteGoogleRegistration = lazy(() => import('./pages/CompleteGoogleRegistration'));
const PublicCourses = lazy(() => import('./pages/PublicCourses'));
const PublicCourse = lazy(() => import('./pages/PublicCourse'));
const Courses = lazy(() => import('./pages/staff/Courses'));
const CourseDetail = lazy(() => import('./pages/staff/CourseDetail'));
const Students = lazy(() => import('./pages/staff/Students'));
const Audit = lazy(() => import('./pages/staff/Audit'));
const Dashboard = lazy(() => import('./pages/staff/Dashboard'));
const Presenter = lazy(() => import('./pages/staff/Presenter'));
const Reports = lazy(() => import('./pages/staff/Reports'));
const Scan = lazy(() => import('./pages/student/Scan'));
const History = lazy(() => import('./pages/student/History'));
const JoinCourse = lazy(() => import('./pages/student/JoinCourse'));

const LegacyLogin = () => {
  const { user } = useAuth();
  return <Navigate to={user ? (user.role === 'ADMIN' ? '/login/admin' : '/login/student') : '/login/student'} replace />;
};

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Suspense fallback={<div className="center muted">Loading...</div>}>
      <Routes>
        <Route path="/" element={<RoleChooser />} />
        <Route path="/login" element={<LegacyLogin />} />
        <Route path="/login/student" element={<Login />} />
        <Route path="/login/admin" element={!loading && user && user.role !== 'ADMIN' ? <AccessDenied user={user} adminArea /> : <Login adminOnly />} />
        <Route path="/register" element={<Register />} />
        <Route path="/register/complete" element={<CompleteGoogleRegistration />} />
        <Route path="/courses" element={<PublicCourses />} />
        <Route path="/courses/:slug" element={<PublicCourse />} />

        <Route path="/admin" element={<ProtectedRoute roles={['ADMIN']} area="admin" />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="courses" element={<Courses />} />
            <Route path="courses/:courseId" element={<CourseDetail />} />
            <Route path="students" element={<Students />} />
            <Route path="reports" element={<Reports />} />
            <Route path="audit" element={<Audit />} />
            <Route path="session/:sessionId" element={<Presenter />} />
          </Route>
        </Route>

        <Route path="/trainer" element={<ProtectedRoute roles={['TRAINER']} area="trainer" />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="courses" element={<Dashboard />} />
            <Route path="courses/:courseId" element={<CourseDetail />} />
            <Route path="reports" element={<Reports />} />
            <Route path="session/:sessionId" element={<Presenter />} />
          </Route>
        </Route>

        <Route path="/student" element={<ProtectedRoute roles={['STUDENT']} area="student" />}>
          <Route element={<Layout />}>
            <Route index element={<Scan />} />
            <Route path="history" element={<History />} />
            <Route path="join" element={<JoinCourse />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

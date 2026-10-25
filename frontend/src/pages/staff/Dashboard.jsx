import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errCode, errMsg } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import Field from '../../components/Field';
import Modal from '../../components/Modal';
import { sessionSchema, validate } from '../../validation';

const INITIAL = { title: '', lateThresholdMinutes: '10', durationMinutes: '90' };

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const base = user.role === 'TRAINER' ? '/trainer' : '/admin';
  const [courses, setCourses] = useState([]);
  const [sessionsByCourse, setSessionsByCourse] = useState({});
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [cfg, setCfg] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const lateRef = useRef(null);
  const durationRef = useRef(null);

  const load = async () => {
    const response = await api.get('/courses');
    const available = response.data.data.filter((course) => course.status === 'ACTIVE');
    const sessions = await Promise.all(available.filter((course) => course.batchId).map(async (course) => {
      const result = await api.get(`/batches/${course.batchId}/attendance-sessions`);
      return [course._id, result.data.data];
    }));
    setCourses(available);
    setSessionsByCourse(Object.fromEntries(sessions));
    setLoaded(true);
    const requestedCourseId = searchParams.get('courseId');
    if (requestedCourseId) {
      const found = available.find((course) => String(course._id) === requestedCourseId);
      if (found) setSelectedCourse(found);
    }
  };
  useEffect(() => {
    load().catch((loadError) => { setError(errMsg(loadError)); setLoaded(true); });
  // Initial data is loaded on mount; search params provide an optional deep link to a course.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (event) => {
    event.preventDefault();
    setError('');
    const result = validate(sessionSchema, cfg);
    setErrors(result.errors);
    if (!result.values) {
      if (result.errors.lateThresholdMinutes) lateRef.current?.focus();
      else durationRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const body = {
        lateThresholdMinutes: result.values.lateThresholdMinutes,
        durationMinutes: result.values.durationMinutes,
        ...(cfg.title.trim() ? { title: cfg.title.trim() } : {}),
      };
      const response = await api.post(`/batches/${selectedCourse.batchId}/attendance-sessions`, body);
      nav(`${base}/session/${response.data.data.session._id}`);
    } catch (startError) {
      setError(errCode(startError) === 'SESSION_ALREADY_OPEN' ? 'There is already an open session for this course. Refresh and resume it.' : errMsg(startError));
      setSelectedCourse(null);
      load().catch((loadError) => setError(errMsg(loadError)));
    } finally {
      setBusy(false);
    }
  };

  const isMyCourses = location.pathname.endsWith('/courses');
  return (
    <>
      <div className="row spread">
        <div><p className="eyebrow">{user.role === 'TRAINER' ? 'YOUR TEACHING' : 'SESSION CONTROL'}</p><h1>{isMyCourses ? 'My courses' : 'Attendance'}</h1></div>
        {user.role === 'ADMIN' && <Link className="btn ghost" to="/admin/courses">Manage courses</Link>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!loaded && <p className="muted">Loading courses…</p>}
      {loaded && courses.length === 0 && (
        <div className="card empty-state">
          <h2>{user.role === 'TRAINER' ? 'No assigned courses yet' : 'No courses yet'}</h2>
          <p className="muted">{user.role === 'TRAINER' ? 'Ask an administrator to assign a course to you.' : 'Create a course to start taking attendance.'}</p>
          {user.role === 'ADMIN' && <Link className="btn" to="/admin/courses">Create a course</Link>}
        </div>
      )}
      <div className="grid attendance-course-grid">
        {courses.map((course) => {
          const sessions = sessionsByCourse[course._id] || [];
          const open = sessions.find((session) => session.status === 'OPEN');
          return (
            <article className="card attendance-course-card" key={course._id}>
              <p className="eyebrow">{course.code}</p>
              <h2><Link to={`${base}/courses/${course._id}`}>{course.name}</Link></h2>
              {course.description && <p className="muted">{course.description}</p>}
              <p className="enrolled-count"><b>{course.enrolledCount || 0}</b> enrolled students</p>
              {open
                ? <Link className="btn resume-btn" to={`${base}/session/${open._id}`}>Resume session</Link>
                : <button className="btn start-session-btn" disabled={!course.batchId} onClick={() => { setSelectedCourse(course); setCfg(INITIAL); setErrors({}); }}>Start attendance session</button>}
            </article>
          );
        })}
      </div>
      {selectedCourse && (
        <Modal
          title={`Start attendance: ${selectedCourse.name}`}
          onClose={() => setSelectedCourse(null)}
          footer={<><button className="btn ghost" type="button" onClick={() => setSelectedCourse(null)}>Cancel</button><button className="btn" type="submit" form="start-session-form" disabled={busy}>{busy ? 'Starting…' : 'Start session'}</button></>}
        >
          <form id="start-session-form" noValidate onSubmit={start}>
            {error && <div className="error" role="alert">{error}</div>}
            <Field id="session-title" label="Title (optional)" value={cfg.title} maxLength={160} onChange={(event) => setCfg({ ...cfg, title: event.target.value })} />
            <Field
              ref={lateRef}
              id="session-late-threshold"
              label="Late after (minutes)"
              type="number"
              min="0"
              max="240"
              value={cfg.lateThresholdMinutes}
              onChange={(event) => {
                const value = event.target.value;
                setCfg({ ...cfg, lateThresholdMinutes: value });
                if (/^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= 240) setErrors((current) => ({ ...current, lateThresholdMinutes: undefined }));
              }}
              error={errors.lateThresholdMinutes}
            />
            <Field
              ref={durationRef}
              id="session-duration"
              label="Session duration (minutes)"
              type="number"
              min="5"
              max="600"
              value={cfg.durationMinutes}
              onChange={(event) => {
                const value = event.target.value;
                setCfg({ ...cfg, durationMinutes: value });
                if (/^\d+$/.test(value) && Number(value) >= 5 && Number(value) <= 600) setErrors((current) => ({ ...current, durationMinutes: undefined }));
              }}
              error={errors.durationMinutes}
            />
          </form>
        </Modal>
      )}
    </>
  );
}

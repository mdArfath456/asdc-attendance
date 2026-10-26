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
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [todayByCourse, setTodayByCourse] = useState({});
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [cfg, setCfg] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reopeningSessionId, setReopeningSessionId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const requestSequence = useRef(0);
  const lateRef = useRef(null);
  const durationRef = useRef(null);
  const requestedCourseId = searchParams.get('courseId');

  const load = async (signal, pageNumber = page) => {
    const sequence = ++requestSequence.current;
    const [response, todayResponse] = await Promise.all([
      api.get('/courses/paged', {
        params: { page: pageNumber, limit: 30, status: 'ACTIVE', ...(requestedCourseId ? { courseId: requestedCourseId } : {}) },
        signal,
      }),
      api.get('/attendance-sessions/today', { signal }),
    ]);
    if (sequence !== requestSequence.current) return;
    const available = response.data.data.items;
    const todayByCourse = Object.fromEntries(todayResponse.data.data.map((session) => [session.courseId, session]));
    setCourses(available);
    setPagination({
      page: response.data.data.page,
      pages: response.data.data.pages,
      total: response.data.data.total,
    });
    setTodayByCourse(todayByCourse);
    setLoaded(true);
    if (requestedCourseId) {
      const found = available.find((course) => String(course._id) === requestedCourseId);
      if (found) setSelectedCourse(found);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((loadError) => {
      if (loadError.name !== 'CanceledError' && loadError.name !== 'AbortError') {
        setError(errMsg(loadError));
        setLoaded(true);
      }
    });
    return () => { requestSequence.current += 1; controller.abort(); };
    // Initial data is loaded on mount; search params provide an optional deep link to a course.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, requestedCourseId]);

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
      setError(errCode(startError) === 'SESSION_ALREADY_TAKEN_TODAY'
        ? 'Attendance has already been taken today. View or reopen today’s session below.'
        : errCode(startError) === 'SESSION_ALREADY_OPEN'
          ? 'There is already an open session for this course. Resume it below.'
          : errMsg(startError));
      setSelectedCourse(null);
      load().catch((loadError) => setError(errMsg(loadError)));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (session) => {
    setError('');
    setReopeningSessionId(String(session._id));
    try {
      await api.post(`/attendance-sessions/${session._id}/reopen`);
      nav(`${base}/session/${session._id}`);
    } catch (reopenError) {
      setError(errMsg(reopenError));
      load().catch((loadError) => setError(errMsg(loadError)));
    } finally {
      setReopeningSessionId('');
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
          const todaySession = todayByCourse[course._id];
          const open = todaySession?.status === 'OPEN';
          const closed = todaySession?.status === 'CLOSED';
          return (
            <article className="card attendance-course-card" key={course._id}>
              <p className="eyebrow">{course.code}</p>
              <h2><Link to={`${base}/courses/${course._id}`}>{course.name}</Link></h2>
              {course.description && <p className="muted">{course.description}</p>}
              <p className="enrolled-count"><b>{course.enrolledCount || 0}</b> enrolled students</p>
              {open ? (
                <>
                  <p className="session-state session-live">Live</p>
                  <Link className="btn resume-btn" to={`${base}/session/${todaySession._id}`}>Resume session · Open QR</Link>
                </>
              ) : closed ? (
                <>
                  <p className="session-state">Taken today</p>
                  <div className="row">
                    <Link className="btn ghost" to={`${base}/session/${todaySession._id}`}>View attendance</Link>
                    <button className="btn" disabled={reopeningSessionId === String(todaySession._id)} onClick={() => reopen(todaySession)}>{reopeningSessionId === String(todaySession._id) ? 'Reopening…' : 'Reopen today’s session'}</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="session-state">Not started</p>
                  <button className="btn start-session-btn" disabled={!course.batchId} onClick={() => { setSelectedCourse(course); setCfg(INITIAL); setErrors({}); }}>Start attendance session</button>
                </>
              )}
            </article>
          );
        })}
      </div>
      {pagination.pages > 1 && (
        <div className="row spread" aria-label="Course pagination">
          <button className="btn ghost" type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span className="muted">Page {pagination.page} of {pagination.pages} · {pagination.total} courses</span>
          <button className="btn ghost" type="button" disabled={page >= pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      )}
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

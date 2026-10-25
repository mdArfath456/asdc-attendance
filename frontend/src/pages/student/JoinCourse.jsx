import { useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import CourseCards from '../../components/CourseCards';
import Field from '../../components/Field';
import { courseSelectionSchema, validate } from '../../validation';

export default function JoinCourse() {
  const { updateUser } = useAuth();
  const [courses, setCourses] = useState([]);
  const [joined, setJoined] = useState(new Set());
  const [choice, setChoice] = useState('');
  const [requestedCourseName, setRequestedCourseName] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const courseRef = useRef(null);
  const requestedCourseRef = useRef(null);

  const load = async () => {
    try {
      const [active, history] = await Promise.all([api.get('/courses/active'), api.get('/attendance/my-history')]);
      setCourses(active.data.data);
      setJoined(new Set(history.data.data.enrollments.filter((row) => row.status === 'ACTIVE').map((row) => row.course?.id)));
    } catch (loadError) {
      setError(errMsg(loadError));
    }
  };
  useEffect(() => { load(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const result = validate(courseSelectionSchema, {
      courseChoice: choice,
      requestedCourseName: choice === 'OTHER' ? requestedCourseName : undefined,
    });
    setErrors(result.errors);
    if (result.errors.courseChoice) courseRef.current?.focus();
    else if (result.errors.requestedCourseName) requestedCourseRef.current?.focus();
    if (!result.values) return;
    setBusy(true);
    try {
      if (choice === 'OTHER') {
        const response = await api.post('/enrollments/request-course', { requestedCourseName: requestedCourseName.trim() });
        updateUser({ requestedCourseName: response.data.data.requestedCourseName });
        setMessage(`Course request sent. Waiting for the admin to add you to ${response.data.data.requestedCourseName}.`);
        setRequestedCourseName('');
      } else {
        await api.post('/enrollments/join', { courseId: choice });
        setMessage('You joined the course.');
        setChoice('');
        await load();
      }
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Join a course</h1>
      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="success" role="status">{message}</div>}
      <form noValidate className="card" onSubmit={submit}>
        <CourseCards
          courses={courses}
          value={choice}
          onChange={(value) => { setChoice(value); setErrors({}); }}
          error={errors.courseChoice}
          focusRef={courseRef}
          name="join-course"
        />
        {choice === 'OTHER' && (
          <Field
            ref={requestedCourseRef}
            id="join-requested-course"
            label="Type your course name"
            value={requestedCourseName}
            maxLength={80}
            onChange={(event) => {
              const value = event.target.value;
              setRequestedCourseName(value);
              if (value.trim().length >= 2 && value.trim().length <= 80 && !/[<>]/.test(value)) {
                setErrors((current) => ({ ...current, requestedCourseName: undefined }));
              }
            }}
            error={errors.requestedCourseName}
          />
        )}
        {courses.length === 0 && <p className="muted">No active courses are available yet. You can request one using “Other”.</p>}
        {choice && <button className="btn" disabled={busy || (choice !== 'OTHER' && joined.has(String(choice)))}>{busy ? 'Submitting…' : choice === 'OTHER' ? 'Request course' : joined.has(String(choice)) ? 'Already joined' : 'Join selected course'}</button>}
      </form>
    </>
  );
}
